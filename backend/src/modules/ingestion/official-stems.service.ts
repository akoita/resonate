import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../../db/prisma";
import { ArtistService } from "../artist/artist.service";
import { CatalogService } from "../catalog/catalog.service";
import { EncryptionService } from "../encryption/encryption.service";
import { hasReleaseManagementAccess } from "../management/management-access";
import {
  compareRouteSeverity,
  getUploadRightsActions,
  type UploadRightsRoute,
} from "../rights/upload-rights-policy";
import { stemFileExtension } from "../shared/stem-media";
import { StorageProvider } from "../storage/storage_provider";
import { readIngestionUploadBuffer } from "./ingestion-upload-buffer";
import {
  OFFICIAL_STEM_ANALYSIS_SAMPLE_RATE,
  decodeMonoSamples,
  measureSummedLevel,
  probeAudioFacts,
  rmsDb,
} from "./official-stems.audio";
import {
  officialStemContainer,
  summarizeOfficialStemIssues,
  validateOfficialStemFiles,
  validateOfficialStemSilence,
  validateSummedLevel,
  type OfficialStemCandidate,
  type OfficialStemIssue,
} from "./official-stems.validation";

/**
 * Official stems (#1976, ADR-TE-7, docs/features/official_stems.md): an artist
 * uploads the lossless parts of a published track. The package is stored and
 * delivered as uploaded (WAV or FLAC), encrypted exactly like separated stems,
 * and recorded with `source = official`.
 *
 * Ingestion trust (ADR-BM-5): only an account that manages the release's audio
 * (`track_audio`) may upload, and only while the release's rights route allows
 * stem generation (a blocked or quarantined release takes no new stems). The
 * marketplace gates (`marketplaceAllowed`, payouts) stay exactly what they are
 * for separated stems, because both sources follow the same release route.
 *
 * Business model: ADR-BM-6 Line 3 (marketplace take-rate 10%), phase 2. No fee,
 * split or price changes; official stems carry the same pricing rows as any stem.
 */

const logger = new Logger("OfficialStemsService");

/** Release statuses that accept official stems: the track is published or ready to publish. */
const ACCEPTING_RELEASE_STATUSES = new Set(["ready", "published"]);

export type OfficialStemUploadResult = {
  releaseId: string;
  trackId: string;
  stems: Array<{
    id: string;
    type: string;
    source: "official";
    mimeType: string;
    durationSeconds: number;
    sampleRate: number | null;
    isEncrypted: boolean;
  }>;
  /** Earlier official stems of the track that this package replaced. */
  replaced: number;
  summedLevel: { differenceDb: number; envelopeCorrelation: number | null } | null;
};

@Injectable()
export class OfficialStemsService {
  constructor(
    private readonly storageProvider: StorageProvider,
    private readonly encryptionService: EncryptionService,
    private readonly artistService: ArtistService,
    private readonly catalogService: CatalogService,
  ) {}

