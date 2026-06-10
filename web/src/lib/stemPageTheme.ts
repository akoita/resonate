/**
 * Stem detail page theming (#1145). Each stem type carries the accent color
 * already used by the marketplace badge system, so a stem page inherits a
 * consistent color identity (artwork ring, ambient glow, section markers)
 * without inventing a parallel palette.
 */

export type StemTypeTheme = {
  /** Marketplace badge class, e.g. stem-type-badge--vocals. */
  badgeClass: string;
  emoji: string;
  /** Solid accent, rgb triplet string for composing rgba(...) values. */
  accentRgb: string;
};

const THEMES: Record<string, StemTypeTheme> = {
  vocals: { badgeClass: "stem-type-badge--vocals", emoji: "🎤", accentRgb: "168, 85, 247" },
  drums: { badgeClass: "stem-type-badge--drums", emoji: "🥁", accentRgb: "249, 115, 22" },
  bass: { badgeClass: "stem-type-badge--bass", emoji: "🎸", accentRgb: "59, 130, 246" },
  melody: { badgeClass: "stem-type-badge--melody", emoji: "🎹", accentRgb: "236, 72, 153" },
};

const FALLBACK_THEME: StemTypeTheme = {
  badgeClass: "stem-type-badge--other",
  emoji: "🎵",
  accentRgb: "16, 185, 129",
};

export function stemTypeTheme(type?: string | null): StemTypeTheme {
  const normalized = (type ?? "").toLowerCase();
  if (THEMES[normalized]) return THEMES[normalized];
  if (normalized === "piano" || normalized === "guitar" || normalized === "melody") {
    return THEMES.melody;
  }
  return FALLBACK_THEME;
}

/**
 * Compact "time left" label for an active listing. Returns null when the
 * input is missing/invalid or already expired (callers hide the chip).
 */
export function formatListingCountdown(
  expiresAt: string | Date | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!expiresAt) return null;
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const ms = expiry.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d ${hours % 24}h left`;
  if (hours >= 1) return `${hours}h ${minutes % 60}m left`;
  return `${Math.max(minutes, 1)}m left`;
}

export function shortAddress(address?: string | null): string {
  if (!address || address.length < 12) return address ?? "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The platform-generic placeholder cover served when a stem has no art. */
export function isDefaultStemCover(url?: string | null): boolean {
  return !!url && url.includes("default-stem-cover");
}

/**
 * Hero artwork preference (#1150). The token metadata image can itself be the
 * generic default cover; loading it "successfully" used to stop the fallback
 * chain before the release artwork was ever tried, leaving a vinyl placeholder
 * on stems whose release has real art. Real art always outranks the generic
 * cover: token art → release art, with the default cover demoted to last.
 */
export function orderArtworkSources(input: {
  tokenImageUrl?: string | null;
  releaseArtworkUrl?: string | null;
}): string[] {
  const token = input.tokenImageUrl ?? null;
  const release = input.releaseArtworkUrl ?? null;
  const ordered =
    token && isDefaultStemCover(token) ? [release, token] : [token, release];
  return ordered.filter((src): src is string => !!src);
}
