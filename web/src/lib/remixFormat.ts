/**
 * Remix Studio display formatters shared by the editor and its panels
 * (#1879).
 */

/**
 * Recorded generation cost for display (#1320). Only positive recorded
 * values render — $0 renders (stem mix) stay unlabelled rather than noisy.
 */
export function formatDraftCost(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return `~$${value.toFixed(2)}`;
}
