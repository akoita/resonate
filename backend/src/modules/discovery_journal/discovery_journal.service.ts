import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { classifyTrackAvailability } from "../catalog/track-availability";
import {
  DISCOVERY_EXPLANATIONS,
  DISCOVERY_REASON_CODES,
  type DiscoveryReasonCode,
} from "../recommendations/discovery-explanations";
import { DiscoveryPolicyContextService } from "../recommendations/discovery-policy-context.service";
import { TasteMemoryService } from "../recommendations/taste_memory.service";
import { resolveCreditedArtistName } from "../shared/artist_attribution";

/**
 * Sonic Radar as the listener's discovery journal (ADR-TE-5,
 * docs/rfc/taste-engine.md §3.3 and §4.1).
 *
 * The journal lists the tracks that RESONATED for the signed-in listener:
 * played to at least 90% and then replayed or saved within seven days. It is
 * computed on read from the listener's own AgentSignal and LibraryTrack rows.
 * It never reads another listener's data, and it carries no price, spend,
 * license or transaction fields (ADR-TE-1: the AI DJ no longer buys).
 */

export const DISCOVERY_JOURNAL_SCHEMA_VERSION = "discovery-journal/v1";

/** A completion at or above this ratio counts as "played to the end". */
export const RESONANCE_COMPLETION_THRESHOLD = 0.9;
/** The replay/save must land within this many days after the completion. */
export const RESONANCE_FOLLOW_UP_DAYS = 7;
export const DEFAULT_WINDOW_DAYS = 28;
export const MAX_WINDOW_DAYS = 90;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
/** Hard cap on AgentSignal rows read per request (newest first). */
export const SIGNAL_READ_CAP = 2000;
/** "This week" in the headline numbers: the last 7 days ending `now`. */
const HEADLINE_DAYS = 7;
/**
 * An artist is new to the listener when their earliest recorded interaction
 * starts the very listen that resonated. Playback mirrors a `started` accept
 * signal just before every completion, so "no signal before the completion"
 * taken literally could never hold. The lead-in covers that opening signal
 * (and other tracks of the same sitting).
 */
const LISTEN_LEAD_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACCEPT_READ_CAP = 500;

const JOURNAL_ACTIONS = ["complete", "replay", "save", "add_to_playlist"] as const;
const SAVE_ACTIONS = new Set<string>(["save", "add_to_playlist"]);
const REASON_CODES = new Set<string>(DISCOVERY_REASON_CODES);

export type JournalFollowUp = "replayed" | "saved";

export interface DiscoveryJournalNextAction {
  kind: "show_campaign" | "artist_page";
  label: string;
  href: string;
}

export interface DiscoveryJournalItem {
  trackId: string;
  title: string;
  artistId: string;
  artistName: string;
  releaseId: string;
  releaseTitle: string;
  artworkUrl: string | null;
  hasUploadedArtwork: boolean;
  artworkRevision: number;
  resonatedAt: string;
  followUp: JournalFollowUp;
  discovery: boolean;
  reason: { code: DiscoveryReasonCode; text: string };
  /** Exactly one per artist: the first item of that artist; null for the rest. */
  nextAction: DiscoveryJournalNextAction | null;
}

export interface DiscoveryJournalGroup {
  key: string;
  sessionId: string | null;
  /** UTC calendar day (YYYY-MM-DD) of the newest item in the group. */
  date: string;
  items: DiscoveryJournalItem[];
}

export interface DiscoveryJournal {
  schemaVersion: typeof DISCOVERY_JOURNAL_SCHEMA_VERSION;
  window: { days: number; from: string; to: string };
  headline: { resonantDiscoveriesThisWeek: number; newArtistsThisWeek: number };
  groups: DiscoveryJournalGroup[];
}

/** Hard caps on rows read for the operator aggregate (#1455), newest first. */
export const AGGREGATE_COMPLETION_CAP = 5000;
export const AGGREGATE_FOLLOW_UP_CAP = 20000;

