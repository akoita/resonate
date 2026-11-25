import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { auditAdminBranch } from "../admin_audit/admin_branch_audit";
import { hasReleaseManagementAccess } from "../management/management-access";
import {
  CompositionData,
  CompositionValidationError,
  CompositionWriter,
  formatIswc,
  normalizeCompositionInput,
  publicWriters,
  readStoredWriters,
} from "./composition";

/** Release states and rights routes a signed-out reader may see (as the public catalog lists them). */
const PUBLIC_RELEASE_STATUSES = ["ready", "published"];
const PUBLIC_RELEASE_ROUTES = ["LIMITED_MONITORING", "STANDARD_ESCROW", "TRUSTED_FAST_PATH"];

/** Longest window the usage export covers, and the most rows it returns. */
export const USAGE_EXPORT_MAX_DAYS = 366;
export const USAGE_EXPORT_MAX_ROWS = 20000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CompositionViewer {
  userId?: string;
  role?: string;
}

export interface StoredComposition {
  writers: CompositionWriter[];
  publisher: string | null;
  selfPublished: boolean;
  iswc: string | null;
  coverOrSamples: boolean;
  coverNote: string | null;
  updatedAt: string;
}

type CompositionRow = {
  trackId: string;
  writers: Prisma.JsonValue;
  publisher: string | null;
  selfPublished: boolean;
  iswc: string | null;
  coverOrSamples: boolean;
  coverNote: string | null;
  updatedAt: Date;
};

