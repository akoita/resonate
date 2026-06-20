export const REMIX_STEM_GAIN_DB_MIN = -24;
export const REMIX_STEM_GAIN_DB_MAX = 6;

export function isValidRemixStemGainDb(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= REMIX_STEM_GAIN_DB_MIN &&
    value <= REMIX_STEM_GAIN_DB_MAX
  );
}

/** Defensive normalization for legacy or provider-supplied render inputs. */
export function normalizeRemixStemGainDb(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(
    REMIX_STEM_GAIN_DB_MAX,
    Math.max(REMIX_STEM_GAIN_DB_MIN, value),
  );
}
