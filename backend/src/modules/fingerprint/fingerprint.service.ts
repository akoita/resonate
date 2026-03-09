import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "../../db/prisma";

@Injectable()
export class FingerprintService {
  private readonly logger = new Logger(FingerprintService.name);

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
  }): Promise<{ quarantined: boolean; reason?: string; duplicate?: boolean; sameWallet?: boolean }> {
    const { trackId, releaseId, fingerprint, fingerprintHash, duration } = input;

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

    // Notify the original uploader(s) — TODO: implement notification system
    const originalArtists = [...new Set(duplicates.map((d) => d.track.release.artist.displayName))];

    return {
      quarantined: true,
      duplicate: true,
      sameWallet: false,
      reason: `Duplicate content detected. This audio matches existing track(s) uploaded by: ${originalArtists.join(", ")}`,
    };
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
