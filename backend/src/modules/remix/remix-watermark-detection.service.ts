import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Prisma, RemixWatermarkDetection } from "@prisma/client";
import { createHash } from "crypto";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../../db/prisma";
import {
  REMIX_WATERMARK_DETECT_STAGES,
  RemixWatermarkDetector,
  remixWatermarkDetectorFromEnv,
  type RemixWatermarkCandidate,
} from "./remix-watermark-detect";

/**
 * What a match does and does not show (#2575). Shown with every result and
 * stored on the evidence item, so nobody reads a match as more than it is.
 */
export const REMIX_WATERMARK_MATCH_CAVEAT =
  "A match shows which remix render this audio came from. It does not show who uploaded or shared it elsewhere. " +
  "Read it together with the licence record for that render and the export history of the same remix project.";

/** Clips are short excerpts; 50 MB covers a 10-minute WAV. */
export const REMIX_WATERMARK_DETECT_MAX_CLIP_BYTES = 50 * 1024 * 1024;

/** A check that has not finished after this long was lost with its process. */
const INTERRUPTED_AFTER_MS = 30 * 60 * 1000;

export const REMIX_WATERMARK_EVIDENCE_SUBJECT_TYPES = ["dispute", "release", "track"] as const;
export type RemixWatermarkEvidenceSubjectType =
  (typeof REMIX_WATERMARK_EVIDENCE_SUBJECT_TYPES)[number];

export type RemixWatermarkDetectionStatus =
  | "pending"
  | "processing"
  | "matched"
  | "no_match"
  | "failed";

type DetectionWithRender = Prisma.RemixWatermarkDetectionGetPayload<{
  include: { renderWatermark: true };
}>;

/** What an admin sees. The token itself is never returned. */
export type RemixWatermarkDetectionView = {
  id: string;
  status: RemixWatermarkDetectionStatus;
  clipSha256: string;
  clipBytes: number;
  candidatesDecoded: number;
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
  evidenceId: string | null;
  caveat: string;
  match: {
    keyId: string | null;
    keySlot: string | null;
    stage: string | null;
    decodeError: number | null;
    syncQuality: number | null;
    occurrences: number | null;
    render: {
      id: string;
      remixProjectId: string;
      generationJobId: string;
      renderJobId: string;
      ownerUserId: string;
      sourceTrackId: string;
      secondarySourceTrackId: string | null;
      stemIds: string[];
      stemLicenses: unknown;
      renderedStemIndexes: number[];
      policyVersion: string;
      scheme: string;
      schemeVersion: string;
      renderedAt: string;
    };
  } | null;
};

function toView(row: DetectionWithRender): RemixWatermarkDetectionView {
  const render = row.renderWatermark;
  return {
    id: row.id,
    status: row.status as RemixWatermarkDetectionStatus,
    clipSha256: row.clipSha256,
    clipBytes: row.clipBytes,
    candidatesDecoded: row.candidatesDecoded,
    failureCode: row.failureCode,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    evidenceId: row.evidenceId,
    caveat: REMIX_WATERMARK_MATCH_CAVEAT,
    match:
      row.status === "matched" && render
        ? {
            keyId: row.keyId,
            keySlot: row.keySlot,
            stage: row.stage,
            decodeError: row.decodeError,
            syncQuality: row.syncQuality,
            occurrences: row.occurrences,
            render: {
              id: render.id,
              remixProjectId: render.remixProjectId,
              generationJobId: render.generationJobId,
              renderJobId: render.renderJobId,
              ownerUserId: render.userId,
              sourceTrackId: render.sourceTrackId,
              secondarySourceTrackId: render.secondarySourceTrackId,
              stemIds: render.stemIds,
              stemLicenses: render.stemLicenses,
              renderedStemIndexes: render.renderedStemIndexes,
              policyVersion: render.policyVersion,
              scheme: render.scheme,
              schemeVersion: render.schemeVersion,
              renderedAt: render.createdAt.toISOString(),
            },
          }
        : null,
  };
}

/**
 * Admin detection of the remix render watermark (#2575). A check is a row
 * plus a background run in this process: decoding takes seconds to minutes
 * (RFC "Cost"), too long for the request. The clip lives in a private temp
 * dir for the run and is deleted after it; the row keeps its hash and size.
 */
@Injectable()
export class RemixWatermarkDetectionService implements OnModuleInit {
  private readonly logger = new Logger(RemixWatermarkDetectionService.name);
  private detector: RemixWatermarkDetector | null | undefined;
  /** Runs in flight, for tests and orderly shutdown. */
  private readonly running = new Map<string, Promise<void>>();

  onModuleInit(): void {
    this.detector = remixWatermarkDetectorFromEnv(this.logger);
  }

  /** Test seam: replace the detector built from the environment. */
  useDetector(detector: RemixWatermarkDetector | null): void {
    this.detector = detector;
  }

