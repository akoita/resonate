/**
 * Listener stats (#2729): pure aggregation over one listener's own
 * play signals. No database access here, so the rules are unit-tested directly;
 * `listening_stats.service.ts` reads the rows and hands them in.
 *
 * A "play" is a counted play: the `complete` AgentSignal the player records at
 * 30 s (upgraded in place when the track plays through), or a `replay`, which
 * is a later counted play of a track already completed. Local-file plays send
 * no play events, so they never reach these numbers.
 *
 * Days are the listener's own calendar days, so the server never needs their
 * time zone: it returns plays in 15-minute UTC slots (`activity`), and the
 * browser groups those into local days, streaks and the busiest day. The
 * player already promises to send only broad time-of-day categories.
 */

export const LISTENING_STATS_SCHEMA_VERSION = "listening-stats/v1";

/** Windows the page offers, in days. */
export const LISTENING_STATS_WINDOWS = [7, 30, 90, 365] as const;
export type ListeningStatsWindow = (typeof LISTENING_STATS_WINDOWS)[number];
export const DEFAULT_LISTENING_STATS_WINDOW: ListeningStatsWindow = 30;

export const PLAY_ACTIONS = ["complete", "replay"] as const;
/** A play at or above this completion ratio counts as played through. */
export const PLAYED_THROUGH_RATIO = 0.9;
/** A counted play lasted at least this long, used when no duration was recorded. */
export const COUNTED_PLAY_MS = 30_000;

export const TOP_ARTISTS_LIMIT = 8;
export const TOP_TRACKS_LIMIT = 10;
export const TOP_TAGS_LIMIT = 6;

export const MOMENTS = ["morning", "afternoon", "evening", "night"] as const;
export type Moment = (typeof MOMENTS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlaySignalRow {
  trackId: string;
  action: string;
  createdAt: Date;
  metadata: unknown;
}

export interface StatsTrackInfo {
  trackId: string;
  title: string;
  artistKey: string;
  artistId: string | null;
  artistName: string;
  releaseId: string;
  releaseTitle: string;
  artworkUrl: string | null;
  hasUploadedArtwork: boolean;
  artworkRevision: number;
  genre: string | null;
  moods: string[];
  available: boolean;
}

/** Minutes in one activity slot. */
export const ACTIVITY_SLOT_MINUTES = 15;

/**
 * Plays in one 15-minute UTC slot: [slot index since the epoch, plays,
 * listened seconds]. Sparse (slots without plays are left out) and covering
 * the window and the one before it, so a streak can reach back past the window.
 */
export type ActivitySlot = [slot: number, plays: number, seconds: number];

export interface ListeningStatsArtist {
  artistId: string | null;
  name: string;
  plays: number;
  minutes: number;
  tracks: number;
  /** Artwork of the artist's most played release here. */
  releaseId: string;
  artworkUrl: string | null;
  hasUploadedArtwork: boolean;
  artworkRevision: number;
}

export interface ListeningStatsTrack {
  trackId: string;
  title: string;
  artistId: string | null;
  artistName: string;
  releaseId: string;
  releaseTitle: string;
  artworkUrl: string | null;
  hasUploadedArtwork: boolean;
  artworkRevision: number;
  plays: number;
  minutes: number;
  available: boolean;
}

export interface ListeningStatsTag {
  name: string;
  plays: number;
  /** Share of the window's plays that carried a tag of this kind, 0..1. */
  share: number;
}

export interface ListeningStats {
  schemaVersion: typeof LISTENING_STATS_SCHEMA_VERSION;
  windowDays: ListeningStatsWindow;
  from: string;
  to: string;
  /** Whether new plays are being remembered (analytics consent and taste memory on). */
  recording: boolean;
  /** True when the read hit its cap: the numbers cover the most recent plays only. */
  truncated: boolean;
  summary: {
    plays: number;
    minutes: number;
    tracks: number;
    artists: number;
    newArtists: number;
    playedThroughRate: number | null;
    saves: number;
    previous: { plays: number; minutes: number };
  };
  /** Oldest first. */
  activity: ActivitySlot[];
  topArtists: ListeningStatsArtist[];
  topTracks: ListeningStatsTrack[];
  genres: ListeningStatsTag[];
  moods: ListeningStatsTag[];
  moments: Record<Moment, number>;
  weekdayPlays: number;
  weekendPlays: number;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Listened milliseconds for one counted play, a lower bound. */
export function listenedMsOf(metadata: unknown): number {
  const outcome = jsonObject(jsonObject(metadata).outcome);
  const duration = finite(outcome.durationMs);
  const ratio = finite(outcome.completionRatio);
  if (duration !== null && duration > 0) {
    if (ratio !== null) {
      return Math.max(Math.min(COUNTED_PLAY_MS, duration), Math.min(1, Math.max(0, ratio)) * duration);
    }
    return Math.min(COUNTED_PLAY_MS, duration);
  }
  return COUNTED_PLAY_MS;
}

export function playedThrough(metadata: unknown): boolean {
  const outcome = jsonObject(jsonObject(metadata).outcome);
  if (outcome.playedThrough === true) return true;
  const ratio = finite(outcome.completionRatio);
  return ratio !== null && ratio >= PLAYED_THROUGH_RATIO;
}

function momentOf(metadata: unknown): Moment | null {
  const bucket = jsonObject(metadata).localHourBucket;
  return typeof bucket === "string" && (MOMENTS as readonly string[]).includes(bucket)
    ? (bucket as Moment)
    : null;
}

function weekdayKindOf(metadata: unknown): "weekday" | "weekend" | null {
  const kind = jsonObject(metadata).weekdayKind;
  return kind === "weekday" || kind === "weekend" ? kind : null;
}

const roundMinutes = (ms: number) => Math.round(ms / 60_000);

function rankTags(
  counts: Map<string, { name: string; plays: number }>,
  tagged: number,
): ListeningStatsTag[] {
  return [...counts.values()]
    .sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name))
    .slice(0, TOP_TAGS_LIMIT)
    .map((tag) => ({
      name: tag.name,
      plays: tag.plays,
      share: tagged > 0 ? Math.round((tag.plays / tagged) * 1000) / 1000 : 0,
    }));
}

