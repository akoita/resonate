import {
  GENRE_FAMILIES,
  normalizeGenreTerm,
  releaseGenreFamilies,
} from "./genre_families";

/**
 * In-session steering (#2247): what the listener did during THIS AI DJ session
 * nudges the next picks. Vision-neutral quality (ADR-BM-6): no money, payout or
 * fee is read or changed, and nothing new is stored. Every input is an existing
 * AgentSignal row of the session.
 *
 * The contract (Sprint 39 decision on #2247):
 *  - the signal is a ranking term of at most +-15 points (`SESSION_STEERING_MAX_POINTS`);
 *  - completes and saves count +, skips ("Not this" writes a skip) count -;
 *  - an event is matched to a candidate by genre family and by credited artist;
 *  - an event halves after 4 further picks (`SESSION_STEERING_HALF_LIFE_PICKS`);
 *  - it works INSIDE a request tier: tiers are chosen first and score second, so
 *    this term can reorder tracks of one tier and never moves one across tiers.
 *
 * This file is pure (no Prisma, no Nest): the signal maths is specified by
 * `session_steering.spec.ts`. The loader lives in `DiscoveryPolicyContextService`.
 */

export const SESSION_STEERING_MAX_POINTS = 15;
export const SESSION_STEERING_HALF_LIFE_PICKS = 4;
/** Points one fresh event adds for a shared genre family. */
export const SESSION_STEERING_FAMILY_POINTS = 5;
/** Points one fresh event adds for the same credited artist. */
export const SESSION_STEERING_ARTIST_POINTS = 5;
/** Most distinct (track, direction) events one steering reads. */
export const SESSION_STEERING_MAX_EVENTS = 40;

/** AgentSignal actions that steer towards what was heard or kept. */
export const SESSION_STEERING_POSITIVE_ACTIONS = ["complete", "save"] as const;
/** AgentSignal actions that steer away ("Not this" and the player's skip both record `skip`). */
export const SESSION_STEERING_NEGATIVE_ACTIONS = ["skip"] as const;
export const SESSION_STEERING_ACTIONS: readonly string[] = [
  ...SESSION_STEERING_POSITIVE_ACTIONS,
  ...SESSION_STEERING_NEGATIVE_ACTIONS,
];

/** What a track is matched on. */
export interface SteeringTrackFacts {
  /** Genre family ids (see `steeringFamilyIds`). */
  families: readonly string[];
  /** Credited-artist key (`discoveryArtistKey`), or null when the track has no credit. */
  artistKey: string | null;
}

export interface SteeringEvent extends SteeringTrackFacts {
  direction: 1 | -1;
  /** Picks the session made after the event; the event halves every 4 of them. */
  picksAfter: number;
}

export interface SessionSteering {
  events: readonly SteeringEvent[];
}

const BROAD_FAMILY_IDS: ReadonlySet<string> = new Set(
  GENRE_FAMILIES.filter((family) => family.broad).map((family) => family.id),
);

/**
 * The genre family ids a track steers on: its release genre's families plus the
 * stored descriptor's families. Narrow families win over broad ones ("world",
 * "african", "electronic", "latin"), so skipping one Afrobeats track does not
 * lean on the whole of World; a track with only broad families keeps them, and a
 * genre no family knows is matched on its own normalized label.
 */
export function steeringFamilyIds(
  genre: string | null | undefined,
  descriptorFamilies?: readonly string[] | null,
): string[] {
  const ids = new Set<string>([
    ...(genre ? releaseGenreFamilies(genre).map((family) => family.id) : []),
    ...(descriptorFamilies ?? []).filter(Boolean),
  ]);
  const narrow = [...ids].filter((id) => !BROAD_FAMILY_IDS.has(id));
  if (narrow.length > 0) return narrow;
  if (ids.size > 0) return [...ids];
  const label = genre ? normalizeGenreTerm(genre) : "";
  return label ? [`genre:${label}`] : [];
}

