import type { PunchlineClipBoundsMs, PunchlineEligibility, Track } from "../../lib/api";

/**
 * Golden Moments source layers (#1476). A moment is a range on the track; the
 * layer it is clipped from is the artist's choice: the vocals stem (default),
 * any other stem, or the full mix. Mirrors backend punchline-source.ts.
 */

export const DEFAULT_SOURCE_LAYER = "vocals";
export const FULL_MIX_LAYER = "full";

/** Known layers in picker order, with their labels. */
export const SOURCE_LAYER_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["vocals", "Vocals"],
  ["drums", "Drums"],
  ["bass", "Bass"],
  ["guitar", "Guitar"],
  ["piano", "Piano"],
  ["other", "Other"],
  [FULL_MIX_LAYER, "Full mix"],
];

const LABEL_BY_LAYER = new Map(SOURCE_LAYER_LABELS);
const FULL_MIX_STEM_TYPES = new Set(["original", "master"]);

export function sourceLayerLabel(layer: string | null | undefined): string {
  const key = layer?.trim().toLowerCase() ?? "";
  return LABEL_BY_LAYER.get(key) ?? (key || DEFAULT_SOURCE_LAYER);
}

/** The layer a stored stem type belongs to, or null if it can't be clipped. */
export function sourceLayerForStemType(type?: string | null): string | null {
  const key = type?.trim().toLowerCase() ?? "";
  if (FULL_MIX_STEM_TYPES.has(key)) return FULL_MIX_LAYER;
  return LABEL_BY_LAYER.has(key) ? key : null;
}

/** One pickable source for a track: the layer plus the stem row that plays it. */
export type MomentSourceOption = {
  layer: string;
  label: string;
  stemId: string;
  durationSeconds: number | null;
};

/** The pickable sources of a track, in picker order (vocals first, full mix last). */
export function momentSourceOptions(track: Track): MomentSourceOption[] {
  const byLayer = new Map<string, MomentSourceOption>();
  for (const stem of track.stems ?? []) {
    const layer = sourceLayerForStemType(stem.type);
    if (!layer || byLayer.has(layer)) continue;
    byLayer.set(layer, {
      layer,
      label: sourceLayerLabel(layer),
      stemId: stem.id,
      durationSeconds: stem.durationSeconds ?? null,
    });
  }
  return SOURCE_LAYER_LABELS.map(([layer]) => byLayer.get(layer)).filter(
    (option): option is MomentSourceOption => !!option,
  );
}

/** Tracks with at least one pickable source: the only ones a drop can use. */
export function tracksWithMomentSource(tracks: Track[]): Track[] {
  return tracks.filter((track) => momentSourceOptions(track).length > 0);
}

/**
 * Keep only the options the server reports as allowed and processed. An older
 * server that sends no list keeps the vocals-only behaviour.
 */
export function availableMomentSources(
  options: MomentSourceOption[],
  eligibility: Pick<PunchlineEligibility, "availableSourceLayers"> | null,
): MomentSourceOption[] {
  const available = eligibility?.availableSourceLayers ?? [DEFAULT_SOURCE_LAYER];
  return options.filter((option) => available.includes(option.layer));
}

/** Vocals when present (the rap default), otherwise the first source. */
export function defaultSourceLayer(options: MomentSourceOption[]): string | null {
  if (options.some((o) => o.layer === DEFAULT_SOURCE_LAYER)) return DEFAULT_SOURCE_LAYER;
  return options[0]?.layer ?? null;
}

/** Server clip bounds for a layer, falling back to the stem bounds. */
export function clipBoundsForLayer(
  eligibility: Pick<PunchlineEligibility, "clipBoundsMs" | "clipBoundsMsByLayer">,
  layer: string,
): PunchlineClipBoundsMs {
  return eligibility.clipBoundsMsByLayer?.[layer] ?? eligibility.clipBoundsMs;
}

/** True for the missing-source reason, old (`no_vocals_stem`) or new code. */
export function isMissingSourceReason(code: string): boolean {
  return code === "no_source_stem" || code === "no_vocals_stem";
}
