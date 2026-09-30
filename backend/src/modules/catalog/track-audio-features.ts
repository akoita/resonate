import {
  hasMeasuredTrackFeatures,
  measuredTrackFeatures,
} from "../agents/measured_track_features";

/**
 * Public, track-level audio features (#1960). Only full-mix MEASURED values
 * are exposed: the metadata-inferred tempo the agents use internally is a hash
 * of title and genre, not a measurement, and never appears here. Fields that
 * were not measured (or fell below the confidence thresholds) are null; the
 * whole object is null when nothing was measured.
 */
export type PublicTrackAudioFeatures = {
  tempoBpm: number | null;
  tempoConfidence: number | null;
  key: { tonic: string; mode: "major" | "minor"; confidence: number } | null;
  camelot: string | null;
  energy: number | null;
  source: "measured_full_mix";
};

type StemWithFeatures = { type?: string | null; audioFeatures?: unknown };

/** Derives the public features from a track's current `original` stem. */
export function publicTrackAudioFeatures(
  stems: StemWithFeatures[] | undefined,
): PublicTrackAudioFeatures | null {
  const original = stems?.find((stem) => stem.type === "original");
  const measured = measuredTrackFeatures(original?.audioFeatures);
  if (!hasMeasuredTrackFeatures(measured)) return null;
  return { ...measured, source: "measured_full_mix" };
}

/**
 * Adds the track-level `audioFeatures` field and strips the raw per-stem
 * `audioFeatures` JSON so the stem shape of the response is unchanged.
 */
export function withPublicAudioFeatures<
  S extends StemWithFeatures,
  T extends { stems: S[] },
>(track: T) {
  const audioFeatures = publicTrackAudioFeatures(track.stems);
  const stems = track.stems.map((stem) => {
    const { audioFeatures: _raw, ...rest } = stem;
    return rest as Omit<S, "audioFeatures">;
  });
  return { ...track, stems, audioFeatures };
}
