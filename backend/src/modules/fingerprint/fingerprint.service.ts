import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { UploadRightsRoutingService } from "../rights/upload-rights-routing.service";

@Injectable()
export class FingerprintService {
  private readonly logger = new Logger(FingerprintService.name);

  constructor(
    private readonly uploadRightsRoutingService: UploadRightsRoutingService,
  ) {}

  /**
   * Register a fingerprint for a track and check for duplicates.
   * Returns { quarantined, reason } indicating whether the track should be blocked.
   */
  async registerFingerprint(input: {
    trackId: string;
    releaseId: string;
    fingerprint: string;
    fingerprintHash: string;
    duration: number;
    audioRevision?: string;
  }): Promise<{ quarantined: boolean; reason?: string; duplicate?: boolean; sameWallet?: boolean }> {
    const { trackId, releaseId, fingerprint, fingerprintHash, duration, audioRevision } = input;

    if (audioRevision) {
      return this.registerReplacementFingerprint({ ...input, audioRevision });
    } else {
      const current = await prisma.track.findUnique({
        where: { id: trackId, releaseId },
        select: { activeAudioRevision: true, pendingAudioRevision: true },
      });
      if (current?.activeAudioRevision || current?.pendingAudioRevision) {
        return { quarantined: true, reason: "A newer audio revision is active" };
      }
    }

    // Store the fingerprint
    await prisma.audioFingerprint.upsert({
      where: { trackId },
      update: { fingerprint, fingerprintHash, duration },
      create: {
        trackId,
        fingerprint,
        fingerprintHash,
        duration,
        source: "upload",
      },
    });

    this.logger.log(`Fingerprint stored for track ${trackId} (hash=${fingerprintHash.slice(0, 16)}...)`);

    // Check for duplicates — find other tracks with the same fingerprint hash
    const duplicates = await prisma.audioFingerprint.findMany({
      where: {
        fingerprintHash,
        trackId: { not: trackId }, // Exclude self
      },
      include: {
        track: {
          include: {
            release: {
              include: { artist: true },
            },
          },
        },
      },
    });

    if (duplicates.length === 0) {
      return { quarantined: false };
    }

    // Found a duplicate — check if same wallet (same artist)
    const currentTrack = await prisma.track.findUnique({
      where: { id: trackId },
      include: {
        release: {
          include: { artist: true },
        },
      },
    });

    if (!currentTrack) {
      return { quarantined: false };
    }

    const currentArtistId = currentTrack.release.artistId;
    const sameWalletDuplicates = duplicates.filter(
      (d) => d.track.release.artistId === currentArtistId,
    );

    if (sameWalletDuplicates.length > 0 && sameWalletDuplicates.length === duplicates.length) {
      // All duplicates are from the same artist — warn but don't quarantine
      this.logger.warn(`Same-wallet duplicate detected for track ${trackId}`);
      return { quarantined: false, duplicate: true, sameWallet: true };
    }

    // Cross-wallet duplicate — quarantine!
    this.logger.warn(
      `Cross-wallet duplicate detected for track ${trackId}! ` +
      `Matching track(s): ${duplicates.map((d) => d.trackId).join(", ")}`,
    );

    await prisma.track.update({
      where: { id: trackId },
      data: { contentStatus: "quarantined" },
    });
    await this.uploadRightsRoutingService.syncTrackRightsFromContentStatus(trackId);

    // Notify the original uploader(s) — TODO: implement notification system
    const originalArtists = [...new Set(duplicates.map((d) => d.track.release.artist.displayName))];

    return {
      quarantined: true,
      duplicate: true,
      sameWallet: false,
      reason: `Duplicate content detected. This audio matches existing track(s) uploaded by: ${originalArtists.join(", ")}`,
    };
  }

  private async registerReplacementFingerprint(input: {
    trackId: string;
    releaseId: string;
    fingerprint: string;
    fingerprintHash: string;
    duration: number;
    audioRevision: string;
  }): Promise<{ quarantined: boolean; reason?: string; duplicate?: boolean; sameWallet?: boolean }> {
    const { trackId, releaseId, fingerprint, fingerprintHash, duration, audioRevision } = input;
    return prisma.$transaction(async (tx) => {
      // Serialize callbacks for one hash so two pending replacements cannot
      // both pass duplicate detection before either fingerprint is staged.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(1792, hashtext(${fingerprintHash}))::text AS locked`;
      const current = await tx.track.findUnique({
        where: { id: trackId, releaseId },
        select: {
          pendingAudioRevision: true,
          release: { select: { status: true, artistId: true } },
        },
      });
      if (!current || current.pendingAudioRevision !== audioRevision || current.release.status !== "ready") {
        return { quarantined: true, reason: "This audio replacement is no longer active" };
      }

      const [activeDuplicates, pendingDuplicates] = await Promise.all([
        tx.audioFingerprint.findMany({
          where: { fingerprintHash, trackId: { not: trackId } },
          select: {
            trackId: true,
            track: { select: { release: { select: { artistId: true, artist: { select: { displayName: true } } } } } },
          },
        }),
        tx.track.findMany({
          where: {
            id: { not: trackId },
            pendingAudioRevision: { not: null },
            pendingAudioFingerprintHash: fingerprintHash,
          },
          select: {
            id: true,
            release: { select: { artistId: true, artist: { select: { displayName: true } } } },
          },
        }),
      ]);
      const duplicates = new Map<string, { artistId: string; artistName: string }>();
      for (const row of activeDuplicates) {
        duplicates.set(row.trackId, {
          artistId: row.track.release.artistId,
          artistName: row.track.release.artist.displayName,
        });
      }
      for (const row of pendingDuplicates) {
        duplicates.set(row.id, {
          artistId: row.release.artistId,
          artistName: row.release.artist.displayName,
        });
      }

      const foreignArtists = [...new Set(
        [...duplicates.values()]
          .filter((duplicate) => duplicate.artistId !== current.release.artistId)
          .map((duplicate) => duplicate.artistName),
      )];
      if (foreignArtists.length > 0) {
        this.logger.warn(`Cross-wallet pending audio duplicate detected for track ${trackId}`);
        return {
          quarantined: true,
          duplicate: true,
          sameWallet: false,
          reason: `Duplicate content detected. This audio matches existing track(s) uploaded by: ${foreignArtists.join(", ")}`,
        };
      }

      const staged = await tx.track.updateMany({
        where: { id: trackId, releaseId, pendingAudioRevision: audioRevision, release: { status: "ready" } },
        data: {
          pendingAudioFingerprint: fingerprint,
          pendingAudioFingerprintHash: fingerprintHash,
          pendingAudioFingerprintDuration: duration,
        },
      });
      if (staged.count !== 1) {
        return { quarantined: true, reason: "This audio replacement is no longer active" };
      }
      this.logger.log(`Fingerprint staged for audio revision ${audioRevision} on track ${trackId}`);
      return duplicates.size > 0
        ? { quarantined: false, duplicate: true, sameWallet: true }
        : { quarantined: false };
    });
  }

  /**
   * Get the fingerprint for a track.
   */
  async getFingerprint(trackId: string) {
    return prisma.audioFingerprint.findUnique({
      where: { trackId },
    });
  }
}
