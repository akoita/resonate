/**
 * Public moment share surface (#1477 slice 2).
 *
 * Isomorphic, dependency-light helpers shared by the moment permalink page,
 * its `generateMetadata`, the server-rendered OG image route, the Share
 * buttons, and their tests. Deliberately free of React/CSS/`next/og` imports so
 * the pure logic (lyric masking, OG ingredients, share URL/method) can be unit
 * tested in the node vitest environment.
 *
 * CRITICAL: every public lyric render here runs through `maskSensitiveLyric`
 * (the same display-only masking the in-app cards use). A share card must never
 * broadcast socially-weighted words the in-app card deliberately masks.
 */

import { maskSensitiveLyric } from "../components/punchline/punchlineDropHelpers";

/** Public single-moment payload from `GET /punchline/moments/:id/public`. */
export interface PublicMomentShare {
  moment: {
    id: string;
    title: string;
    lyricText: string;
    artworkUrl: string | null;
    sourceStemType: string;
    startMs: number;
    endMs: number;
    clipAssetUri: string | null;
    editionSize: number;
    priceCents: number;
    rightsLabel: string;
    collectedCount: number;
  };
  drop: { id: string; title: string | null };
  track: { id: string; title: string };
  release: { id: string; title: string; artworkMimeType: string | null };
  artistName: string | null;
}

/** Edition-pride payload from `GET /punchline/collectibles/:id/public`. */
export interface PublicCollectibleShare extends PublicMomentShare {
  edition: {
    editionNumber: number;
    collectorDisplayName: string;
    acquiredAt: string | null;
  };
}

const DEFAULT_SITE_URL = "http://localhost:3001";
const DEFAULT_BACKEND_URL = "http://localhost:3000";
const OG_LYRIC_MAX = 180; // Matches the in-app card's truncation budget.
const TITLE_LYRIC_MAX = 60;

/**
 * Backend base URL for server-side fetches. Prefers the server-only
 * `BACKEND_URL`, falling back to the browser-exposed `NEXT_PUBLIC_API_URL`,
 * then local dev. Only ever called on the server.
 */
export function serverBackendBase(): string {
  return (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_BACKEND_URL
  ).replace(/\/$/, "");
}

/**
 * Absolute site origin for building shareable links. Uses the live browser
 * origin when available; otherwise `NEXT_PUBLIC_SITE_URL` (documented in
 * docs/deployment/environment.md), then local dev.
 */
export function siteBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  return (process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
}

