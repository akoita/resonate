/**
 * Boundary sanitization for worker-reported stem audio features (#1184).
 *
 * The demucs worker is an internal service, but its payload still crosses a
 * trust boundary (Pub/Sub message / HTTP response): numbers are clamped and
 * shape-checked here so malformed features are dropped with a warning and
 * can never 500 ingestion or persist garbage.
 */

export const STEM_AUDIO_FEATURES_SCHEMA_VERSION = "stem-audio-features/v1";

/**
 * Revision of the extraction method that produced a feature payload (#2016).
 * Revision 2 computes the key chroma on the harmonic part of the signal.
 * Revision 3 matches that chroma against Albrecht-Shanahan key profiles, whose
 * confidence margins sit lower (see `keyConfidenceCutoff`, #2018).
 * Payloads without the field were produced by revision 1. The schema version
 * stays v1 because the shape is unchanged.
 */
export const CURRENT_STEM_ANALYSIS_REVISION = 3;

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
  /** Extraction method revision; absent on payloads measured before #2016. */
  analysisRevision?: number;
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
 * Revision recorded in a stored or incoming feature payload: the positive
 * integer `analysisRevision`, or 1 when it is absent or invalid.
 */
export function stemAnalysisRevision(features: unknown): number {
  if (!features || typeof features !== "object" || Array.isArray(features)) {
    return 1;
  }
  const revision = (features as { analysisRevision?: unknown }).analysisRevision;
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision > 0
    ? revision
    : 1;
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

  const revisionRaw = input.analysisRevision;
  const analysisRevision =
    typeof revisionRaw === "number" &&
    Number.isSafeInteger(revisionRaw) &&
    revisionRaw > 0
      ? revisionRaw
      : null;

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
    ...(analysisRevision !== null ? { analysisRevision } : {}),
  };
}

/**
 * Minimum key confidence for a Camelot code on revisions 1-2. The extractor's
 * confidence is a best-vs-runner-up correlation margin, so low values mean an
 * ambiguous key.
 */
export const CAMELOT_MIN_KEY_CONFIDENCE = 0.1;

/** Minimum key confidence for a Camelot code from analysis revision 3 on. */
export const KEY_MIN_CONFIDENCE_FROM_REVISION_3 = 0.05;

/**
 * Key confidence cutoff for a payload of the given analysis revision.
 * Albrecht-Shanahan margins sit lower than the earlier profiles' margins;
 * 0.05 was chosen on GiantSteps + FMA so that more keys are shown and shown
 * keys are more accurate than revisions 1-2 at 0.1 (#2018).
 */
export function keyConfidenceCutoff(revision: number): number {
  return revision >= 3
    ? KEY_MIN_CONFIDENCE_FROM_REVISION_3
    : CAMELOT_MIN_KEY_CONFIDENCE;
}

export type StoredStemAudioFeatures = SanitizedStemAudioFeatures & {
  camelot: string | null;
};

// Pitch class -> Camelot number. Majors use the "B" ring, minors the "A" ring.
const CAMELOT_MAJOR: Record<string, number> = {
  C: 8,
  G: 9,
  D: 10,
  A: 11,
  E: 12,
  B: 1,
  "F#": 2,
  "C#": 3,
  "G#": 4,
  "D#": 5,
  "A#": 6,
  F: 7,
};
const CAMELOT_MINOR: Record<string, number> = {
  A: 8,
  E: 9,
  B: 10,
  "F#": 11,
  "C#": 12,
  "G#": 1,
  "D#": 2,
  "A#": 3,
  F: 4,
  C: 5,
  G: 6,
  D: 7,
};
const FLAT_TO_SHARP: Record<string, string> = {
  DB: "C#",
  EB: "D#",
  GB: "F#",
  AB: "G#",
  BB: "A#",
};

function normalizeTonic(tonic: string): string {
  const trimmed = tonic.trim().toUpperCase().replace("♯", "#").replace("♭", "B");
  return FLAT_TO_SHARP[trimmed] ?? trimmed;
}

/**
 * Camelot wheel code for a detected key (e.g. "8B" for C major, "8A" for A
 * minor), or null when the key is missing, the tonic is unrecognized, or the
 * key confidence is absent or below `keyConfidenceCutoff(revision)`. The
 * revision defaults to 1 (the stricter, pre-#2018 cutoff).
 */
export function camelotCode(
  key: SanitizedStemAudioFeatures["key"],
  revision = 1,
): string | null {
  if (!key) return null;
  if (
    key.confidence === null ||
    key.confidence < keyConfidenceCutoff(revision)
  ) {
    return null;
  }
  const tonic = normalizeTonic(key.tonic);
  if (key.mode === "major") {
    const n = CAMELOT_MAJOR[tonic];
    return n ? `${n}B` : null;
  }
  const n = CAMELOT_MINOR[tonic];
  return n ? `${n}A` : null;
}

/** Adds the derived Camelot code to sanitized features before persistence. */
export function withCamelot(
  features: SanitizedStemAudioFeatures,
): StoredStemAudioFeatures {
  return {
    ...features,
    camelot: camelotCode(features.key, stemAnalysisRevision(features)),
  };
}