  /**
   * Validates and stores an official stem package for one track.
   * `files` maps a stem type to its uploaded file.
   */
  async uploadPackage(input: {
    releaseId: string;
    trackId: string;
    userId: string | undefined;
    files: Record<string, Express.Multer.File | undefined>;
  }): Promise<OfficialStemUploadResult> {
    const { releaseId, trackId, userId } = input;
    if (!userId) throw new UnauthorizedException();

    // 1. Authority: the release's manager account, not any signed-in user.
    if (!(await hasReleaseManagementAccess(userId, releaseId, "track_audio"))) {
      throw new ForbiddenException({
        code: "official_stems_forbidden",
        message: "Only an account that manages this release can upload its official stems",
      });
    }

    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      select: { id: true, artistId: true, status: true, rightsRoute: true },
    });
    if (!release) throw new NotFoundException("Release not found");
    const track = await prisma.track.findUnique({
      where: { id: trackId, releaseId },
      select: { id: true, rightsRoute: true, activeAudioRevision: true, pendingAudioRevision: true },
    });
    if (!track) throw new NotFoundException("Track not found in this release");

    // 2. The release's rights route (ADR-BM-5): a blocked or quarantined
    //    release takes no new stems.
    const route = strictestRoute(release.rightsRoute, track.rightsRoute);
    if (route && !getUploadRightsActions(route).stemGenerationAllowed) {
      throw new ForbiddenException({
        code: "official_stems_rights_route",
        message: "This release is under rights review, so new stems cannot be added until the review is resolved",
      });
    }
    if (!ACCEPTING_RELEASE_STATUSES.has(release.status)) {
      throw new ConflictException({
        code: "official_stems_release_not_ready",
        message: "Official stems can be added once the release has finished processing and is not withdrawn",
      });
    }
    if (track.pendingAudioRevision) {
      throw new ConflictException({
        code: "official_stems_audio_replacing",
        message: "This track's audio is being replaced. Add official stems after the replacement finishes",
      });
    }

    const entries = Object.entries(input.files).filter(
      (entry): entry is [string, Express.Multer.File] => !!entry[1],
    );

    // 3. The published mix every stem is checked against.
    const mix = await prisma.stem.findFirst({
      where: { trackId, isCurrent: true, type: { in: ["original", "ORIGINAL"] } },
      select: { id: true, uri: true, data: true, mimeType: true, durationSeconds: true },
    });
    if (!mix) {
      throw new ConflictException({
        code: "official_stems_no_mix",
        message: "This track has no published mix to check the stems against",
      });
    }

    // 4. Read and probe the files, then check them against the published mix.
    const buffers = new Map<string, Buffer>();
    const candidates: OfficialStemCandidate[] = [];
    for (const [type, file] of entries) {
      const buffer = await readIngestionUploadBuffer(file);
      buffers.set(type, buffer);
      candidates.push({
        type,
        fileName: file.originalname || `${type} file`,
        size: buffer.length,
        audio: probeAudioFacts(buffer),
      });
    }

    const mixBuffer = await this.loadMixBuffer(mix);
    if (!mixBuffer) {
      throw new ServiceUnavailableException({
        code: "official_stems_checks_unavailable",
        message: "The published mix could not be read to check the stems. Try again later",
      });
    }
    const { issues, summedLevel } = await this.check({
      mixBuffer,
      mixMimeType: mix.mimeType,
      mixDurationFallback: mix.durationSeconds,
      candidates,
      buffers,
    });

    if (issues.length > 0) {
      throw new BadRequestException({
        code: "official_stems_rejected",
        message: summarizeOfficialStemIssues(issues),
        issues,
      });
    }

    // 5. Encrypt like every stem, then store lossless.
    const artistProfile = await this.artistService.findById(release.artistId);
    const encryptionAddress = artistProfile?.payoutAddress || release.artistId;
    const stored: Array<{
      id: string;
      type: string;
      mimeType: string;
      durationSeconds: number;
      sampleRate: number | null;
      uri: string;
      storageProvider: string;
      isEncrypted: boolean;
      encryptionMetadata: string | null;
    }> = [];
    try {
      for (const candidate of candidates) {
        const container = officialStemContainer(candidate.audio.container) as "wav" | "flac";
        const mimeType = container === "wav" ? "audio/wav" : "audio/flac";
        const stemId = `stem_${Date.now()}_${randomUUID().slice(0, 8)}`;
        let data = buffers.get(candidate.type) as Buffer;
        let isEncrypted = false;
        let encryptionMetadata: string | null = null;
        try {
          const encrypted = await this.encryptionService.encrypt(data, {
            contentId: stemId,
            ownerAddress: encryptionAddress,
            allowedAddresses: [],
          });
          if (encrypted) {
            data = Buffer.from(encrypted.encryptedData);
            encryptionMetadata = encrypted.metadata;
            isEncrypted = true;
          }
        } catch (error) {
          // A stem that cannot be encrypted is not stored in the clear when
          // encryption is on: official stems are the premium asset.
          logger.error(`Encryption failed for official stem ${stemId}: ${(error as Error)?.message}`);
          throw new ServiceUnavailableException({
            code: "official_stems_encryption_failed",
            message: "The stems could not be secured for sale. Try again later",
          });
        }
        const upload = await this.storageProvider.upload(
          data,
          `${stemId}.${stemFileExtension(mimeType)}`,
          mimeType,
        );
        stored.push({
          id: stemId,
          type: candidate.type,
          mimeType,
          durationSeconds: candidate.audio.durationSeconds as number,
          sampleRate: candidate.audio.sampleRate,
          uri: upload.uri,
          storageProvider: upload.provider,
          isEncrypted,
          encryptionMetadata,
        });
      }

      // 6. Record: retire the previous official package, create the new rows.
      const replaced = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Release" WHERE "id" = ${releaseId} FOR UPDATE`;
        const current = await tx.release.findUnique({
          where: { id: releaseId },
          select: { status: true },
        });
        if (!current || !ACCEPTING_RELEASE_STATUSES.has(current.status)) {
          throw new ConflictException({
            code: "official_stems_release_not_ready",
            message: "Official stems can be added once the release has finished processing and is not withdrawn",
          });
        }
        if (!(await hasReleaseManagementAccess(userId, releaseId, "track_audio", tx))) {
          throw new ForbiddenException({
            code: "official_stems_forbidden",
            message: "Only an account that manages this release can upload its official stems",
          });
        }
        const currentTrack = await tx.track.findUnique({
          where: { id: trackId, releaseId },
          select: { activeAudioRevision: true, pendingAudioRevision: true },
        });
        if (!currentTrack || currentTrack.pendingAudioRevision) {
          throw new ConflictException({
            code: "official_stems_audio_replacing",
            message: "This track's audio is being replaced. Add official stems after the replacement finishes",
          });
        }

        const previous = await tx.stem.findMany({
          where: { trackId, isCurrent: true, source: "official" },
          select: { id: true, type: true, nftMint: { select: { id: true } }, pricing: true },
        });
        if (previous.some((stem) => stem.nftMint)) {
          throw new ConflictException({
            code: "official_stems_already_minted",
            message: "Official stems cannot be replaced after one of them has been minted",
          });
        }
        if (previous.length > 0) {
          await tx.stem.updateMany({
            where: { id: { in: previous.map((stem) => stem.id) } },
            data: { isCurrent: false },
          });
        }
        const pricingByType = new Map(
          previous.filter((stem) => stem.pricing).map((stem) => [stem.type, stem.pricing!]),
        );

        for (const stem of stored) {
          await tx.stem.create({
            data: {
              id: stem.id,
              trackId,
              type: stem.type,
              uri: stem.uri,
              storageProvider: stem.storageProvider,
              mimeType: stem.mimeType,
              durationSeconds: stem.durationSeconds,
              isEncrypted: stem.isEncrypted,
              encryptionMetadata: stem.encryptionMetadata,
              source: "official",
              separationModel: null,
              audioRevision: currentTrack.activeAudioRevision,
              isCurrent: true,
            },
          });
          // A re-upload keeps the price the artist already set for that part.
          const pricing = pricingByType.get(stem.type);
          if (pricing) {
            await tx.stemPricing.create({
              data: {
                stemId: stem.id,
                basePlayPriceUsd: pricing.basePlayPriceUsd,
                remixLicenseUsd: pricing.remixLicenseUsd,
                commercialLicenseUsd: pricing.commercialLicenseUsd,
                floorUsd: pricing.floorUsd,
                ceilingUsd: pricing.ceilingUsd,
                listingDurationDays: pricing.listingDurationDays,
              },
            });
          }
        }
        return previous.length;
      }, { timeout: 15_000 });

      this.catalogService.invalidateCache();
      logger.log(
        `Official stems stored for track ${trackId} of release ${releaseId}: ${stored.map((stem) => stem.type).join(", ")}`,
      );
      return {
        releaseId,
        trackId,
        stems: stored.map((stem) => ({
          id: stem.id,
          type: stem.type,
          source: "official" as const,
          mimeType: stem.mimeType,
          durationSeconds: stem.durationSeconds,
          sampleRate: stem.sampleRate,
          isEncrypted: stem.isEncrypted,
        })),
        replaced,
        summedLevel,
      };
    } catch (error) {
      await Promise.all(
        stored.map((stem) => this.storageProvider.delete(stem.uri).catch(() => undefined)),
      );
      throw error;
    }
  }

  private async loadMixBuffer(mix: {
    uri: string;
    data: Uint8Array | Buffer | null;
  }): Promise<Buffer | null> {
    if (mix.data && mix.data.length > 0) {
      return Buffer.isBuffer(mix.data) ? mix.data : Buffer.from(mix.data);
    }
    try {
      return await this.encryptionService.loadSourceBuffer(mix.uri);
    } catch {
      return null;
    }
  }

  /**
   * Runs every check of an official package: decodes the published mix (its
   * duration is the reference), applies the per-file rules, and only then
   * decodes the stems for the silence and summed-level checks.
   */
  private async check(input: {
    mixBuffer: Buffer;
    mixMimeType: string | null;
    mixDurationFallback: number | null;
    candidates: OfficialStemCandidate[];
    buffers: Map<string, Buffer>;
  }): Promise<{ issues: OfficialStemIssue[]; summedLevel: OfficialStemUploadResult["summedLevel"] }> {
    const { candidates, buffers } = input;
    const directory = await mkdtemp(join(tmpdir(), "resonate-official-stems-"));
    try {
      const mixPath = join(directory, `mix.${stemFileExtension(input.mixMimeType)}`);
      await writeFile(mixPath, input.mixBuffer);
      let mixSamples: Float32Array;
      try {
        mixSamples = await decodeMonoSamples(mixPath);
      } catch (error) {
        logger.error(`Could not decode the published mix: ${(error as Error)?.message}`);
        throw new ServiceUnavailableException({
          code: "official_stems_checks_unavailable",
          message: "Audio checks are unavailable right now. Try again later",
        });
      }
      const decodedMixSeconds = mixSamples.length / OFFICIAL_STEM_ANALYSIS_SAMPLE_RATE;
      const mixDuration = decodedMixSeconds > 0 ? decodedMixSeconds : input.mixDurationFallback;

      const fileIssues = validateOfficialStemFiles({ mixDurationSeconds: mixDuration, stems: candidates });
      if (fileIssues.length > 0) return { issues: fileIssues, summedLevel: null };

      const issues: OfficialStemIssue[] = [];
      const decoded: Float32Array[] = [];
      for (const candidate of candidates) {
        const container = officialStemContainer(candidate.audio.container) as "wav" | "flac";
        const path = join(directory, `${candidate.type}.${container}`);
        await writeFile(path, buffers.get(candidate.type) as Buffer);
        try {
          const samples = await decodeMonoSamples(path);
          candidate.rmsDb = rmsDb(samples);
          decoded.push(samples);
        } catch {
          issues.push({
            code: "unreadable_audio",
            stemType: candidate.type,
            message: `The ${candidate.type} (${candidate.fileName}) file could not be decoded as audio.`,
          });
        }
      }
      if (issues.length > 0) return { issues, summedLevel: null };

      const silent = validateOfficialStemSilence(candidates);
      if (silent.length > 0) return { issues: silent, summedLevel: null };

      const measure = measureSummedLevel(mixSamples, decoded);
      return {
        issues: validateSummedLevel(measure),
        summedLevel: {
          differenceDb: Math.round(measure.differenceDb * 10) / 10,
          envelopeCorrelation:
            measure.envelopeCorrelation === null
              ? null
              : Math.round(measure.envelopeCorrelation * 100) / 100,
        },
      };
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function strictestRoute(...routes: Array<string | null | undefined>): UploadRightsRoute | null {
  let strictest: UploadRightsRoute | null = null;
  for (const raw of routes) {
    if (!raw) continue;
    const route = raw as UploadRightsRoute;
    if (!strictest || compareRouteSeverity(route, strictest) > 0) strictest = route;
  }
  return strictest;
}
