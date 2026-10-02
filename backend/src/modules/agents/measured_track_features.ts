import {
  camelotCode,
  keyConfidenceCutoff,
  sanitizeStemAudioFeatures,
  stemAnalysisRevision,
} from "../ingestion/stem-audio-features";

/**
 * Measured full-mix track features (#1960), read from the current `original`
 * stem's `audioFeatures` (schema `stem-audio-features/v1`, shipped in #1959).
 * Each field is either a measured value or null; callers fall back to the
 * metadata-inferred value for anything null. The key is usable when its
 * confidence reaches the cutoff of the payload's analysis revision (0.1 for
 * revisions 1-2, 0.05 from revision 3, #2018).
 */

// The extractor's tempo confidence is a beat-vs-average onset strength ratio mapped to (0,1); 0.5 means beats are no stronger than average.
export const MEASURED_TEMPO_MIN_CONFIDENCE = 0.5;

/** Raw mean RMS that maps to full loudness in the energy composite. */
export const MEASURED_ENERGY_RMS_FULL_SCALE = 0.3;
/** Onsets per second that map to full rhythmic activity in the composite. */
export const MEASURED_ENERGY_ONSET_FULL_SCALE = 8;
export const MEASURED_ENERGY_RMS_WEIGHT = 0.65;
export const MEASURED_ENERGY_ONSET_WEIGHT = 0.35;

export type MeasuredTrackFeatures = {
  tempoBpm: number | null;
  tempoConfidence: number | null;
  key: { tonic: string; mode: "major" | "minor"; confidence: number } | null;
  camelot: string | null;
  energy: number | null;
};

export const EMPTY_MEASURED_TRACK_FEATURES: MeasuredTrackFeatures = {
  tempoBpm: null,
  tempoConfidence: null,
  key: null,
  camelot: null,
  energy: null,
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function measuredTrackFeatures(raw: unknown): MeasuredTrackFeatures {
  const sanitized = sanitizeStemAudioFeatures(raw);
  if (!sanitized) return { ...EMPTY_MEASURED_TRACK_FEATURES };

  const tempoMeasured =
    sanitized.tempoBpm !== null &&
    sanitized.tempoConfidence !== null &&
    sanitized.tempoConfidence >= MEASURED_TEMPO_MIN_CONFIDENCE;

  const revision = stemAnalysisRevision(sanitized);
  const keyMeasured =
    sanitized.key !== null &&
    sanitized.key.confidence !== null &&
    sanitized.key.confidence >= keyConfidenceCutoff(revision);

  let camelot: string | null = null;
  if (keyMeasured) {
    const stored =
      raw && typeof raw === "object"
        ? (raw as { camelot?: unknown }).camelot
        : undefined;
    camelot =
      typeof stored === "string" && stored.trim()
        ? stored
        : camelotCode(sanitized.key, revision);
  }

  const energy =
    sanitized.energyRms !== null
      ? Number(
          clamp01(
            MEASURED_ENERGY_RMS_WEIGHT *
              clamp01(sanitized.energyRms / MEASURED_ENERGY_RMS_FULL_SCALE) +
              MEASURED_ENERGY_ONSET_WEIGHT *
                clamp01(
                  (sanitized.onsetDensity ?? 0) / MEASURED_ENERGY_ONSET_FULL_SCALE,
                ),
          ).toFixed(4),
        )
      : null;

  return {
    tempoBpm: tempoMeasured ? sanitized.tempoBpm : null,
    tempoConfidence: tempoMeasured ? sanitized.tempoConfidence : null,
    key:
      keyMeasured && sanitized.key
        ? {
            tonic: sanitized.key.tonic,
            mode: sanitized.key.mode,
            confidence: sanitized.key.confidence as number,
          }
        : null,
    camelot,
    energy,
  };
}

export function hasMeasuredTrackFeatures(features: MeasuredTrackFeatures) {
  return (
    features.tempoBpm !== null ||
    features.key !== null ||
    features.energy !== null
  );
}