/** Fetch the public moment payload (server-side). Returns null on any non-200. */
export async function fetchPublicMoment(
  momentId: string,
): Promise<PublicMomentShare | null> {
  try {
    const res = await fetch(
      `${serverBackendBase()}/punchline/moments/${encodeURIComponent(momentId)}/public`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as PublicMomentShare;
  } catch {
    return null;
  }
}

/**
 * Fetch the consent-gated edition-pride payload (server-side). A 404 (private
 * collector, missing, or unpublished) resolves to null — the caller silently
 * falls back to the plain moment view.
 */
export async function fetchPublicCollectible(
  collectibleId: string,
): Promise<PublicCollectibleShare | null> {
  try {
    const res = await fetch(
      `${serverBackendBase()}/punchline/collectibles/${encodeURIComponent(collectibleId)}/public`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as PublicCollectibleShare;
  } catch {
    return null;
  }
}

/** Build the shareable permalink; `?c=<collectibleId>` upgrades it to the pride view. */
export function buildMomentShareUrl(
  momentId: string,
  collectibleId?: string | null,
): string {
  const suffix = collectibleId ? `?c=${encodeURIComponent(collectibleId)}` : "";
  return `${siteBaseUrl()}/moments/${encodeURIComponent(momentId)}${suffix}`;
}

/** Trim and hard-truncate with an ellipsis. */
export function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

/**
 * Deterministic hue (0-359) — a byte-for-byte mirror of
 * `PunchlineCollectibleCard.hueFromSeed` so the OG gradient matches the in-app
 * card's accent. Kept here (rather than imported) to keep this module free of
 * the card's CSS import so it stays node-testable.
 */
export function hueFromSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return ((hash % 360) + 360) % 360;
}

/** The card's seed: display title + raw lyric (matches the in-app card). */
export function momentSeedHue(moment: { title: string; lyricText: string }): number {
  return hueFromSeed((moment.title.trim() || "Untitled moment") + moment.lyricText);
}

/**
 * Length-stepped OG poster font size (px), mirroring the `lyricPosterClass`
 * thresholds so a short slogan fills the canvas and a long verse steps down.
 */
export function ogLyricFontPx(lyric: string): number {
  const length = lyric.trim().length;
  if (length <= 70) return 76;
  if (length <= 130) return 56;
  return 40;
}

/** Editions still available for this moment. */
export function editionsRemaining(moment: {
  editionSize: number;
  collectedCount: number;
}): number {
  return Math.max(0, moment.editionSize - moment.collectedCount);
}

function priceLabel(priceCents: number): string {
  return priceCents > 0 ? `$${(priceCents / 100).toFixed(2)}` : "Free";
}

/** Metadata `<title>`: masked lyric excerpt (≤60 chars) — artist. */
export function momentShareTitle(share: PublicMomentShare): string {
  const lyric = truncate(maskSensitiveLyric(share.moment.lyricText), TITLE_LYRIC_MAX);
  const artist = share.artistName ?? "Unknown artist";
  return `“${lyric}” — ${artist}`;
}

/** Metadata description: (edition line) · track · editions left · price · rights. */
export function momentShareDescription(
  share: PublicMomentShare,
  edition?: PublicCollectibleShare["edition"] | null,
): string {
  const left = editionsRemaining(share.moment);
  const price = priceLabel(share.moment.priceCents);
  const parts: string[] = [];
  if (edition) {
    parts.push(
      `№ ${edition.editionNumber} of ${share.moment.editionSize}, collected by ${edition.collectorDisplayName}`,
    );
  }
  parts.push(`A collectible vocal moment from “${share.track.title}”`);
  parts.push(
    left > 0
      ? `${left} of ${share.moment.editionSize} editions left · ${price}`
      : `Sold out · ${price}`,
  );
  parts.push("Non-commercial collectible");
  return parts.join(" · ");
}

/** Everything the OG image draws. Pure, so masking + ingredients are testable. */
export interface OgIngredients {
  hue: number;
  gradientFrom: string;
  gradientTo: string;
  /** Masked, truncated lyric — never the raw socially-weighted text. */
  lyric: string;
  lyricFontPx: number;
  serialLabel: string;
  artistLine: string;
  wordmark: string;
  rightsLabel: string;
  editionsLabel: string;
  priceLabel: string;
}

const OG_WORDMARK = "RESONATE · DROPS";

/**
 * Build the OG ingredients from a public moment (or a branded fallback when the
 * moment is missing). `edition` is optional: the file-based `opengraph-image`
 * route only receives `params` (no `searchParams`), so it always renders the
 * generic `№ 1–{editionSize}` serial; `generateMetadata` can pass the edition
 * to reflect the pride serial in tests/derived text.
 */
export function buildOgIngredients(
  share: PublicMomentShare | null,
  edition?: { editionNumber: number } | null,
): OgIngredients {
  if (!share) {
    const hue = 262;
    return {
      hue,
      gradientFrom: `hsl(${hue}, 72%, 46%)`,
      gradientTo: `hsl(302, 64%, 22%)`,
      lyric: "A collectible vocal moment",
      lyricFontPx: 76,
      serialLabel: OG_WORDMARK,
      artistLine: "Own a piece of the hook",
      wordmark: OG_WORDMARK,
      rightsLabel: "Non-commercial collectible",
      editionsLabel: "",
      priceLabel: "",
    };
  }

  const hue = momentSeedHue(share.moment);
  const lyric = truncate(maskSensitiveLyric(share.moment.lyricText), OG_LYRIC_MAX);
  const left = editionsRemaining(share.moment);
  return {
    hue,
    gradientFrom: `hsl(${hue}, 72%, 46%)`,
    gradientTo: `hsl(${(hue + 40) % 360}, 64%, 22%)`,
    lyric: lyric || "…",
    lyricFontPx: ogLyricFontPx(lyric),
    serialLabel: edition
      ? `№ ${edition.editionNumber}`
      : `№ 1–${share.moment.editionSize}`,
    artistLine: `${share.artistName ?? "Unknown artist"} · ${share.track.title}`,
    wordmark: OG_WORDMARK,
    rightsLabel: share.moment.rightsLabel,
    editionsLabel: left > 0 ? `${left} of ${share.moment.editionSize} left` : "Sold out",
    priceLabel: priceLabel(share.moment.priceCents),
  };
}

export type ShareMethod = "web_share" | "clipboard";

interface NavigatorShareLike {
  share?: (data: { url?: string; title?: string; text?: string }) => Promise<void>;
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

/**
 * Perform a native share, falling back to clipboard copy. `nav` is injectable
 * for testing. Throws when neither capability exists, or rethrows the Web Share
 * cancellation (`AbortError`) for the caller to ignore via {@link isShareCancel}.
 */
export async function performMomentShare(
  data: { url: string; title: string; text: string },
  nav: NavigatorShareLike | undefined = typeof navigator !== "undefined"
    ? (navigator as NavigatorShareLike)
    : undefined,
): Promise<ShareMethod> {
  if (nav && typeof nav.share === "function") {
    await nav.share({ url: data.url, title: data.title, text: data.text });
    return "web_share";
  }
  if (nav?.clipboard && typeof nav.clipboard.writeText === "function") {
    await nav.clipboard.writeText(data.url);
    return "clipboard";
  }
  throw new Error("no_share_available");
}

/** True when a share rejection was the user cancelling the native sheet. */
export function isShareCancel(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  );
}

/** Compact share sheet copy for a moment (masked lyric + artist). */
export function momentShareText(input: {
  lyricText: string;
  artistName?: string | null;
}): string {
  const lyric = truncate(maskSensitiveLyric(input.lyricText), TITLE_LYRIC_MAX);
  const artist = input.artistName?.trim();
  return artist ? `“${lyric}” — ${artist}` : `“${lyric}”`;
}
