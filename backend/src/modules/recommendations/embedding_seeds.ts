import { prisma } from "../../db/prisma";
import { hasSignal, TasteMemoryPolicy } from "./taste_memory.service";

/**
 * Embedding seeds for Home (#2003): the listener's own positive engagement,
 * turned into at most `EMBEDDING_SEED_LIMIT` track ids whose stored vectors are
 * searched for neighbours.
 *
 * Seeds are consent-respecting by construction:
 *   - only the listener's own explicit positive signals (a save, or a play they
 *     finished), never a skip, never anyone else's history;
 *   - signals from before the taste-memory reset are ignored;
 *   - agent-originated playback is ignored when the listener turned off "AI DJ
 *     playback trains my taste" (the same predicate the learning loop and the
 *     discovery journal apply);
 *   - a track whose genre, mood or artist the listener hid or downranked is
 *     never a seed.
 * No seed means no embedding candidates: Home then ranks exactly as it did
 * before embeddings existed.
 */
export const EMBEDDING_SEED_LIMIT = 3;
/** Neighbours requested per seed. */
export const EMBEDDING_NEIGHBOURS_PER_SEED = 10;
/** A completion at or above this ratio counts as "played to the end". */
export const SEED_COMPLETION_THRESHOLD = 0.9;
/** Newest positive signals read to find the seeds (hard bound on the query). */
export const SEED_SIGNAL_READ_CAP = 60;

const SAVE_ACTIONS = new Set(["save", "add_to_playlist"]);

/** One recorded listener signal with the track fields the seed rules read. */
export interface EmbeddingSeedSignal {
  trackId: string;
  action: string;
  createdAt: Date;
  metadata?: unknown;
  genre?: string | null;
  moods?: readonly string[] | null;
  /** Every name the track's artist goes by (track, primary, account). */
  artistNames?: ReadonlyArray<string | null | undefined>;
}

export interface EmbeddingSeedContext {
  policy: TasteMemoryPolicy;
  /** Result of `shouldTrainAgentPlayback`: false hides agent-originated signals. */
  agentPlaybackAllowed: boolean;
  limit?: number;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isAgentOriginated(metadata: unknown) {
  const object = jsonObject(metadata);
  return object.source === "agent_session" || object.agentOriginated === true;
}

function completionRatio(metadata: unknown): number | null {
  const ratio = jsonObject(jsonObject(metadata).outcome).completionRatio;
  return typeof ratio === "number" && Number.isFinite(ratio) ? ratio : null;
}

function isPositive(signal: EmbeddingSeedSignal) {
  if (SAVE_ACTIONS.has(signal.action)) return true;
  return (
    signal.action === "complete" &&
    (completionRatio(signal.metadata) ?? -1) >= SEED_COMPLETION_THRESHOLD
  );
}

function isSuppressed(signal: EmbeddingSeedSignal, policy: TasteMemoryPolicy) {
  const blocked = (type: "genre" | "mood" | "artist", value?: string | null) =>
    hasSignal(policy.hidden, type, value) || hasSignal(policy.downranked, type, value);
  if (blocked("genre", signal.genre)) return true;
  if ((signal.moods ?? []).some((mood) => blocked("mood", mood))) return true;
  return (signal.artistNames ?? []).some((name) => blocked("artist", name));
}

/**
 * Picks the seed track ids: positive signals only, newest first, one seed per
 * track, up to `limit`. Pure: the caller supplies the signals and the consent
 * state, so every rule above is testable without a database.
 */
export function selectEmbeddingSeeds(
  signals: readonly EmbeddingSeedSignal[],
  context: EmbeddingSeedContext,
): string[] {
  const limit = context.limit ?? EMBEDDING_SEED_LIMIT;
  const resetAt = context.policy.resetAt;
  const ordered = [...signals].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() ||
      a.trackId.localeCompare(b.trackId),
  );
  const seeds: string[] = [];
  const seen = new Set<string>();
  for (const signal of ordered) {
    if (seeds.length >= limit) break;
    if (seen.has(signal.trackId)) continue;
    if (resetAt && signal.createdAt.getTime() <= resetAt.getTime()) continue;
    if (!context.agentPlaybackAllowed && isAgentOriginated(signal.metadata)) continue;
    if (!isPositive(signal)) continue;
    if (isSuppressed(signal, context.policy)) continue;
    seen.add(signal.trackId);
    seeds.push(signal.trackId);
  }
  return seeds;
}

/**
 * The listener's newest positive signals, after the reset marker, with the
 * track fields the seed rules read. One bounded query; tracks that were removed
 * from the catalog simply have no row to join, and the vector lookup later
 * drops tracks without an embedding.
 */
export async function loadEmbeddingSeedSignals(
  userId: string,
  resetAt?: Date,
): Promise<EmbeddingSeedSignal[]> {
  const rows = await prisma.agentSignal.findMany({
    where: {
      userId,
      action: { in: ["save", "add_to_playlist", "complete"] },
      ...(resetAt ? { createdAt: { gt: resetAt } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: SEED_SIGNAL_READ_CAP,
    select: {
      trackId: true,
      action: true,
      createdAt: true,
      metadata: true,
      track: {
        select: {
          artist: true,
          release: {
            select: {
              genre: true,
              moods: true,
              primaryArtist: true,
              artist: { select: { displayName: true } },
            },
          },
        },
      },
    },
  });
  return rows.map((row) => ({
    trackId: row.trackId,
    action: row.action,
    createdAt: row.createdAt,
    metadata: row.metadata,
    genre: row.track.release.genre,
    moods: row.track.release.moods,
    artistNames: [
      row.track.artist,
      row.track.release.primaryArtist,
      row.track.release.artist?.displayName,
    ],
  }));
}
