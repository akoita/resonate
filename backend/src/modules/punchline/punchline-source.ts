import { ConfigService } from "@nestjs/config";

/**
 * Golden Moments source layers (#1476 slice 1).
 *
 * A moment is a range on the track; the source LAYER it is clipped from is a
 * choice: the vocals stem (the default, as for a rap punchline), any other
 * separated stem, or the full mix. The layer is stored on
 * `PunchlineMoment.sourceStemType` (a free string column since #479).
 *
 * The full mix is the layer name `full`. It resolves to the track's stored
 * full-mix row: `original` for an uploaded track, `master` for a published
 * remix (see shared/stem-source.ts `MIX_STEM_TYPES`).
 *
 * Which layers an artist may pick is operational policy, so the allowlist is
 * env-tunable (`PUNCHLINE_SOURCE_LAYERS`, comma-separated). Pure; no I/O.
 */

/** The default layer: unchanged from the vocals-only MVP. */
export const PUNCHLINE_DEFAULT_SOURCE_LAYER = "vocals";

/** Layer name for the full mix. */
export const PUNCHLINE_FULL_MIX_LAYER = "full";

/** Stored stem types that hold the full mix of a track. */
export const PUNCHLINE_FULL_MIX_STEM_TYPES = ["original", "master"] as const;

/**
 * Every layer the code knows how to clip: the htdemucs_6s stems plus the full
 * mix. The env allowlist can narrow this set, never widen it.
 */
export const PUNCHLINE_KNOWN_SOURCE_LAYERS = [
  "vocals",
  "drums",
  "bass",
  "guitar",
  "piano",
  "other",
  PUNCHLINE_FULL_MIX_LAYER,
] as const;

/** Labels for messages ("No processed full mix…"). */
const LAYER_LABELS: Record<string, string> = {
  vocals: "vocals stem",
  drums: "drums stem",
  bass: "bass stem",
  guitar: "guitar stem",
  piano: "piano stem",
  other: "other stem",
  [PUNCHLINE_FULL_MIX_LAYER]: "full mix",
};

export function normalizeSourceLayer(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Human label for a layer, for reason messages. */
export function sourceLayerLabel(layer: string): string {
  return LAYER_LABELS[layer] ?? `${layer} stem`;
}

/** Stored stem types that provide the audio of a layer. */
export function stemTypesForSourceLayer(layer: string): string[] {
  return layer === PUNCHLINE_FULL_MIX_LAYER
    ? [...PUNCHLINE_FULL_MIX_STEM_TYPES]
    : [layer];
}

/** The layer a stored stem type belongs to, or null if it is not clippable. */
export function sourceLayerForStemType(type: string | null | undefined): string | null {
  const normalized = normalizeSourceLayer(type);
  if ((PUNCHLINE_FULL_MIX_STEM_TYPES as readonly string[]).includes(normalized)) {
    return PUNCHLINE_FULL_MIX_LAYER;
  }
  return (PUNCHLINE_KNOWN_SOURCE_LAYERS as readonly string[]).includes(normalized)
    ? normalized
    : null;
}

/**
 * The allowed source layers. Unset/blank env → every known layer. Unknown
 * names are dropped; an allowlist that keeps nothing falls back to the
 * default layer alone, so a typo can never open or close every track.
 */
export function resolvePunchlineSourceLayers(
  configService?: ConfigService,
): string[] {
  const raw = configService?.get<string>("PUNCHLINE_SOURCE_LAYERS");
  if (typeof raw !== "string" || raw.trim() === "") {
    return [...PUNCHLINE_KNOWN_SOURCE_LAYERS];
  }
  const known = new Set<string>(PUNCHLINE_KNOWN_SOURCE_LAYERS);
  const picked = Array.from(
    new Set(raw.split(",").map(normalizeSourceLayer).filter((l) => known.has(l))),
  );
  return picked.length > 0 ? picked : [PUNCHLINE_DEFAULT_SOURCE_LAYER];
}
