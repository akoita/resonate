import { createHash } from "node:crypto";
import { Injectable, Optional } from "@nestjs/common";
import { ManagementGrantStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../analytics/analytics_consent.service";
import { classifyTrackAvailability, isPlayableAvailability, WITHDRAWABLE_RELEASE_STATUSES } from "../catalog/track-availability";
import { measuredTrackFeatures } from "../agents/measured_track_features";
import { getAgentTrackLimit } from "../agents/agent_runtime.config";
import type { AgentRequestCoverage, AgentSessionRequest } from "../agents/agent_session_request";
import { canonicalCrateGenre } from "../crates/crate_filters";
import type { CrateCandidateFacts, CrateCoverage, CrateFilters } from "../crates/crate.types";
import { SceneScoutEntitlementsService, sceneScoutMinimumAudience } from "./scene_scout.service";
import {
  type UnmetDemandKind,
  type UnmetDemandResult,
  type UnmetDemandRow,
  type UnmetDemandSource,
  type UnmetDemandTargetType,
  type UnmetDemandWindowDays,
} from "./unmet_demand.contracts";
import {
  deriveCrateUnmetDemand,
  deriveSessionUnmetDemand,
  type CandidateDemandDraft,
  type SessionDemandCandidate,
} from "./unmet_demand.derivation";

const DAY_MS = 24 * 60 * 60 * 1000;
export const UNMET_DEMAND_READ_CAP = 20_000;
export const UNMET_DEMAND_CATALOG_CAP = 500;
export const UNMET_DEMAND_MAX_PURGE_BATCH = 1_000;
export const UNMET_DEMAND_USER_WINDOW_CAP = 100;
const WINDOWS: readonly UnmetDemandWindowDays[] = [7, 28];
const SOURCE_DRAFT_CAP = 100;

type CatalogTrack = {
  id: string;
  title: string;
  releaseId: string;
  contentStatus: string;
  processingStatus: string;
  rightsRoute: string | null;
  release: {
    id: string;
    artistId: string;
    title: string;
    status: string;
    rightsRoute: string | null;
    withdrawnAt: Date | null;
    withdrawalReason: string | null;
    releaseDate: Date | null;
    managementOwnerUserId: string | null;
    genre: string | null;
    moods: string[];
    artist: { userId: string | null; managementOwnerUserId: string | null };
  };
  stems?: Array<{ audioFeatures: Prisma.JsonValue | null }>;
};

type ManagerGrant = {
  artistId: string | null;
  releaseId: string | null;
  granteeUserId: string;
};

type DemandObservationRecord = Prisma.DemandObservationGetPayload<{}>;

type ObservationDraft = {
  userId: string;
  sourceType: "crate" | "session";
  sourceKey: string;
  targetArtistId: string;
  targetId: string;
  targetType: UnmetDemandTargetType;
  evidenceTrackId: string;
  kind: UnmetDemandKind;
  value: string;
  consentDecidedAt: Date;
  tastePolicyUpdatedAt: Date | null;
  observedAt: Date;
  expiresAt: Date;
};

type AggregateBucket = {
  targetType: UnmetDemandTargetType;
  targetId: string;
  kind: UnmetDemandKind;
  value: string;
  requesters: Set<string>;
  sources: Set<string>;
};

function validDate(value: Date | undefined, fallback = new Date()): Date {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : fallback;
}

function sourceDigest(userId: string, sourceType: "crate" | "session", sourceId: string): string {
  return createHash("sha256").update(`${sourceType}\u0000${userId}\u0000${sourceId}`).digest("hex");
}

function isAvailableTrack(track: CatalogTrack, now = new Date()): boolean {
  return track.contentStatus === "clean" &&
    track.processingStatus === "complete" &&
    track.release.withdrawnAt === null &&
    (track.release.releaseDate === null || track.release.releaseDate.getTime() <= now.getTime()) &&
    isPlayableAvailability(classifyTrackAvailability(track));
}

function trackSelect() {
  return {
    id: true,
    title: true,
    releaseId: true,
    contentStatus: true,
    processingStatus: true,
    rightsRoute: true,
    release: {
      select: {
        id: true,
        artistId: true,
        title: true,
        status: true,
        rightsRoute: true,
        withdrawnAt: true,
        withdrawalReason: true,
        releaseDate: true,
        managementOwnerUserId: true,
        genre: true,
        moods: true,
        artist: { select: { userId: true, managementOwnerUserId: true } },
      },
    },
  } as const;
}

function sessionTrackSelect() {
  return {
    ...trackSelect(),
    stems: {
      where: { isCurrent: true, type: { equals: "original", mode: "insensitive" as const } },
      take: 1,
      select: { audioFeatures: true },
    },
  } as const;
}

function observationKey(row: Pick<ObservationDraft, "sourceKey" | "targetType" | "targetId" | "kind" | "value">) {
  return `${row.sourceKey}\u0000${row.targetType}\u0000${row.targetId}\u0000${row.kind}\u0000${row.value}`;
}

@Injectable()
export class UnmetDemandService implements UnmetDemandSource {
  private readonly entitlements: SceneScoutEntitlementsService;

  constructor(@Optional() entitlements?: SceneScoutEntitlementsService) {
    this.entitlements = entitlements ?? new SceneScoutEntitlementsService();
  }

  /** Record categorical single-filter crate gaps after canonical track ownership is rechecked. */
  async recordCrateRequest(input: {
    userId: string;
    requestId: string;
    observedAt: Date;
    filters: CrateFilters;
    coverage: CrateCoverage;
    considered: readonly CrateCandidateFacts[];
    candidatePoolComplete: boolean;
  }): Promise<number> {
    const observedAt = validDate(input.observedAt);
    await this.purgeExpired({ now: observedAt });
    if (!input.candidatePoolComplete) return 0;
    const decision = await this.currentConsent(input.userId);
    if (!decision || decision.decidedAt.getTime() > observedAt.getTime()) return 0;

    const derived = deriveCrateUnmetDemand({
      filters: input.filters,
      considered: input.considered,
      coverage: input.coverage,
    });
    return this.persistDerived({
      userId: input.userId,
      sourceId: input.requestId,
      sourceType: "crate",
      observedAt,
      consentDecidedAt: decision.decidedAt,
      drafts: derived.candidates,
      requestedGenres: derived.requestedGenres,
    });
  }

  /**
   * Record a short-session gap from either deterministic or ADK runtime output.
   * The returned ids are resolved against the playable catalog; a client id or
   * runtime's claimed shortfall never becomes a catalog fact.
   */
  async recordSessionShortfall(input: {
    userId: string;
    sessionId: string;
    resultStatus: "approved" | "no_tracks" | "rejected" | "all_rejected" | string;
    observedAt: Date;
    request?: AgentSessionRequest;
    requestedCount?: number;
    foundTrackIds: readonly string[];
    requestCoverage?: AgentRequestCoverage;
  }): Promise<number> {
    const observedAt = validDate(input.observedAt);
    await this.purgeExpired({ now: observedAt });
    if (input.resultStatus !== "approved" && input.resultStatus !== "no_tracks") return 0;
    const decision = await this.currentConsent(input.userId);
    if (!decision || decision.decidedAt.getTime() > observedAt.getTime() || !input.request) return 0;

    const taste = await prisma.listenerTasteMemorySettings.findUnique({
      where: { userId: input.userId },
      select: { agentPlaybackTrainingEnabled: true, resetAt: true, updatedAt: true },
    });
    if (
      taste?.agentPlaybackTrainingEnabled === false ||
      (taste?.resetAt && observedAt.getTime() <= taste.resetAt.getTime())
    ) return 0;

    const maxPicks = getAgentTrackLimit();
    const requestedCount = Number.isSafeInteger(input.requestedCount) && input.requestedCount! > 0
      ? Math.min(maxPicks, input.requestedCount!)
      : maxPicks;
    const selectedIds = [...new Set(input.foundTrackIds.filter((id) => typeof id === "string" && id.length > 0))];
    if (selectedIds.length > maxPicks) return 0;
    if (input.resultStatus === "no_tracks" && selectedIds.length > 0) return 0;
    if (input.resultStatus === "approved" && selectedIds.length === 0) return 0;

    const selectedRows = selectedIds.length > 0
      ? await prisma.track.findMany({ where: { id: { in: selectedIds } }, take: maxPicks + 1, select: sessionTrackSelect() })
      : [];
    if (selectedRows.some((row) => row.release.artistId === "")) return 0;
    const selectedAvailable = selectedRows.filter((row) => isAvailableTrack(row as CatalogTrack, observedAt));
    const canonicalIds = new Set(selectedAvailable.map((row) => row.id));
    const canonicalFoundCount = canonicalIds.size;
    if (selectedIds.length > 0 && canonicalFoundCount !== selectedIds.length) return 0;
    const shortfall = Math.max(0, requestedCount - canonicalFoundCount);
    if (shortfall === 0) return 0;

    const requestCoverage = input.requestCoverage && selectedAvailable.length > 0
      ? input.requestCoverage
      : undefined;
    const selectedCandidates = selectedAvailable.map(sessionCandidateFromTrack);
    let derived = deriveSessionUnmetDemand({
      request: input.request,
      candidates: selectedCandidates,
      shortfall,
      requestCoverage,
    });

    // ADK output has no coverage and may return zero picks. Inspect a bounded,
    // canonical catalog slice to find one-filter near matches; an overflow is
    // incomplete evidence, so this source contributes nothing.
    if (derived.candidates.length === 0 && shortfall > 0) {
      const pool = await this.loadSessionCandidatePool(observedAt);
      if (pool.truncated) return 0;
      derived = deriveSessionUnmetDemand({
        request: input.request,
        candidates: pool.candidates,
        shortfall,
      });
    }

    return this.persistDerived({
      userId: input.userId,
      sourceId: input.sessionId,
      sourceType: "session",
      observedAt,
      consentDecidedAt: decision.decidedAt,
      tastePolicyUpdatedAt: taste?.updatedAt ?? null,
      drafts: derived.candidates,
      requestedGenres: derived.requestedGenres,
    });
  }

  /** Recompute from current, consented observations before serving any snapshot. */
  async getArtistUnmetDemand(
    artistId: string,
    options: { now?: Date } = {},
  ): Promise<UnmetDemandResult> {
    const now = validDate(options.now);
    await this.purgeExpired({ now });
    if (!(await this.entitlements.canRead(artistId))) {
      await this.replaceSnapshots(artistId, []);
      return {
        status: "unavailable",
        reason: "Scene Scout is not included in this artist's current access.",
        demand: [],
      };
    }

    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: { id: true, userId: true, managementOwnerUserId: true },
    });
    if (!artist) {
      await this.replaceSnapshots(artistId, []);
      return { status: "thin_data", reason: "This artist is no longer available for Scene Scout.", demand: [] };
    }

    const from28 = new Date(now.getTime() - 28 * DAY_MS);
    const observations = await prisma.demandObservation.findMany({
      where: {
        targetArtistId: artistId,
        observedAt: { gte: from28, lte: now },
        expiresAt: { gte: now },
      },
      orderBy: [{ observedAt: "asc" }, { id: "asc" }],
      take: UNMET_DEMAND_READ_CAP + 1,
    });
    if (observations.length > UNMET_DEMAND_READ_CAP) {
      await this.replaceSnapshots(artistId, []);
      return {
        status: "thin_data",
        reason: "The recent request history is too large to verify completely, so no demand estimates are shown.",
        demand: [],
      };
    }
    if (observations.length === 0) {
      await this.replaceSnapshots(artistId, []);
      return { status: "thin_data", reason: "Not enough recent request data yet to show unmet demand.", demand: [] };
    }

    const current = await this.loadCurrentReadContext(artistId, observations, now);
    if (current.incomplete) {
      await this.replaceSnapshots(artistId, []);
      return {
        status: "thin_data",
        reason: "Scene Scout could not verify current permissions and catalog ownership completely, so no demand estimates are shown.",
        demand: [],
      };
    }

    const buckets = new Map<string, AggregateBucket>();
    const windowsFrom = new Map(WINDOWS.map((window) => [window, new Date(now.getTime() - window * DAY_MS)]));
    for (const observation of observations) {
      if (!this.observationIsCurrent(observation, current, artist, now)) continue;
      const track = current.tracks.get(observation.evidenceTrackId ?? "");
      if (!track || !isAvailableTrack(track, now) || track.release.artistId !== artistId) continue;
      if (observation.targetType === "track" && observation.targetId !== track.id) continue;
      if (observation.targetType === "artist" && observation.targetId !== track.release.artistId) continue;
      if (observation.targetType === "genre") {
        if (observation.targetId !== track.release.artistId || canonicalExactGenre(track.release.genre) !== observation.value) continue;
      }

      for (const windowDays of WINDOWS) {
        if (observation.observedAt < windowsFrom.get(windowDays)! || observation.observedAt > now) continue;
        const key = `${observation.targetType}\u0000${observation.targetId}\u0000${observation.kind}\u0000${observation.value}\u0000${windowDays}`;
        const bucket = buckets.get(key) ?? {
          targetType: observation.targetType as UnmetDemandTargetType,
          targetId: observation.targetId,
          kind: observation.kind as UnmetDemandKind,
          value: observation.value,
          requesters: new Set<string>(),
          sources: new Set<string>(),
        };
        bucket.requesters.add(observation.userId);
        bucket.sources.add(`${observation.userId}\u0000${observation.sourceKey}`);
        buckets.set(key, bucket);
      }
    }

    const rows: UnmetDemandRow[] = [];
    const snapshots: Prisma.DemandSignalCreateManyInput[] = [];
    for (const [key, bucket] of buckets) {
      const distinctRequesters = bucket.requesters.size;
      if (!Number.isSafeInteger(distinctRequesters) || distinctRequesters < sceneScoutMinimumAudience()) continue;
      const windowDays = Number(key.slice(key.lastIndexOf("\u0000") + 1)) as UnmetDemandWindowDays;
      const requestCount = bucket.sources.size;
      const row: UnmetDemandRow = {
        targetType: bucket.targetType,
        kind: bucket.kind,
        value: bucket.value,
        windowDays,
        distinctRequesters,
        requestCount,
        computedAt: now,
      };
      if (bucket.targetType === "track") {
        const track = current.tracks.get(bucket.targetId);
        if (!track || track.release.artistId !== artistId) continue;
        row.trackId = track.id;
        row.releaseId = track.releaseId;
        row.trackTitle = track.title;
      }
      snapshots.push({
        artistId,
        targetType: bucket.targetType,
        targetId: bucket.targetId,
        kind: bucket.kind,
        value: bucket.value,
        windowDays,
        distinctRequesters,
        requestCount,
        computedAt: now,
      });
      rows.push(row);
    }

    await this.replaceSnapshots(artistId, snapshots);
    rows.sort((a, b) =>
      b.windowDays - a.windowDays ||
      b.requestCount - a.requestCount ||
      b.distinctRequesters - a.distinctRequesters ||
      a.kind.localeCompare(b.kind) ||
      a.value.localeCompare(b.value),
    );
    if (rows.length === 0) {
      return {
        status: "thin_data",
        reason: `Not enough current-consent requesters yet. At least ${sceneScoutMinimumAudience()} people are needed to show demand.`,
        demand: [],
      };
    }
    return { status: "ready", demand: rows };
  }

  /** Delete at most 1,000 expired raw observations per opportunistic call. */
  async purgeExpired(options: { now?: Date; limit?: number } = {}): Promise<number> {
    const now = validDate(options.now);
    const requestedLimit = Number.isSafeInteger(options.limit) && (options.limit ?? 0) > 0
      ? options.limit!
      : UNMET_DEMAND_MAX_PURGE_BATCH;
    const limit = Math.min(UNMET_DEMAND_MAX_PURGE_BATCH, requestedLimit);
    const expired = await prisma.demandObservation.findMany({
      where: { expiresAt: { lt: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true },
    });
    if (expired.length === 0) return 0;
    const deleted = await prisma.demandObservation.deleteMany({ where: { id: { in: expired.map((row) => row.id) } } });
    return deleted.count;
  }

  private async currentConsent(userId: string) {
    return prisma.analyticsConsent.findUnique({
      where: { userId },
      select: { productAnalytics: true, policyVersion: true, decidedAt: true },
    }).then((row) => row && row.productAnalytics && row.policyVersion === ANALYTICS_CONSENT_POLICY_VERSION
      ? { decidedAt: row.decidedAt }
      : null);
  }

  private async persistDerived(input: {
    userId: string;
    sourceId: string;
    sourceType: "crate" | "session";
    observedAt: Date;
    consentDecidedAt: Date;
    tastePolicyUpdatedAt?: Date | null;
    drafts: readonly CandidateDemandDraft[];
    requestedGenres: readonly string[];
  }): Promise<number> {
    const drafts = input.drafts.slice(0, SOURCE_DRAFT_CAP);
    const candidateIds = [...new Set(drafts.map((draft) => draft.candidateTrackId))].slice(0, UNMET_DEMAND_CATALOG_CAP);
    const candidates = candidateIds.length > 0
      ? await prisma.track.findMany({ where: { id: { in: candidateIds } }, take: UNMET_DEMAND_CATALOG_CAP + 1, select: trackSelect() })
      : [];
    const tracksById = new Map(candidates.map((row) => [row.id, row as CatalogTrack]));

    const genreTargets = await this.resolveGenreTargets(input.requestedGenres, input.observedAt);
    if (genreTargets.truncated) return 0;
    const sourceKey = sourceDigest(input.userId, input.sourceType, input.sourceId);
    const expiresAt = new Date(input.observedAt.getTime() + 28 * DAY_MS);
    const rawDrafts = new Map<string, ObservationDraft>();
    const add = (data: Omit<ObservationDraft, "userId" | "sourceType" | "sourceKey" | "consentDecidedAt" | "tastePolicyUpdatedAt" | "observedAt" | "expiresAt">) => {
      const row: ObservationDraft = {
        ...data,
        userId: input.userId,
        sourceType: input.sourceType,
        sourceKey,
        consentDecidedAt: input.consentDecidedAt,
        tastePolicyUpdatedAt: input.sourceType === "session" ? input.tastePolicyUpdatedAt ?? null : null,
        observedAt: input.observedAt,
        expiresAt,
      };
      const key = observationKey(row);
      if (!rawDrafts.has(key)) rawDrafts.set(key, row);
    };

    for (const draft of drafts) {
      const track = tracksById.get(draft.candidateTrackId);
      if (!track || !isAvailableTrack(track, input.observedAt)) continue;
      const targetType = draft.targetType;
      add({
        targetArtistId: track.release.artistId,
        targetId: targetType === "track" ? track.id : track.release.artistId,
        targetType,
        evidenceTrackId: track.id,
        kind: draft.kind,
        value: draft.value,
      });
    }
    for (const target of genreTargets.targets) {
      add({
        targetArtistId: target.artistId,
        targetId: target.artistId,
        targetType: "genre",
        evidenceTrackId: target.evidenceTrackId,
        kind: "genre",
        value: target.genre,
      });
    }
    if (rawDrafts.size === 0) return 0;

    const records = [...rawDrafts.values()];
    const sourceTracks = new Map<string, CatalogTrack>();
    for (const row of records) {
      const track = tracksById.get(row.evidenceTrackId) ?? genreTargets.trackById.get(row.evidenceTrackId);
      if (track) sourceTracks.set(track.id, track);
    }
    if (sourceTracks.size !== new Set(records.map((row) => row.evidenceTrackId)).size) return 0;

    const managerContext = await this.loadWriteOwners([...sourceTracks.values()], input.observedAt);
    if (managerContext.incomplete) return 0;
    const allowed = records.filter((row) => {
      const evidence = sourceTracks.get(row.evidenceTrackId)!;
      return !isCurrentManager(input.userId, evidence, managerContext.grants);
    });
    if (allowed.length === 0) return 0;

    return prisma.$transaction(async (tx) => {
      // One requester cannot race two requests past the per-window cap.
      await tx.$queryRaw(Prisma.sql`
        SELECT TRUE AS locked
        FROM (SELECT pg_advisory_xact_lock(hashtext('scene-scout-unmet-demand-user'), hashtext(${input.userId}))) AS lock
      `);
      const currentRows = await tx.demandObservation.findMany({
        where: { userId: input.userId, expiresAt: { gte: input.observedAt } },
        take: UNMET_DEMAND_USER_WINDOW_CAP + 1,
        select: { id: true },
      });
      const room = Math.max(0, UNMET_DEMAND_USER_WINDOW_CAP - currentRows.length);
      if (room === 0) return 0;
      const result = await tx.demandObservation.createMany({
        data: allowed.slice(0, room).map((row) => ({
          userId: row.userId,
          sourceType: row.sourceType,
          sourceKey: row.sourceKey,
          targetArtistId: row.targetArtistId,
          targetId: row.targetId,
          targetType: row.targetType,
          evidenceTrackId: row.evidenceTrackId,
          kind: row.kind,
          value: row.value,
          consentDecidedAt: row.consentDecidedAt,
          tastePolicyUpdatedAt: row.tastePolicyUpdatedAt,
          observedAt: row.observedAt,
          expiresAt: row.expiresAt,
        })),
        skipDuplicates: true,
      });
      return result.count;
    });
  }

  private async resolveGenreTargets(genres: readonly string[], now: Date) {
    const targets: Array<{ artistId: string; genre: string; evidenceTrackId: string }> = [];
    const trackById = new Map<string, CatalogTrack>();
    for (const genre of [...new Set(genres)].slice(0, 8)) {
      const rows = await prisma.track.findMany({
        where: {
          contentStatus: { notIn: ["quarantined", "dmca_removed"] },
          release: {
            is: {
              genre: { equals: genre, mode: "insensitive" },
              status: { in: [...WITHDRAWABLE_RELEASE_STATUSES] },
              withdrawnAt: null,
              OR: [{ releaseDate: null }, { releaseDate: { lte: now } }],
            },
          },
        },
        orderBy: { id: "asc" },
        take: UNMET_DEMAND_CATALOG_CAP + 1,
        select: trackSelect(),
      });
      if (rows.length > UNMET_DEMAND_CATALOG_CAP) return { targets: [], trackById, truncated: true };
      const seenArtists = new Set<string>();
      for (const row of rows as CatalogTrack[]) {
        if (!isAvailableTrack(row, now) || canonicalExactGenre(row.release.genre) !== genre) continue;
        trackById.set(row.id, row);
        if (seenArtists.has(row.release.artistId)) continue;
        seenArtists.add(row.release.artistId);
        targets.push({ artistId: row.release.artistId, genre, evidenceTrackId: row.id });
      }
    }
    return { targets, trackById, truncated: false };
  }

  private async loadWriteOwners(tracks: CatalogTrack[], now: Date): Promise<{ grants: ManagerGrant[]; incomplete: boolean }> {
    const artistIds = [...new Set(tracks.map((track) => track.release.artistId))];
    const releaseIds = [...new Set(tracks.map((track) => track.releaseId))];
    if (artistIds.length === 0) return { grants: [], incomplete: false };
    const grants = await prisma.managementGrant.findMany({
      where: {
        status: ManagementGrantStatus.active,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        AND: [{
          OR: [
            { artistId: { in: artistIds } },
            { releaseId: { in: releaseIds } },
          ],
        }],
      },
      orderBy: { id: "asc" },
      take: UNMET_DEMAND_READ_CAP + 1,
      select: { artistId: true, releaseId: true, granteeUserId: true },
    });
    if (grants.length > UNMET_DEMAND_READ_CAP) return { grants: [], incomplete: true };
    return { grants: grants as ManagerGrant[], incomplete: false };
  }

  private async loadSessionCandidatePool(now: Date): Promise<{ candidates: SessionDemandCandidate[]; truncated: boolean }> {
    const rows = await prisma.track.findMany({
      where: {
        contentStatus: { notIn: ["quarantined", "dmca_removed"] },
        release: {
          is: {
            status: { in: [...WITHDRAWABLE_RELEASE_STATUSES] },
            withdrawnAt: null,
            OR: [{ releaseDate: null }, { releaseDate: { lte: now } }],
          },
        },
      },
      orderBy: { id: "asc" },
      take: UNMET_DEMAND_CATALOG_CAP + 1,
      select: sessionTrackSelect(),
    });
    if (rows.length > UNMET_DEMAND_CATALOG_CAP) return { candidates: [], truncated: true };
    const candidates = (rows as CatalogTrack[])
      .filter((row) => isAvailableTrack(row, now))
      .map(sessionCandidateFromTrack);
    return { candidates, truncated: false };
  }

  private async loadCurrentReadContext(artistId: string, observations: DemandObservationRecord[], now: Date) {
    const userIds = [...new Set(observations.map((row) => row.userId))];
    const evidenceTrackIds = [...new Set(observations.map((row) => row.evidenceTrackId).filter((id): id is string => Boolean(id)))];
    const sessionUserIds = [...new Set(observations.filter((row) => row.sourceType === "session").map((row) => row.userId))];
    const tracks = evidenceTrackIds.length > 0
      ? await prisma.track.findMany({ where: { id: { in: evidenceTrackIds } }, take: UNMET_DEMAND_READ_CAP + 1, select: trackSelect() })
      : [];
    if (tracks.length > UNMET_DEMAND_READ_CAP) return { incomplete: true as const };
    const trackMap = new Map(tracks.map((row) => [row.id, row as CatalogTrack]));
    const releaseIds = [...new Set(tracks.map((row) => row.releaseId))];

    const [consents, tastes, grants] = await Promise.all([
      userIds.length > 0 ? prisma.analyticsConsent.findMany({
        where: { userId: { in: userIds } },
        orderBy: { userId: "asc" },
        take: UNMET_DEMAND_READ_CAP + 1,
        select: { userId: true, productAnalytics: true, policyVersion: true, decidedAt: true },
      }) : Promise.resolve([]),
      sessionUserIds.length > 0 ? prisma.listenerTasteMemorySettings.findMany({
        where: { userId: { in: sessionUserIds } },
        orderBy: { userId: "asc" },
        take: UNMET_DEMAND_READ_CAP + 1,
        select: { userId: true, resetAt: true, agentPlaybackTrainingEnabled: true, updatedAt: true },
      }) : Promise.resolve([]),
      prisma.managementGrant.findMany({
        where: {
          status: ManagementGrantStatus.active,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          AND: [{ OR: [{ artistId }, ...(releaseIds.length > 0 ? [{ releaseId: { in: releaseIds } }] : [])] }],
        },
        orderBy: { id: "asc" },
        take: UNMET_DEMAND_READ_CAP + 1,
        select: { artistId: true, releaseId: true, granteeUserId: true },
      }),
    ]);
    const incomplete = consents.length > UNMET_DEMAND_READ_CAP ||
      tastes.length > UNMET_DEMAND_READ_CAP || grants.length > UNMET_DEMAND_READ_CAP;
    return {
      incomplete,
      tracks: trackMap,
      consents: new Map(consents.map((row) => [row.userId, row])),
      tastes: new Map(tastes.map((row) => [row.userId, row])),
      grants: grants as ManagerGrant[],
      releaseIds: new Set(releaseIds),
    };
  }

  private observationIsCurrent(
    observation: DemandObservationRecord,
    current: {
      consents: Map<string, { productAnalytics: boolean; policyVersion: string; decidedAt: Date }>;
      tastes: Map<string, { resetAt: Date | null; agentPlaybackTrainingEnabled: boolean; updatedAt: Date }>;
      tracks: Map<string, CatalogTrack>;
      grants: ManagerGrant[];
    },
    artist: { userId: string | null; managementOwnerUserId: string | null },
    now: Date,
  ): boolean {
    const consent = current.consents.get(observation.userId);
    if (!consent || !consent.productAnalytics || consent.policyVersion !== ANALYTICS_CONSENT_POLICY_VERSION ||
      consent.decidedAt.getTime() !== observation.consentDecidedAt.getTime() ||
      observation.observedAt.getTime() < observation.consentDecidedAt.getTime()) return false;
    if (observation.observedAt > now) return false;
    const track = current.tracks.get(observation.evidenceTrackId ?? "");
    if (!track || !isAvailableTrack(track, now)) return false;
    if (observation.sourceType === "session") {
      const taste = current.tastes.get(observation.userId);
      if (taste?.agentPlaybackTrainingEnabled === false || (taste?.resetAt && observation.observedAt <= taste.resetAt)) return false;
      const recordedAt = observation.tastePolicyUpdatedAt ?? null;
      const currentAt = taste?.updatedAt ?? null;
      if ((recordedAt?.getTime() ?? null) !== (currentAt?.getTime() ?? null)) return false;
    }
    if (observation.userId === artist.userId || observation.userId === artist.managementOwnerUserId) return false;
    if (isCurrentManager(observation.userId, track, current.grants)) return false;
    return true;
  }

  private async replaceSnapshots(artistId: string, rows: Prisma.DemandSignalCreateManyInput[]) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT TRUE AS locked
        FROM (SELECT pg_advisory_xact_lock(hashtext('scene-scout-unmet-demand-artist'), hashtext(${artistId}))) AS lock
      `);
      await tx.demandSignal.deleteMany({ where: { artistId } });
      if (rows.length > 0) await tx.demandSignal.createMany({ data: rows, skipDuplicates: true });
    });
  }
}

function canonicalExactGenre(value: string | null): string | undefined {
  if (!value) return undefined;
  // This project has one canonical structured vocabulary. Subgenres and
  // arbitrary catalog labels are deliberately not broadened into a demand key.
  const canonical = canonicalCrateGenre(value);
  return canonical && canonical.toLowerCase() === value.trim().toLowerCase() ? canonical : undefined;
}

function isCurrentManager(userId: string, track: CatalogTrack, grants: readonly ManagerGrant[]): boolean {
  if (
    track.release.artist.userId === userId ||
    track.release.artist.managementOwnerUserId === userId ||
    track.release.managementOwnerUserId === userId
  ) return true;
  return grants.some((grant) =>
    grant.granteeUserId === userId &&
    (grant.artistId === track.release.artistId || grant.releaseId === track.releaseId),
  );
}

function sessionCandidateFromTrack(track: CatalogTrack): SessionDemandCandidate {
  const measured = measuredTrackFeatures(track.stems?.[0]?.audioFeatures);
  return {
    trackId: track.id,
    genre: track.release.genre,
    moods: track.release.moods,
    tempoBpm: measured.tempoBpm,
    energy: measured.energy,
  };
}