  private requireDetector(): RemixWatermarkDetector {
    if (this.detector === undefined) this.detector = remixWatermarkDetectorFromEnv(this.logger);
    if (!this.detector) {
      throw new ServiceUnavailableException({
        code: "remix_watermark_not_configured",
        message: "No remix watermark key is configured, so there is nothing to detect with.",
      });
    }
    return this.detector;
  }

  status(): { configured: boolean; keyIds: string[]; maxClipBytes: number } {
    if (this.detector === undefined) this.detector = remixWatermarkDetectorFromEnv(this.logger);
    return {
      configured: Boolean(this.detector),
      keyIds: this.detector?.keyIds ?? [],
      maxClipBytes: REMIX_WATERMARK_DETECT_MAX_CLIP_BYTES,
    };
  }

  /** Records the check and starts it in the background. */
  async start(clip: Buffer | undefined): Promise<RemixWatermarkDetectionView> {
    if (!clip || clip.length === 0) {
      throw new BadRequestException("Attach an audio clip to check.");
    }
    if (clip.length > REMIX_WATERMARK_DETECT_MAX_CLIP_BYTES) {
      throw new BadRequestException("The clip is too large to check.");
    }
    const detector = this.requireDetector();
    const row = await prisma.remixWatermarkDetection.create({
      data: {
        clipSha256: createHash("sha256").update(clip).digest("hex"),
        clipBytes: clip.length,
      },
      include: { renderWatermark: true },
    });
    const run = this.run(row.id, clip, detector)
      .catch((error: unknown) => {
        this.logger.error(
          `Remix watermark check ${row.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => this.running.delete(row.id));
    this.running.set(row.id, run);
    return toView(row);
  }

  /** Resolves when the background run of a check has finished. */
  async settled(id: string): Promise<void> {
    await this.running.get(id);
  }

  private async run(id: string, clip: Buffer, detector: RemixWatermarkDetector): Promise<void> {
    await prisma.remixWatermarkDetection.update({
      where: { id },
      data: { status: "processing", startedAt: new Date() },
    });
    const dir = await mkdtemp(join(tmpdir(), "remix-wmclip-"));
    try {
      const clipPath = join(dir, "clip");
      const wavPath = join(dir, "clip.wav");
      await writeFile(clipPath, clip, { mode: 0o600 });
      try {
        await detector.decodeClip(clipPath, wavPath);
      } catch {
        await this.finish(id, { status: "failed", failureCode: "decode_failed" });
        return;
      }
      const seen = new Set<string>();
      for (const stage of REMIX_WATERMARK_DETECT_STAGES) {
        let candidates: RemixWatermarkCandidate[];
        try {
          candidates = await detector.candidates(wavPath, stage);
        } catch (error) {
          this.logger.warn(
            `Remix watermark check ${id}: the ${stage} stage failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          await this.finish(id, {
            status: "failed",
            failureCode: "detector_failed",
            candidatesDecoded: seen.size,
          });
          return;
        }
        for (const candidate of candidates) seen.add(candidate.payload);
        const hit = await this.matchCandidates(candidates);
        if (hit) {
          await this.finish(id, {
            status: "matched",
            candidatesDecoded: seen.size,
            renderWatermarkId: hit.renderWatermarkId,
            keyId: hit.candidate.keyId,
            keySlot: hit.candidate.keySlot,
            stage: hit.candidate.stage,
            decodeError: hit.candidate.decodeError,
            syncQuality: hit.candidate.syncQuality,
            occurrences: hit.candidate.occurrences,
          });
          return;
        }
      }
      await this.finish(id, { status: "no_match", candidatesDecoded: seen.size });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Only a decoded payload equal to a stored token, decoded with the key that
   * render was embedded with, is a match. Of several, the best-synced wins.
   */
  private async matchCandidates(
    candidates: RemixWatermarkCandidate[],
  ): Promise<{ candidate: RemixWatermarkCandidate; renderWatermarkId: string } | null> {
    if (candidates.length === 0) return null;
    const rows = await prisma.remixRenderWatermark.findMany({
      where: { token: { in: [...new Set(candidates.map((candidate) => candidate.payload))] } },
      select: { id: true, token: true, keyId: true },
    });
    const hits = candidates
      .map((candidate) => ({
        candidate,
        row: rows.find((row) => row.token === candidate.payload && row.keyId === candidate.keyId),
      }))
      .filter((hit): hit is { candidate: RemixWatermarkCandidate; row: (typeof rows)[number] } =>
        Boolean(hit.row),
      )
      .sort((a, b) => (b.candidate.syncQuality ?? 0) - (a.candidate.syncQuality ?? 0));
    return hits[0] ? { candidate: hits[0].candidate, renderWatermarkId: hits[0].row.id } : null;
  }

  private async finish(
    id: string,
    data: Partial<RemixWatermarkDetection> & { status: RemixWatermarkDetectionStatus },
  ): Promise<void> {
    await prisma.remixWatermarkDetection.update({
      where: { id },
      data: { ...data, completedAt: new Date() },
    });
  }

  async get(id: string): Promise<RemixWatermarkDetectionView> {
    let row = await prisma.remixWatermarkDetection.findUnique({
      where: { id },
      include: { renderWatermark: true },
    });
    if (!row) throw new NotFoundException("Remix watermark check not found");
    const unfinished = row.status === "pending" || row.status === "processing";
    if (
      unfinished &&
      !this.running.has(id) &&
      Date.now() - row.createdAt.getTime() > INTERRUPTED_AFTER_MS
    ) {
      // The process that held the clip is gone; the clip went with it.
      row = await prisma.remixWatermarkDetection.update({
        where: { id },
        data: { status: "failed", failureCode: "interrupted", completedAt: new Date() },
        include: { renderWatermark: true },
      });
    }
    return toView(row);
  }

  async list(limit = 20): Promise<RemixWatermarkDetectionView[]> {
    const rows = await prisma.remixWatermarkDetection.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 50),
      include: { renderWatermark: true },
    });
    return rows.map(toView);
  }

  /**
   * Attaches a match as a typed evidence item (`remix_watermark_match`) on a
   * dispute, release or track. The item carries the render reference and the
   * decoder's figures, never the token or the owner's account id.
   */
  async attachEvidence(
    id: string,
    subject: { subjectType: string; subjectId: string },
    adminAddress: string,
  ): Promise<{ detection: RemixWatermarkDetectionView; bundleId: string; evidenceId: string }> {
    const subjectType = subject.subjectType as RemixWatermarkEvidenceSubjectType;
    if (!REMIX_WATERMARK_EVIDENCE_SUBJECT_TYPES.includes(subjectType)) {
      throw new BadRequestException("Evidence can attach to a dispute, a release or a track.");
    }
    const subjectId = subject.subjectId?.trim();
    if (!subjectId) throw new BadRequestException("subjectId is required");
    const exists =
      subjectType === "dispute"
        ? await prisma.dispute.findUnique({ where: { id: subjectId }, select: { id: true } })
        : subjectType === "release"
          ? await prisma.release.findUnique({ where: { id: subjectId }, select: { id: true } })
          : await prisma.track.findUnique({ where: { id: subjectId }, select: { id: true } });
    if (!exists) throw new NotFoundException(`No ${subjectType} with that id`);

    const row = await prisma.remixWatermarkDetection.findUnique({
      where: { id },
      include: { renderWatermark: true },
    });
    if (!row) throw new NotFoundException("Remix watermark check not found");
    const render = row.renderWatermark;
    if (row.status !== "matched" || !render) {
      throw new ConflictException({
        code: "remix_watermark_no_match",
        message: "Only a check that found a match can be attached as evidence.",
      });
    }
    if (row.evidenceId) {
      throw new ConflictException({
        code: "remix_watermark_already_attached",
        message: "This check is already attached as evidence.",
      });
    }

    const submittedByAddress = adminAddress.toLowerCase();
    const bundle = await prisma.$transaction(async (tx) => {
      const created = await tx.rightsEvidenceBundle.create({
        data: {
          subjectType,
          subjectId,
          submittedByRole: "ops",
          submittedByAddress,
          purpose: "ops_review",
          summary: "Remix watermark check",
          evidences: {
            create: [
              {
                subjectType,
                subjectId,
                submittedByRole: "ops",
                submittedByAddress,
                kind: "remix_watermark_match",
                title: "Remix watermark match",
                description: REMIX_WATERMARK_MATCH_CAVEAT,
                strength: "high",
                verificationStatus: "system_generated",
                metadata: {
                  detectionId: row.id,
                  clipSha256: row.clipSha256,
                  renderWatermarkId: render.id,
                  remixProjectId: render.remixProjectId,
                  generationJobId: render.generationJobId,
                  renderJobId: render.renderJobId,
                  sourceTrackId: render.sourceTrackId,
                  secondarySourceTrackId: render.secondarySourceTrackId,
                  renderedAt: render.createdAt.toISOString(),
                  scheme: render.scheme,
                  schemeVersion: render.schemeVersion,
                  keyId: row.keyId,
                  keySlot: row.keySlot,
                  stage: row.stage,
                  decodeError: row.decodeError,
                  syncQuality: row.syncQuality,
                  occurrences: row.occurrences,
                },
              },
            ],
          },
        },
        include: { evidences: true },
      });
      const claimed = await tx.remixWatermarkDetection.updateMany({
        where: { id: row.id, evidenceId: null },
        data: { evidenceId: created.evidences[0].id },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: "remix_watermark_already_attached",
          message: "This check is already attached as evidence.",
        });
      }
      return created;
    });
    return {
      detection: await this.get(id),
      bundleId: bundle.id,
      evidenceId: bundle.evidences[0].id,
    };
  }
}
