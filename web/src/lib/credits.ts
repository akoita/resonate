/**
 * Turn a credit balance (USD cents) into remaining generation capacity, using
 * the price the balance endpoint reports (#1334). Displayed as time + 1-min
 * tracks, e.g. "≈ 5 min · 5 tracks", so users read it like an LLM usage quota
 * rather than a dollar figure.
 *
 * Extracted from the Create page (#1420) into a shared, unit-tested util so
 * both the Create strip and the Remix Studio panel render the same capacity
 * semantics (#1422, WI-B).
 */
export function formatCreditCapacity(balanceCents: number, priceCentsPer30s: number) {
  const totalSeconds = priceCentsPer30s > 0 ? (balanceCents / priceCentsPer30s) * 30 : 0;
  const minutes = totalSeconds / 60;
  const tracks = Math.floor(totalSeconds / 60); // whole 1-minute tracks
  let minLabel: string;
  if (minutes >= 1) {
    const rounded = Math.round(minutes * 10) / 10;
    minLabel = Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
  } else if (totalSeconds > 0) {
    minLabel = "<1";
  } else {
    minLabel = "0";
  }
  return {
    minLabel,
    tracks,
    empty: balanceCents <= 0,
    low: balanceCents > 0 && tracks < 1,
  };
}

/**
 * Whether the balance covers at least one billable block (one 30s unit at the
 * reported price). Used to proactively gate a generate action when the balance
 * can't fund even the smallest run — the remix debit happens in a worker, so no
 * synchronous 402 reaches the studio (#1422). A non-positive price is treated as
 * affordable (the backend, not the UI, is the source of truth for cost).
 */
export function canAffordGeneration(balanceCents: number, priceCentsPer30s: number): boolean {
  if (priceCentsPer30s <= 0) return true;
  return balanceCents >= priceCentsPer30s;
}