/** The artist key when it names a performer; an uncredited track (`track:<id>`) matches nobody else. */
export function steeringArtistKey(discoveryKey: string | null | undefined): string | null {
  if (!discoveryKey || discoveryKey.startsWith("track:")) return null;
  return discoveryKey;
}

/** 1 for an event with no pick after it, 1/2 after 4 picks, 1/4 after 8. */
export function steeringDecay(picksAfter: number): number {
  const picks = Number.isFinite(picksAfter) ? Math.max(0, picksAfter) : 0;
  return 0.5 ** (picks / SESSION_STEERING_HALF_LIFE_PICKS);
}

/**
 * The steering points for one candidate: the sum over events of
 * `direction x decay x (artist points if the same credited artist + family points
 * if a genre family is shared)`, bounded to +-`SESSION_STEERING_MAX_POINTS` and
 * rounded. Zero when nothing matches, so a session with no events ranks exactly
 * as it did before.
 */
export function steeringPointsFor(
  facts: SteeringTrackFacts,
  steering: SessionSteering | undefined,
): number {
  if (!steering || steering.events.length === 0) return 0;
  const families = new Set(facts.families);
  let total = 0;
  for (const event of steering.events) {
    let match = 0;
    if (event.artistKey && facts.artistKey === event.artistKey) match += SESSION_STEERING_ARTIST_POINTS;
    if (event.families.some((id) => families.has(id))) match += SESSION_STEERING_FAMILY_POINTS;
    if (match > 0) total += event.direction * steeringDecay(event.picksAfter) * match;
  }
  const bounded = Math.max(-SESSION_STEERING_MAX_POINTS, Math.min(SESSION_STEERING_MAX_POINTS, total));
  // Half a point rounds away from zero both ways, so a skip and a save weigh the same.
  const rounded = Math.sign(bounded) * Math.round(Math.abs(bounded));
  return rounded === 0 ? 0 : rounded;
}

export interface SteeringSignalRow {
  trackId: string;
  action: string;
  createdAt: Date;
}

/**
 * The session's steering events from its AgentSignal rows. A track counts once
 * per direction (a track that was both finished and saved is one "+", the
 * player's skip next to a "Not this" on one track is one "-"), by its latest
 * row. `pickTimes` are the times the session's picks were made: an event's age
 * is how many of them came after it. A row whose track is unknown, or has
 * neither a family nor a credited artist, steers nothing and is left out.
 */
export function buildSteeringEvents(input: {
  signals: readonly SteeringSignalRow[];
  pickTimes: readonly Date[];
  facts: ReadonlyMap<string, SteeringTrackFacts>;
}): SteeringEvent[] {
  const latest = new Map<string, { direction: 1 | -1; trackId: string; createdAt: Date }>();
  for (const row of input.signals) {
    const direction = directionOf(row.action);
    if (!direction) continue;
    const key = `${direction}:${row.trackId}`;
    const held = latest.get(key);
    if (!held || row.createdAt.getTime() > held.createdAt.getTime()) {
      latest.set(key, { direction, trackId: row.trackId, createdAt: row.createdAt });
    }
  }
  const pickMs = input.pickTimes.map((time) => time.getTime());
  return [...latest.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, SESSION_STEERING_MAX_EVENTS)
    .flatMap((entry) => {
      const facts = input.facts.get(entry.trackId);
      if (!facts || (facts.families.length === 0 && !facts.artistKey)) return [];
      const at = entry.createdAt.getTime();
      return [
        {
          direction: entry.direction,
          picksAfter: pickMs.filter((time) => time > at).length,
          families: facts.families,
          artistKey: facts.artistKey,
        },
      ];
    });
}

function directionOf(action: string): 1 | -1 | undefined {
  if ((SESSION_STEERING_POSITIVE_ACTIONS as readonly string[]).includes(action)) return 1;
  if ((SESSION_STEERING_NEGATIVE_ACTIONS as readonly string[]).includes(action)) return -1;
  return undefined;
}
