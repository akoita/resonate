/**
 * Stem gain range for the Remix Studio mixer. Lives in lib so the studio
 * editor and its session lanes (#1879) share it without an import cycle.
 */
export const GAIN_DB_MIN = -24;
export const GAIN_DB_MAX = 6;

export function clampGainDb(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(GAIN_DB_MAX, Math.max(GAIN_DB_MIN, value));
}
