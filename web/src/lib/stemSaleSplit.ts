/**
 * Split of a source stem sale per licence tier (#2599).
 *
 * The numbers come from the server (`GET /api/stem-pricing/split`), which
 * reads the configured take-rates. Nothing here invents a share: a response
 * that does not add up, or that leaves the artist under the floor it states,
 * is rejected and the UI shows no numbers.
 */
import { API_BASE } from "./api";

export const STEM_SALE_TIERS = ["personal", "remix", "commercial"] as const;
export type StemSaleTier = (typeof STEM_SALE_TIERS)[number];

export interface StemSaleTierSplit {
  platformFeeBps: number;
  artistBps: number;
}

export interface StemSaleSplit {
  minArtistBps: number;
  tiers: Record<StemSaleTier, StemSaleTierSplit>;
}

const BPS = 10_000;

function isBps(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= BPS;
}

/** Validate a server answer. Returns null when it cannot be trusted. */
export function parseStemSaleSplit(raw: unknown): StemSaleSplit | null {
  if (!raw || typeof raw !== "object") return null;
  const { minArtistBps, tiers } = raw as { minArtistBps?: unknown; tiers?: unknown };
  if (!isBps(minArtistBps) || !tiers || typeof tiers !== "object") return null;
  const parsed = {} as Record<StemSaleTier, StemSaleTierSplit>;
  for (const tier of STEM_SALE_TIERS) {
    const entry = (tiers as Record<string, unknown>)[tier] as
      | { platformFeeBps?: unknown; artistBps?: unknown }
      | undefined;
    if (!entry || !isBps(entry.platformFeeBps) || !isBps(entry.artistBps)) return null;
    if (entry.platformFeeBps + entry.artistBps !== BPS) return null;
    if (entry.artistBps < minArtistBps) return null;
    parsed[tier] = { platformFeeBps: entry.platformFeeBps, artistBps: entry.artistBps };
  }
  return { minArtistBps, tiers: parsed };
}

export async function fetchStemSaleSplit(signal?: AbortSignal): Promise<StemSaleSplit> {
  const response = await fetch(`${API_BASE}/api/stem-pricing/split`, { signal });
  if (!response.ok) throw new Error(`Split request failed (${response.status})`);
  const split = parseStemSaleSplit(await response.json());
  if (!split) throw new Error("The server returned a split that does not add up");
  return split;
}

/** "15%" or "12.5%" from basis points. */
export function formatSplitPercent(bps: number): string {
  const percent = bps / 100;
  if (Number.isInteger(percent)) return `${percent}%`;
  return `${percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/**
 * The artist's part of a price, rounded down to a hundredth of a cent so it
 * never overstates (per-play prices are a few cents).
 */
export function artistNetUsd(priceUsd: number, artistBps: number): number | null {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  return Math.floor(priceUsd * artistBps + 1e-6) / 10_000;
}

/** "$4.50", or "$0.0425" when the amount needs more than cents. */
export function formatSplitUsd(value: number): string {
  const fixed = value.toFixed(4);
  if (fixed.endsWith("00")) return `$${fixed.slice(0, -2)}`;
  return `$${fixed.replace(/0$/, "")}`;
}
