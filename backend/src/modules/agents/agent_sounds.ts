/**
 * Catalog-aware Sounds for the AI DJ prompt (#2249 slice 2).
 *
 * The Sounds row offers genre families. A starter is only worth showing when
 * the catalog can actually fill a session from it, so the backend counts the
 * playable, promotion-eligible tracks per family once (cached, see
 * `agent_sounds.service.ts`) and each listener's request derives from that one
 * aggregate: the explicit preference is applied by picking the matching count,
 * and families are ordered by the listener's learned taste.
 *
 * This module is pure (no Prisma, no Nest): the tally, the threshold and the
 * ordering are unit-testable.
 */

import {
  GENRE_FAMILIES,
  genreOrDescriptorMatchesRequest,
  releaseGenreFamilies,
} from "../recommendations/genre_families";

export const DEFAULT_AGENT_SOUNDS_MIN_TRACKS = 3;
export const DEFAULT_AGENT_SOUNDS_CACHE_TTL_MS = 10 * 60 * 1000;

function positiveIntegerFromEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.floor(parsed));
}

/**
 * Fewest playable tracks a family needs before its Sounds starter is offered
 * (`AGENT_SOUNDS_MIN_TRACKS`, default 3), so a starter never dead-ends.
 */
export function getAgentSoundsMinTracks(): number {
  return positiveIntegerFromEnv("AGENT_SOUNDS_MIN_TRACKS", DEFAULT_AGENT_SOUNDS_MIN_TRACKS, 1);
}

/** How long the catalog aggregate is reused (`AGENT_SOUNDS_CACHE_TTL_MS`, default 10 minutes). */
export function getAgentSoundsCacheTtlMs(): number {
  return positiveIntegerFromEnv("AGENT_SOUNDS_CACHE_TTL_MS", DEFAULT_AGENT_SOUNDS_CACHE_TTL_MS, 0);
}

/** One catalog track, reduced to what family matching needs. */
export interface SoundsTrackRow {
  explicit: boolean;
  genre: string | null;
  descriptorFamilies: readonly string[] | null;
}

export interface CatalogSoundsFamilyCount {
  id: string;
  label: string;
  /** Playable tracks in the family, explicit ones included. */
  total: number;
  /** The same count without explicit tracks. */
  clean: number;
}

export interface CatalogSoundsAggregate {
  computedAt: string;
  families: CatalogSoundsFamilyCount[];
}

/**
 * Count the rows per genre family. A track counts toward a family when its
 * release genre text OR its stored descriptor families satisfy the family by
 * the shared matcher, the same one sessions and My Mix lanes use.
 */
export function tallyCatalogSounds(
  rows: Iterable<SoundsTrackRow>,
  now: Date = new Date(),
): CatalogSoundsAggregate {
  const counts = GENRE_FAMILIES.map((family) => ({
    id: family.id,
    label: family.label,
    total: 0,
    clean: 0,
  }));
  // Free-text genres repeat a lot; resolve each (genre, descriptor) pair once.
  const memo = new Map<string, boolean[]>();
  for (const row of rows) {
    const key = `${row.genre ?? ""}\u0000${(row.descriptorFamilies ?? []).join(",")}`;
    let matches = memo.get(key);
    if (!matches) {
      matches = GENRE_FAMILIES.map((family) =>
        genreOrDescriptorMatchesRequest(row.genre, row.descriptorFamilies, family.label),
      );
      memo.set(key, matches);
    }
    matches.forEach((matched, index) => {
      if (!matched) return;
      counts[index].total += 1;
      if (!row.explicit) counts[index].clean += 1;
    });
  }
  return { computedAt: now.toISOString(), families: counts };
}

/** What the listener's request returns for one family. */
export interface ListenerSoundsFamily {
  id: string;
  label: string;
  count: number;
}

export interface ListenerSounds {
  families: ListenerSoundsFamily[];
  /**
   * The offered family the listener's learned taste favours most (#2249 "New
   * artists in <family>"). Absent with no positive taste for any offered family:
   * catalog size alone is not the listener's taste.
   */
  topFamilyId?: string;
  /** The threshold applied, so clients can hide a stale family too. */
  minTracks: number;
}

/**
 * The listener's taste for each family: the positive learned genre weights,
 * each added to every family the genre belongs to.
 */
export function familyTasteWeights(
  genreWeights: Readonly<Record<string, number>> | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [genre, weight] of Object.entries(genreWeights ?? {})) {
    if (!Number.isFinite(weight) || weight <= 0) continue;
    for (const family of releaseGenreFamilies(genre)) {
      out.set(family.id, (out.get(family.id) ?? 0) + weight);
    }
  }
  return out;
}

/**
 * Apply one listener's explicit preference and taste to the shared aggregate:
 * families below the minimum are omitted; the rest are ordered by taste, then
 * by catalog count, then by label so the order is stable.
 */
export function soundsForListener(
  aggregate: CatalogSoundsAggregate,
  options: {
    allowExplicit: boolean;
    genreWeights?: Readonly<Record<string, number>> | null;
    minTracks?: number;
  },
): ListenerSounds {
  const minTracks = options.minTracks ?? getAgentSoundsMinTracks();
  const taste = familyTasteWeights(options.genreWeights);
  const families = aggregate.families
    .map((family) => ({
      id: family.id,
      label: family.label,
      count: options.allowExplicit ? family.total : family.clean,
    }))
    .filter((family) => family.count >= minTracks)
    .sort(
      (a, b) =>
        (taste.get(b.id) ?? 0) - (taste.get(a.id) ?? 0) ||
        b.count - a.count ||
        a.label.localeCompare(b.label),
    );
  const top = families[0];
  const topFamilyId = top && (taste.get(top.id) ?? 0) > 0 ? top.id : undefined;
  return { families, minTracks, ...(topFamilyId ? { topFamilyId } : {}) };
}