function toStored(row: CompositionRow): StoredComposition {
  return {
    writers: readStoredWriters(row.writers),
    publisher: row.publisher,
    selfPublished: row.selfPublished,
    iswc: row.iswc,
    coverOrSamples: row.coverOrSamples,
    coverNote: row.coverNote,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toWriteData(data: CompositionData) {
  return {
    writers: data.writers as unknown as Prisma.InputJsonValue,
    publisher: data.publisher,
    selfPublished: data.selfPublished,
    iswc: data.iswc,
    coverOrSamples: data.coverOrSamples,
    coverNote: data.coverNote,
  };
}

/** Parses upload/editor input, turning rule failures into 400s. */
export function parseCompositionOrThrow(input: unknown): CompositionData | null {
  try {
    return normalizeCompositionInput(input);
  } catch (error) {
    if (error instanceof CompositionValidationError) throw new BadRequestException(error.message);
    throw error;
  }
}

/**
 * A spreadsheet opens a cell that starts with = + - @ (or a tab or carriage
 * return) as a formula. Writer names and notes are typed by artists, so such
 * cells are prefixed with a quote.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writersCell(writers: CompositionWriter[]): string {
  return writers
    .map((writer) =>
      [writer.name, writer.role, writer.share ?? "", writer.society ?? "", writer.ipi ?? ""].join(" | "),
    )
    .join("; ");
}

/**
 * Composition details per track (#2669). The artist (or a manager with the
 * track-metadata scope) writes them; the artist, managers and operators read
 * them in full; everyone else sees writer names and roles on a public release.
 */
@Injectable()
export class CompositionService {
  async getForRelease(releaseId: string, viewer: CompositionViewer) {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      select: {
        id: true,
        status: true,
        rightsRoute: true,
        artist: { select: { userId: true } },
        tracks: {
          orderBy: { position: "asc" },
          select: { id: true, title: true, position: true, composition: true },
        },
      },
    });
    if (!release) throw new NotFoundException("Release not found");

    const isOperator = viewer.role === "admin" || viewer.role === "operator";
    const canEdit = viewer.userId
      ? await hasReleaseManagementAccess(viewer.userId, releaseId, "track_metadata")
      : false;
    const full = isOperator || canEdit;

    if (!full) {
      const isPublic =
        PUBLIC_RELEASE_STATUSES.includes(release.status) &&
        (release.rightsRoute === null || PUBLIC_RELEASE_ROUTES.includes(release.rightsRoute));
      if (!isPublic) throw new NotFoundException("Release not found");
      return {
        releaseId,
        access: "public" as const,
        canEdit: false,
        tracks: release.tracks.map((track) => ({
          trackId: track.id,
          title: track.title,
          position: track.position,
          writers: track.composition ? publicWriters(readStoredWriters(track.composition.writers)) : [],
        })),
      };
    }

    if (!canEdit) {
      // #2380: an operator reading someone else's composition details is recorded.
      await auditAdminBranch(viewer, "composition.support_viewed", {
        targetUserId: release.artist?.userId ?? null,
        detail: { releaseId },
      });
    }

    return {
      releaseId,
      access: "full" as const,
      canEdit,
      tracks: release.tracks.map((track) => ({
        trackId: track.id,
        title: track.title,
        position: track.position,
        composition: track.composition ? toStored(track.composition) : null,
      })),
    };
  }

  /** Replaces a track's composition; empty input removes it. */
  async saveForTrack(releaseId: string, trackId: string, userId: string, input: unknown) {
    const data = parseCompositionOrThrow(input);
    return prisma.$transaction(async (tx) => {
      const track = await this.lockEditableTrack(tx, releaseId, trackId, userId);
      if (!data) {
        await tx.trackComposition.deleteMany({ where: { trackId: track.id } });
        return { trackId: track.id, composition: null };
      }
      const row = await tx.trackComposition.upsert({
        where: { trackId: track.id },
        create: { trackId: track.id, artistId: track.artistId, ...toWriteData(data) },
        update: { artistId: track.artistId, ...toWriteData(data) },
      });
      return { trackId: track.id, composition: toStored(row) };
    });
  }

  /**
   * Copies one track's composition to every other track of the release,
   * replacing what they had. Returns how many tracks were updated.
   */
  async copyToRelease(releaseId: string, trackId: string, userId: string) {
    return prisma.$transaction(async (tx) => {
      const track = await this.lockEditableTrack(tx, releaseId, trackId, userId);
      const source = await tx.trackComposition.findUnique({ where: { trackId: track.id } });
      if (!source) throw new BadRequestException("This track has no composition details to copy yet.");
      const others = await tx.track.findMany({
        where: { releaseId, id: { not: track.id } },
        select: { id: true },
      });
      const data = {
        writers: source.writers as Prisma.InputJsonValue,
        publisher: source.publisher,
        selfPublished: source.selfPublished,
        iswc: null,
        coverOrSamples: source.coverOrSamples,
        coverNote: source.coverNote,
      };
      for (const other of others) {
        await tx.trackComposition.upsert({
          where: { trackId: other.id },
          create: { trackId: other.id, artistId: track.artistId, ...data },
          update: { artistId: track.artistId, ...data },
        });
      }
      return { copiedTo: others.length };
    });
  }

  /**
   * Operator usage report: one line per track played in the window, with the
   * recording code, the work code and the writers. Plays come from playback
   * facts, which exist only for listeners who allowed product analytics.
   */
  async usageExport(fromInput?: string, toInput?: string) {
    const to = toInput ? new Date(toInput) : new Date();
    const from = fromInput ? new Date(fromInput) : new Date(to.getTime() - 30 * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException("Use dates like 2026-12-01.");
    }
    if (from >= to) throw new BadRequestException("The start date must be before the end date.");
    if (to.getTime() - from.getTime() > USAGE_EXPORT_MAX_DAYS * DAY_MS) {
      throw new BadRequestException(`A report covers at most ${USAGE_EXPORT_MAX_DAYS} days.`);
    }

    const plays = await prisma.$queryRaw<Array<{ trackId: string; started: number; completed: number }>>`
      SELECT "subjectId" AS "trackId",
        COUNT(*) FILTER (WHERE "eventName" = 'playback.started')::int AS "started",
        COUNT(*) FILTER (WHERE "eventName" = 'playback.completed')::int AS "completed"
      FROM "AnalyticsEvent"
      WHERE "subjectType" = 'track'
        AND "eventName" IN ('playback.started', 'playback.completed')
        AND "subjectId" IS NOT NULL
        AND "occurredAt" >= ${from}
        AND "occurredAt" < ${to}
      GROUP BY "subjectId"
      ORDER BY "subjectId"
      LIMIT ${USAGE_EXPORT_MAX_ROWS + 1}
    `;
    const truncated = plays.length > USAGE_EXPORT_MAX_ROWS;
    const counted = plays.slice(0, USAGE_EXPORT_MAX_ROWS);

    const tracks = counted.length
      ? await prisma.track.findMany({
          where: { id: { in: counted.map((row) => row.trackId) } },
          select: {
            id: true,
            title: true,
            artist: true,
            isrc: true,
            composition: true,
            release: { select: { id: true, title: true, primaryArtist: true } },
          },
        })
      : [];
    const byId = new Map(tracks.map((track) => [track.id, track]));

    const header = [
      "period_start",
      "period_end",
      "track_id",
      "release_id",
      "release_title",
      "track_title",
      "performer",
      "isrc",
      "iswc",
      "writers (name | role | share | society | ipi)",
      "publisher",
      "cover_or_samples",
      "plays_started",
      "plays_completed",
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const row of counted) {
      const track = byId.get(row.trackId);
      if (!track) continue;
      const composition = track.composition;
      const writers = composition ? readStoredWriters(composition.writers) : [];
      lines.push(
        [
          from.toISOString(),
          to.toISOString(),
          track.id,
          track.release.id,
          track.release.title,
          track.title,
          track.artist ?? track.release.primaryArtist ?? "",
          track.isrc ?? "",
          composition?.iswc ? formatIswc(composition.iswc) : "",
          writersCell(writers),
          composition?.selfPublished ? "self-published" : composition?.publisher ?? "",
          composition?.coverOrSamples ? "yes" : "no",
          row.started,
          row.completed,
        ]
          .map(csvCell)
          .join(","),
      );
    }

    return {
      csv: `${lines.join("\r\n")}\r\n`,
      rows: lines.length - 1,
      truncated,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  private async lockEditableTrack(
    tx: Prisma.TransactionClient,
    releaseId: string,
    trackId: string,
    userId: string,
  ) {
    await tx.$queryRaw`SELECT "id" FROM "Release" WHERE "id" = ${releaseId} FOR UPDATE`;
    if (!(await hasReleaseManagementAccess(userId, releaseId, "track_metadata", tx))) {
      throw new ForbiddenException("Not authorized to manage this release");
    }
    const track = await tx.track.findFirst({
      where: { id: trackId, releaseId },
      select: { id: true, release: { select: { artistId: true } } },
    });
    if (!track) throw new NotFoundException("Track not found for this release.");
    return { id: track.id, artistId: track.release.artistId };
  }
}
