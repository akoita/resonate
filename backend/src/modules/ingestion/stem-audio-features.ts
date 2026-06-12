/**
 * Boundary sanitization for worker-reported stem audio features (#1184).
 *
 * The demucs worker is an internal service, but its payload still crosses a
 * trust boundary (Pub/Sub message / HTTP response): numbers are clamped and
 * shape-checked here so malformed features are dropped with a warning and
 * can never 500 ingestion or persist garbage.
 */

export const STEM_AUDIO_FEATURES_SCHEMA_VERSION = "stem-audio-features/v1";

const BPM_MIN = 30;
const BPM_MAX = 300;

export type SanitizedStemAudioFeatures = {
  schemaVersion: typeof STEM_AUDIO_FEATURES_SCHEMA_VERSION;
  extractor: { name: string; version: string | null };
  sampleRate: number | null;
  durationSeconds: number | null;
  tempoBpm: number | null;
  tempoConfidence: number | null;
  beatCount: number | null;
  firstBeatSec: number | null;
  key: { tonic: string; mode: "major" | "minor"; confidence: number | null } | null;
  energyRms: number | null;
  onsetDensity: number | null;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegative(value: unknown): number | null {
  const num = finiteNumber(value);
  return num !== null && num >= 0 ? num : null;
}

function unitInterval(value: unknown): number | null {
  const num = finiteNumber(value);
  if (num === null) return null;
  return Math.min(1, Math.max(0, num));
}

function sanitizeKey(raw: unknown): SanitizedStemAudioFeatures["key"] {
  if (!raw || typeof raw !== "object") return null;
  const key = raw as { tonic?: unknown; mode?: unknown; confidence?: unknown };
  if (typeof key.tonic !== "string" || !key.tonic.trim()) return null;
  if (key.mode !== "major" && key.mode !== "minor") return null;
  return {
    tonic: key.tonic,
    mode: key.mode,
    confidence: unitInterval(key.confidence),
  };
}

/**
 * Returns the sanitized feature object, or null when the payload is not a
 * recognizable v1 feature dict (callers log and skip persistence).
 */
export function sanitizeStemAudioFeatures(
  raw: unknown,
): SanitizedStemAudioFeatures | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (input.schemaVersion !== STEM_AUDIO_FEATURES_SCHEMA_VERSION) return null;

  const extractorRaw =
    input.extractor && typeof input.extractor === "object"
      ? (input.extractor as { name?: unknown; version?: unknown })
      : null;
  const extractorName =
    extractorRaw && typeof extractorRaw.name === "string"
      ? extractorRaw.name
      : null;
  if (!extractorName) return null;

  const tempoRaw = finiteNumber(input.tempoBpm);
  const tempoBpm =
    tempoRaw !== null && tempoRaw >= BPM_MIN && tempoRaw <= BPM_MAX
      ? tempoRaw
      : null;

  const beatCountRaw = nonNegative(input.beatCount);

  return {
    schemaVersion: STEM_AUDIO_FEATURES_SCHEMA_VERSION,
    extractor: {
      name: extractorName,
      version:
        typeof extractorRaw?.version === "string" ? extractorRaw.version : null,
    },
    sampleRate: nonNegative(input.sampleRate),
    durationSeconds: nonNegative(input.durationSeconds),
    tempoBpm,
    tempoConfidence: unitInterval(input.tempoConfidence),
    beatCount: beatCountRaw !== null ? Math.floor(beatCountRaw) : null,
    firstBeatSec: nonNegative(input.firstBeatSec),
    key: sanitizeKey(input.key),
    energyRms: nonNegative(input.energyRms),
    onsetDensity: nonNegative(input.onsetDensity),
  };
}