function addTag(counts: Map<string, { name: string; plays: number }>, raw: string | null | undefined) {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return false;
  const key = name.toLowerCase();
  const entry = counts.get(key) ?? { name, plays: 0 };
  entry.plays += 1;
  counts.set(key, entry);
  return true;
}

export interface AggregateInput {
  windowDays: ListeningStatsWindow;
  now: Date;
  recording: boolean;
  truncated: boolean;
  /** Play signals from `now - 2 * windowDays` (the previous window too), any order. */
  plays: PlaySignalRow[];
  /** Saves inside the window. */
  saves: number;
  tracks: Map<string, StatsTrackInfo>;
  /** Artist keys the listener had played before the window began. */
  artistKeysBefore: Set<string>;
}

export function aggregateListeningStats(input: AggregateInput): ListeningStats {
  const { windowDays, now } = input;
  const from = new Date(now.getTime() - windowDays * DAY_MS);

  let previousPlays = 0;
  let previousMs = 0;
  const slots = new Map<number, { plays: number; ms: number }>();
  const byTrack = new Map<string, { plays: number; ms: number }>();
  const byArtist = new Map<
    string,
    { plays: number; ms: number; tracks: Set<string>; releasePlays: Map<string, number> }
  >();
  const genreCounts = new Map<string, { name: string; plays: number }>();
  const moodCounts = new Map<string, { name: string; plays: number }>();
  let genreTagged = 0;
  let moodTagged = 0;
  const moments: Record<Moment, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  let weekdayPlays = 0;
  let weekendPlays = 0;
  let plays = 0;
  let totalMs = 0;
  let throughCount = 0;

  for (const row of input.plays) {
    if (!(PLAY_ACTIONS as readonly string[]).includes(row.action)) continue;
    const at = row.createdAt.getTime();
    if (at > now.getTime()) continue;
    const ms = listenedMsOf(row.metadata);
    const slot = Math.floor(at / (ACTIVITY_SLOT_MINUTES * 60_000));
    const slotEntry = slots.get(slot) ?? { plays: 0, ms: 0 };
    slotEntry.plays += 1;
    slotEntry.ms += ms;
    slots.set(slot, slotEntry);
    if (at < from.getTime()) {
      previousPlays += 1;
      previousMs += ms;
      continue;
    }

    plays += 1;
    totalMs += ms;
    if (playedThrough(row.metadata)) throughCount += 1;

    const trackEntry = byTrack.get(row.trackId) ?? { plays: 0, ms: 0 };
    trackEntry.plays += 1;
    trackEntry.ms += ms;
    byTrack.set(row.trackId, trackEntry);

    const moment = momentOf(row.metadata);
    if (moment) moments[moment] += 1;
    const kind = weekdayKindOf(row.metadata);
    if (kind === "weekday") weekdayPlays += 1;
    if (kind === "weekend") weekendPlays += 1;

    const track = input.tracks.get(row.trackId);
    if (!track) continue;
    const artistEntry = byArtist.get(track.artistKey) ?? {
      plays: 0,
      ms: 0,
      tracks: new Set<string>(),
      releasePlays: new Map<string, number>(),
    };
    artistEntry.plays += 1;
    artistEntry.ms += ms;
    artistEntry.tracks.add(track.trackId);
    artistEntry.releasePlays.set(track.releaseId, (artistEntry.releasePlays.get(track.releaseId) ?? 0) + 1);
    byArtist.set(track.artistKey, artistEntry);

    if (addTag(genreCounts, track.genre)) genreTagged += 1;
    let moodSeen = false;
    for (const mood of new Set(track.moods.map((m) => m.trim().toLowerCase()))) {
      const original = track.moods.find((m) => m.trim().toLowerCase() === mood);
      if (addTag(moodCounts, original)) moodSeen = true;
    }
    if (moodSeen) moodTagged += 1;
  }

  const activity: ActivitySlot[] = [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, entry]) => [slot, entry.plays, Math.round(entry.ms / 1000)]);

  const topTracks: ListeningStatsTrack[] = [...byTrack.entries()]
    .filter(([trackId]) => input.tracks.has(trackId))
    .sort(([aId, a], [bId, b]) => b.plays - a.plays || b.ms - a.ms || aId.localeCompare(bId))
    .slice(0, TOP_TRACKS_LIMIT)
    .map(([trackId, entry]) => {
      const track = input.tracks.get(trackId)!;
      return {
        trackId,
        title: track.title,
        artistId: track.artistId,
        artistName: track.artistName,
        releaseId: track.releaseId,
        releaseTitle: track.releaseTitle,
        artworkUrl: track.artworkUrl,
        hasUploadedArtwork: track.hasUploadedArtwork,
        artworkRevision: track.artworkRevision,
        plays: entry.plays,
        minutes: roundMinutes(entry.ms),
        available: track.available,
      };
    });

  const artistSample = new Map<string, StatsTrackInfo>();
  for (const track of input.tracks.values()) {
    if (!artistSample.has(track.artistKey)) artistSample.set(track.artistKey, track);
  }
  const releaseSample = new Map<string, StatsTrackInfo>();
  for (const track of input.tracks.values()) {
    if (!releaseSample.has(track.releaseId)) releaseSample.set(track.releaseId, track);
  }

  const topArtists: ListeningStatsArtist[] = [...byArtist.entries()]
    .sort(([aKey, a], [bKey, b]) => b.plays - a.plays || b.ms - a.ms || aKey.localeCompare(bKey))
    .slice(0, TOP_ARTISTS_LIMIT)
    .map(([key, entry]) => {
      const sample = artistSample.get(key)!;
      const [topReleaseId] = [...entry.releasePlays.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0];
      const release = releaseSample.get(topReleaseId) ?? sample;
      return {
        artistId: sample.artistId,
        name: sample.artistName,
        plays: entry.plays,
        minutes: roundMinutes(entry.ms),
        tracks: entry.tracks.size,
        releaseId: release.releaseId,
        artworkUrl: release.artworkUrl,
        hasUploadedArtwork: release.hasUploadedArtwork,
        artworkRevision: release.artworkRevision,
      };
    });

  const newArtists = [...byArtist.keys()].filter((key) => !input.artistKeysBefore.has(key)).length;

  return {
    schemaVersion: LISTENING_STATS_SCHEMA_VERSION,
    windowDays,
    from: from.toISOString(),
    to: now.toISOString(),
    recording: input.recording,
    truncated: input.truncated,
    summary: {
      plays,
      minutes: roundMinutes(totalMs),
      tracks: byTrack.size,
      artists: byArtist.size,
      newArtists,
      playedThroughRate: plays > 0 ? Math.round((throughCount / plays) * 1000) / 1000 : null,
      saves: input.saves,
      previous: { plays: previousPlays, minutes: roundMinutes(previousMs) },
    },
    activity,
    topArtists,
    topTracks,
    genres: rankTags(genreCounts, genreTagged),
    moods: rankTags(moodCounts, moodTagged),
    moments,
    weekdayPlays,
    weekendPlays,
  };
}