/** Counts only: no listener ids, no per-listener rows leave the service. */
export interface ResonantDiscoveryAggregate {
  /** Resonant discoveries (listener, track) in the window, publicly available tracks only. */
  total: number;
  /** Distinct artists that were a discovery for at least one listener. */
  distinctNewArtists: number;
  /** Distinct listeners with at least one AgentSignal in the window. */
  activeListeners: number;
  /** True when a read cap was hit, so the counts are a lower bound. */
  truncated: boolean;
}

export interface GetJournalOptions {
  now?: Date;
  windowDays?: number;
  limit?: number;
}

type SignalRow = {
  trackId: string;
  action: string;
  sessionId: string | null;
  createdAt: Date;
  metadata: Prisma.JsonValue;
};

type Resonance = {
  trackId: string;
  completedAt: Date;
  sessionId: string | null;
  followUp: JournalFollowUp;
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Agent-originated playback is hidden from the journal when the listener has
 * turned off "AI DJ playback trains my taste". `source === "agent_session"` is
 * exactly the predicate `TasteMemoryService.shouldTrainAgentPlayback` applies
 * to the learning loop; the playback mirror also stamps `agentOriginated`.
 */
function isAgentOriginated(metadata: unknown) {
  const object = jsonObject(metadata);
  return object.source === "agent_session" || object.agentOriginated === true;
}

/** The recorded completion ratio, or null: no ratio never qualifies. */
export function completionRatioOf(metadata: unknown): number | null {
  const ratio = jsonObject(jsonObject(metadata).outcome).completionRatio;
  return typeof ratio === "number" && Number.isFinite(ratio) ? ratio : null;
}

/**
 * The discovery rule shared by the listener journal and the operator
 * aggregate (#1455): a resonant listen is a discovery when the listener's
 * earliest recorded interaction with the artist is the very listen that
 * resonated (within the lead-in window), or there is none at all.
 */
export function isDiscoveryListen(firstTouch: Date | undefined, completedAt: Date): boolean {
  return firstTouch === undefined || firstTouch.getTime() >= completedAt.getTime() - LISTEN_LEAD_MS;
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Pure resonance rule for one track. `events` are the listener's journal
 * signals on the track (any order); `libraryAdds` are LibraryTrack creation
 * times. Returns the EARLIEST qualifying completion inside `[from, now]`:
 * a completion with a recorded ratio >= 0.9 followed, strictly after it and
 * within seven days (never after `now`), by a later complete/replay (replayed)
 * or a save/add_to_playlist/library add (saved).
 */
export function findResonance(input: {
  events: Array<{
    action: string;
    createdAt: Date;
    sessionId: string | null;
    metadata: unknown;
  }>;
  libraryAdds: Date[];
  from: Date;
  now: Date;
}): Omit<Resonance, "trackId"> | null {
  const followUps: Array<{ at: Date; kind: JournalFollowUp }> = [
    ...input.events
      .filter((event) => ["complete", "replay", "save", "add_to_playlist"].includes(event.action))
      .map((event) => ({
        at: event.createdAt,
        kind: (SAVE_ACTIONS.has(event.action) ? "saved" : "replayed") as JournalFollowUp,
      })),
    ...input.libraryAdds.map((at) => ({ at, kind: "saved" as JournalFollowUp })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const completions = input.events
    .filter(
      (event) =>
        event.action === "complete" &&
        (completionRatioOf(event.metadata) ?? -1) >= RESONANCE_COMPLETION_THRESHOLD &&
        event.createdAt >= input.from &&
        event.createdAt <= input.now,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const completion of completions) {
    const deadline = Math.min(
      completion.createdAt.getTime() + RESONANCE_FOLLOW_UP_DAYS * DAY_MS,
      input.now.getTime(),
    );
    const followUp = followUps.find(
      (candidate) =>
        candidate.at.getTime() > completion.createdAt.getTime() &&
        candidate.at.getTime() <= deadline,
    );
    if (followUp) {
      return {
        completedAt: completion.createdAt,
        sessionId: completion.sessionId,
        followUp: followUp.kind,
      };
    }
  }
  return null;
}

@Injectable()
export class DiscoveryJournalService {
  constructor(
    private readonly tasteMemory: TasteMemoryService,
    private readonly policyContext: DiscoveryPolicyContextService,
  ) {}

  async getJournal(userId: string, options: GetJournalOptions = {}): Promise<DiscoveryJournal> {
    const now = options.now ?? new Date();
    const windowDays = clampInt(options.windowDays, DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS);
    const limit = clampInt(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const windowFrom = new Date(now.getTime() - windowDays * DAY_MS);
    // The headline always covers the last seven days, even for a shorter window.
    const readFrom = new Date(
      now.getTime() - Math.max(windowDays, HEADLINE_DAYS) * DAY_MS,
    );
    const weekFrom = new Date(now.getTime() - HEADLINE_DAYS * DAY_MS);

    const empty = (): DiscoveryJournal => ({
      schemaVersion: DISCOVERY_JOURNAL_SCHEMA_VERSION,
      window: { days: windowDays, from: windowFrom.toISOString(), to: now.toISOString() },
      headline: { resonantDiscoveriesThisWeek: 0, newArtistsThisWeek: 0 },
      groups: [],
    });

    // Consent: the same two controls the taste loop honors. A taste reset
    // forgets everything before it; with agent-playback training off,
    // agent-originated playback is not used.
    const [policy, agentPlaybackAllowed] = await Promise.all([
      this.tasteMemory.getPolicy(userId),
      this.tasteMemory.shouldTrainAgentPlayback(userId, { source: "agent_session" }),
    ]);
    const resetAt = policy.resetAt;
    const usable = (metadata: unknown) => agentPlaybackAllowed || !isAgentOriginated(metadata);
    const createdAtRange: Prisma.DateTimeFilter = {
      gte: readFrom,
      lte: now,
      ...(resetAt ? { gt: resetAt } : {}),
    };

    // 1. This listener's journal signals only, newest first, hard-capped.
    const signalRows = await prisma.agentSignal.findMany({
      where: {
        userId,
        action: { in: [...JOURNAL_ACTIONS] },
        createdAt: createdAtRange,
      },
      orderBy: { createdAt: "desc" },
      take: SIGNAL_READ_CAP,
      select: { trackId: true, action: true, sessionId: true, createdAt: true, metadata: true },
    });
    const signalsByTrack = new Map<string, SignalRow[]>();
    for (const row of signalRows) {
      if (!usable(row.metadata)) continue;
      const list = signalsByTrack.get(row.trackId) ?? [];
      list.push(row);
      signalsByTrack.set(row.trackId, list);
    }

    // Only tracks with a >= 90% completion can resonate; fetch library saves
    // for just those.
    const completedTrackIds = [...signalsByTrack.entries()]
      .filter(([, rows]) =>
        rows.some(
          (row) =>
            row.action === "complete" &&
            (completionRatioOf(row.metadata) ?? -1) >= RESONANCE_COMPLETION_THRESHOLD,
        ),
      )
      .map(([trackId]) => trackId);
    if (completedTrackIds.length === 0) return empty();

    const libraryRows = await prisma.libraryTrack.findMany({
      where: {
        userId,
        catalogTrackId: { in: completedTrackIds },
        createdAt: createdAtRange,
      },
      select: { catalogTrackId: true, createdAt: true },
    });
    const libraryAddsByTrack = new Map<string, Date[]>();
    for (const row of libraryRows) {
      if (!row.catalogTrackId) continue;
      const list = libraryAddsByTrack.get(row.catalogTrackId) ?? [];
      list.push(row.createdAt);
      libraryAddsByTrack.set(row.catalogTrackId, list);
    }

    // 2. Apply the resonance rule in code.
    const resonant: Resonance[] = [];
    for (const trackId of completedTrackIds) {
      const found = findResonance({
        events: signalsByTrack.get(trackId) ?? [],
        libraryAdds: libraryAddsByTrack.get(trackId) ?? [],
        from: windowFrom,
        now,
      });
      if (found) resonant.push({ trackId, ...found });
    }
    if (resonant.length === 0) return empty();
    resonant.sort(
      (a, b) =>
        b.completedAt.getTime() - a.completedAt.getTime() ||
        a.trackId.localeCompare(b.trackId),
    );

    // 3. Catalog rows, publicly visible tracks only.
    const tracks = await prisma.track.findMany({
      where: { id: { in: resonant.map((entry) => entry.trackId) } },
      select: {
        id: true,
        title: true,
        artist: true,
        contentStatus: true,
        rightsRoute: true,
        release: {
          select: {
            id: true,
            title: true,
            status: true,
            rightsRoute: true,
            withdrawnAt: true,
            withdrawalReason: true,
            artistId: true,
            primaryArtist: true,
            artworkUrl: true,
            artworkMimeType: true,
            artworkRevision: true,
            artist: { select: { displayName: true } },
            artistCredits: {
              select: { role: true, displayName: true },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });
    const trackById = new Map(
      tracks
        .filter((track) => classifyTrackAvailability(track).state === "available")
        .map((track) => [track.id, track]),
    );
    const visible = resonant.filter((entry) => trackById.has(entry.trackId));
    if (visible.length === 0) return empty();

    const artistIds = [
      ...new Set(visible.map((entry) => trackById.get(entry.trackId)!.release.artistId)),
    ];

    // 4. Which artists were new to the listener, and which are verified humans.
    const [firstTouchByArtist, policyContext] = await Promise.all([
      this.loadFirstTouch(userId, artistIds, now, resetAt, agentPlaybackAllowed),
      this.policyContext.loadContext(undefined, artistIds),
    ]);
    const discoveryFor = (entry: Resonance) => {
      const artistId = trackById.get(entry.trackId)!.release.artistId;
      const firstTouch = firstTouchByArtist.get(artistId);
      return isDiscoveryListen(firstTouch, entry.completedAt);
    };

    const headlineEntries = visible.filter(
      (entry) => entry.completedAt >= weekFrom && discoveryFor(entry),
    );
    const headline = {
      resonantDiscoveriesThisWeek: headlineEntries.length,
      newArtistsThisWeek: new Set(
        headlineEntries.map((entry) => trackById.get(entry.trackId)!.release.artistId),
      ).size,
    };

    // 5. Truncate to the window and the requested limit, then decorate.
    const shown = visible.filter((entry) => entry.completedAt >= windowFrom).slice(0, limit);
    if (shown.length === 0) {
      return { ...empty(), headline };
    }
    const shownArtistIds = [
      ...new Set(shown.map((entry) => trackById.get(entry.trackId)!.release.artistId)),
    ];
    const [acceptByTrack, campaignByArtist] = await Promise.all([
      this.loadAcceptReasonCodes(userId, shown, resetAt, now, usable),
      this.loadActiveCampaigns(shownArtistIds, now),
    ]);

    const groups = new Map<string, DiscoveryJournalGroup>();
    for (const entry of shown) {
      const track = trackById.get(entry.trackId)!;
      const release = track.release;
      const discovery = discoveryFor(entry);
      const code: DiscoveryReasonCode =
        acceptByTrack.get(entry.trackId) ??
        (discovery && policyContext.verifiedHumanArtistIds.has(release.artistId)
          ? "discovery_pick"
          : "listening_pattern");

      const item: DiscoveryJournalItem = {
        trackId: track.id,
        title: track.title,
        artistId: release.artistId,
        artistName:
          resolveCreditedArtistName({
            trackArtist: track.artist,
            credits: release.artistCredits,
            primaryArtist: release.primaryArtist,
            accountDisplayName: release.artist?.displayName,
          }) ?? "Unknown Artist",
        releaseId: release.id,
        releaseTitle: release.title,
        artworkUrl: release.artworkUrl,
        hasUploadedArtwork: Boolean(release.artworkMimeType),
        artworkRevision: release.artworkRevision,
        resonatedAt: entry.completedAt.toISOString(),
        followUp: entry.followUp,
        discovery,
        reason: { code, text: DISCOVERY_EXPLANATIONS[code] },
        nextAction: null,
      };

      const day = isoDay(entry.completedAt);
      const key = entry.sessionId ? `session:${entry.sessionId}` : `day:${day}`;
      const group = groups.get(key) ?? {
        key,
        sessionId: entry.sessionId,
        date: day,
        items: [],
      };
      group.items.push(item);
      groups.set(key, group);
    }

    // `shown` is newest-first, so Map insertion order is newest group first.
    const orderedGroups = [...groups.values()];

    // Exactly one next action per artist, on the first item the listener sees
    // for that artist (display order: groups, then items within a group).
    const nextActionGiven = new Set<string>();
    for (const group of orderedGroups) {
      for (const item of group.items) {
        if (nextActionGiven.has(item.artistId)) continue;
        nextActionGiven.add(item.artistId);
        const campaign = campaignByArtist.get(item.artistId);
        item.nextAction = campaign
          ? {
              kind: "show_campaign",
              label: "See their show campaign",
              href: `/shows/${encodeURIComponent(campaign.slug)}`,
            }
          : {
              kind: "artist_page",
              label: "Visit artist page",
              href: `/artist/${encodeURIComponent(item.artistId)}`,
            };
      }
    }

    return {
      schemaVersion: DISCOVERY_JOURNAL_SCHEMA_VERSION,
      window: { days: windowDays, from: windowFrom.toISOString(), to: now.toISOString() },
      headline,
      groups: orderedGroups,
    };
  }

  /**
   * Operator aggregate of resonant discoveries over the last `windowDays`
   * (#1455 WS-8). Applies the same resonance rule, discovery rule, consent
   * controls (taste reset, agent-playback training) and public-availability
   * filter as `getJournal`, but across listeners, and returns counts only.
   * Bounded: at most AGGREGATE_COMPLETION_CAP completions and
   * AGGREGATE_FOLLOW_UP_CAP follow-up rows are read; `truncated` reports a hit.
   */
  async getResonantDiscoveryAggregate(options: {
    windowDays: number;
    now?: Date;
  }): Promise<ResonantDiscoveryAggregate> {
    const now = options.now ?? new Date();
    const windowDays = clampInt(options.windowDays, DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS);
    const from = new Date(now.getTime() - windowDays * DAY_MS);
    const range: Prisma.DateTimeFilter = { gte: from, lte: now };

    const activeRows = await prisma.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT "userId") AS "count"
      FROM "AgentSignal"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${now}
    `);
    const activeListeners = Number(activeRows[0]?.count ?? 0);

    const completionRows = await prisma.agentSignal.findMany({
      where: {
        action: "complete",
        createdAt: range,
        metadata: {
          path: ["outcome", "completionRatio"],
          gte: RESONANCE_COMPLETION_THRESHOLD,
        },
      },
      orderBy: { createdAt: "desc" },
      take: AGGREGATE_COMPLETION_CAP + 1,
      select: { userId: true, trackId: true },
    });
    let truncated = completionRows.length > AGGREGATE_COMPLETION_CAP;
    const candidates = completionRows.slice(0, AGGREGATE_COMPLETION_CAP);
    if (candidates.length === 0) {
      return { total: 0, distinctNewArtists: 0, activeListeners, truncated };
    }

    const userIds = [...new Set(candidates.map((row) => row.userId))];
    const trackIds = [...new Set(candidates.map((row) => row.trackId))];
    const pairKey = (userId: string, trackId: string) => `${userId}\u0000${trackId}`;
    const wanted = new Set(candidates.map((row) => pairKey(row.userId, row.trackId)));

    const [settingsRows, signalRows, libraryRows] = await Promise.all([
      prisma.listenerTasteMemorySettings.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, resetAt: true, agentPlaybackTrainingEnabled: true },
      }),
      prisma.agentSignal.findMany({
        where: {
          userId: { in: userIds },
          trackId: { in: trackIds },
          action: { in: [...JOURNAL_ACTIONS] },
          createdAt: range,
        },
        orderBy: { createdAt: "desc" },
        take: AGGREGATE_FOLLOW_UP_CAP + 1,
        select: {
          userId: true,
          trackId: true,
          action: true,
          sessionId: true,
          createdAt: true,
          metadata: true,
        },
      }),
      prisma.libraryTrack.findMany({
        where: { userId: { in: userIds }, catalogTrackId: { in: trackIds }, createdAt: range },
        select: { userId: true, catalogTrackId: true, createdAt: true },
      }),
    ]);
    if (signalRows.length > AGGREGATE_FOLLOW_UP_CAP) truncated = true;

    const consent = new Map(settingsRows.map((row) => [row.userId, row]));
    const usableFor = (userId: string, createdAt: Date, metadata: unknown) => {
      const settings = consent.get(userId);
      if (settings?.resetAt && createdAt <= settings.resetAt) return false;
      const agentAllowed = settings?.agentPlaybackTrainingEnabled ?? true;
      return agentAllowed || !isAgentOriginated(metadata);
    };

    const eventsByPair = new Map<string, SignalRow[]>();
    for (const row of signalRows.slice(0, AGGREGATE_FOLLOW_UP_CAP)) {
      const key = pairKey(row.userId, row.trackId);
      if (!wanted.has(key) || !usableFor(row.userId, row.createdAt, row.metadata)) continue;
      const list = eventsByPair.get(key) ?? [];
      list.push(row);
      eventsByPair.set(key, list);
    }
    const libraryByPair = new Map<string, Date[]>();
    for (const row of libraryRows) {
      if (!row.catalogTrackId) continue;
      const key = pairKey(row.userId, row.catalogTrackId);
      const resetAt = consent.get(row.userId)?.resetAt;
      if (!wanted.has(key) || (resetAt && row.createdAt <= resetAt)) continue;
      const list = libraryByPair.get(key) ?? [];
      list.push(row.createdAt);
      libraryByPair.set(key, list);
    }

    const resonant: Array<{ userId: string; trackId: string; completedAt: Date }> = [];
    for (const key of wanted) {
      const [userId, trackId] = key.split("\u0000");
      const found = findResonance({
        events: eventsByPair.get(key) ?? [],
        libraryAdds: libraryByPair.get(key) ?? [],
        from,
        now,
      });
      if (found) resonant.push({ userId, trackId, completedAt: found.completedAt });
    }
    const none = { total: 0, distinctNewArtists: 0, activeListeners, truncated };
    if (resonant.length === 0) return none;

    const tracks = await prisma.track.findMany({
      where: { id: { in: [...new Set(resonant.map((entry) => entry.trackId))] } },
      select: {
        id: true,
        contentStatus: true,
        rightsRoute: true,
        release: {
          select: {
            id: true,
            status: true,
            rightsRoute: true,
            withdrawnAt: true,
            withdrawalReason: true,
            artistId: true,
          },
        },
      },
    });
    const artistByTrack = new Map(
      tracks
        .filter((track) => classifyTrackAvailability(track).state === "available")
        .map((track) => [track.id, track.release.artistId]),
    );
    const visible = resonant.filter((entry) => artistByTrack.has(entry.trackId));
    if (visible.length === 0) return none;

    const visibleUserIds = [...new Set(visible.map((entry) => entry.userId))];
    const artistIds = [...new Set(visible.map((entry) => artistByTrack.get(entry.trackId)!))];
    const firstTouchRows = await prisma.$queryRaw<
      Array<{ userId: string; artistId: string; firstAt: Date }>
    >(Prisma.sql`
      SELECT s."userId" AS "userId", r."artistId" AS "artistId", MIN(s."createdAt") AS "firstAt"
      FROM "AgentSignal" s
      JOIN "Track" t ON t."id" = s."trackId"
      JOIN "Release" r ON r."id" = t."releaseId"
      LEFT JOIN "ListenerTasteMemorySettings" m ON m."userId" = s."userId"
      WHERE s."userId" IN (${Prisma.join(visibleUserIds)})
        AND r."artistId" IN (${Prisma.join(artistIds)})
        AND s."createdAt" <= ${now}
        AND (m."resetAt" IS NULL OR s."createdAt" > m."resetAt")
        AND (
          COALESCE(m."agentPlaybackTrainingEnabled", true)
          OR (
            COALESCE(s."metadata"->>'source', '') <> 'agent_session'
            AND COALESCE(s."metadata"->>'agentOriginated', 'false') <> 'true'
          )
        )
      GROUP BY s."userId", r."artistId"
    `);
    const firstTouch = new Map(
      firstTouchRows.map((row) => [pairKey(row.userId, row.artistId), new Date(row.firstAt)]),
    );

    const discoveryArtists = new Set<string>();
    let total = 0;
    for (const entry of visible) {
      const artistId = artistByTrack.get(entry.trackId)!;
      if (isDiscoveryListen(firstTouch.get(pairKey(entry.userId, artistId)), entry.completedAt)) {
        total += 1;
        discoveryArtists.add(artistId);
      }
    }
    return { total, distinctNewArtists: discoveryArtists.size, activeListeners, truncated };
  }

  /**
   * Earliest recorded interaction (any action, any track) of THIS listener
   * with each artist, after a taste reset and within the consent rules. One
   * grouped query scoped to the listener and the given artists.
   */
  private async loadFirstTouch(
    userId: string,
    artistIds: string[],
    now: Date,
    resetAt: Date | undefined,
    agentPlaybackAllowed: boolean,
  ) {
    const resetClause = resetAt ? Prisma.sql`AND s."createdAt" > ${resetAt}` : Prisma.empty;
    const consentClause = agentPlaybackAllowed
      ? Prisma.empty
      : Prisma.sql`AND COALESCE(s."metadata"->>'source', '') <> 'agent_session'
          AND COALESCE(s."metadata"->>'agentOriginated', 'false') <> 'true'`;
    const rows = await prisma.$queryRaw<Array<{ artistId: string; firstAt: Date }>>(Prisma.sql`
      SELECT r."artistId" AS "artistId", MIN(s."createdAt") AS "firstAt"
      FROM "AgentSignal" s
      JOIN "Track" t ON t."id" = s."trackId"
      JOIN "Release" r ON r."id" = t."releaseId"
      WHERE s."userId" = ${userId}
        AND r."artistId" IN (${Prisma.join(artistIds)})
        AND s."createdAt" <= ${now}
        ${resetClause}
        ${consentClause}
      GROUP BY r."artistId"
    `);
    return new Map(rows.map((row) => [row.artistId, new Date(row.firstAt)]));
  }

  /**
   * A `reasonCode` the recommender recorded on the listener's own accept
   * signal for the track (latest one at or before the completion). Only codes
   * from the shared vocabulary are accepted; free text is never surfaced.
   */
  private async loadAcceptReasonCodes(
    userId: string,
    shown: Resonance[],
    resetAt: Date | undefined,
    now: Date,
    usable: (metadata: unknown) => boolean,
  ) {
    const completedAtByTrack = new Map(shown.map((entry) => [entry.trackId, entry.completedAt]));
    const rows = await prisma.agentSignal.findMany({
      where: {
        userId,
        action: "accept",
        trackId: { in: [...completedAtByTrack.keys()] },
        createdAt: { lte: now, ...(resetAt ? { gt: resetAt } : {}) },
      },
      orderBy: { createdAt: "desc" },
      take: ACCEPT_READ_CAP,
      select: { trackId: true, createdAt: true, metadata: true },
    });
    const codes = new Map<string, DiscoveryReasonCode>();
    for (const row of rows) {
      if (codes.has(row.trackId) || !usable(row.metadata)) continue;
      const completedAt = completedAtByTrack.get(row.trackId);
      if (!completedAt || row.createdAt > completedAt) continue;
      const code = jsonObject(jsonObject(row.metadata).recommendation).reasonCode;
      if (typeof code === "string" && REASON_CODES.has(code)) {
        codes.set(row.trackId, code as DiscoveryReasonCode);
      }
    }
    return codes;
  }

  /**
   * The artist's open Shows campaign (public, backable: active, before its
   * deadline, not signal-level), earliest deadline first. Public campaign
   * rows only; nothing about the listener is read.
   */
  private async loadActiveCampaigns(artistIds: string[], now: Date) {
    const campaigns = await prisma.showCampaign.findMany({
      where: {
        artistId: { in: artistIds },
        status: "active",
        deadline: { gt: now },
        campaignLevel: { not: "signal" },
      },
      orderBy: [{ deadline: "asc" }, { slug: "asc" }],
      select: { artistId: true, slug: true },
    });
    const byArtist = new Map<string, { slug: string }>();
    for (const campaign of campaigns) {
      if (campaign.artistId && !byArtist.has(campaign.artistId)) {
        byArtist.set(campaign.artistId, { slug: campaign.slug });
      }
    }
    return byArtist;
  }
}
