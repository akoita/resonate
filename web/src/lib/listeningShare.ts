/**
 * Listening share model: the deep link, UTM attribution, and channel copy used
 * when a listener shares the track they are playing.
 *
 * Copy rules (keep them honest): the only claims allowed are that the artist
 * keeps at least 85% of every sale (ADR-BM-4 wording) and, only for tracks
 * with mixer stems, that the track can be pulled apart stem by stem in the
 * Resonate mixer. No other numbers, no "free", no per-listen payout claims.
 */
import { publicReleaseHref } from "./artistRoutes";

export type ShareChannel = "x" | "facebook" | "reddit" | "native" | "copy";

export type ShareableTrack = {
  title: string;
  artist?: string | null;
  releaseId?: string | null;
  catalogTrackId?: string | null;
  trackId?: string | null;
  hasStems?: boolean;
};

export const ARTIST_SHARE_CLAIM = "the artist keeps at least 85% of every sale";

/** X counts every link as a t.co URL of this length. */
export const X_URL_LENGTH = 23;
export const X_MAX_LENGTH = 280;
export const REDDIT_TITLE_MAX_LENGTH = 300;
export const RELEASE_DESCRIPTION_MAX_LENGTH = 200;

const X_HASHTAGS = "#NowPlaying #Resonate";
const UNKNOWN_ARTISTS = new Set(["unknown", "unknown artist", "various artists"]);

/** True when any stem is usable in the mixer (anything but original/master). */
export function hasMixerStems(stems?: ReadonlyArray<{ type?: string | null }> | null): boolean {
  return !!stems?.some((stem) => {
    const type = stem?.type?.trim().toLowerCase();
    return !!type && type !== "original" && type !== "master";
  });
}

/**
 * Public, attributable link to the track's release page, or null when the
 * track has no public page (local or private files).
 */
export function listeningShareUrl(
  origin: string,
  track: ShareableTrack,
  channel: ShareChannel,
): string | null {
  const releaseId = track.releaseId?.trim();
  if (!releaseId) return null;
  const params = new URLSearchParams({
    utm_source: channel,
    utm_medium: channel === "copy" || channel === "native" ? "share" : "social",
    utm_campaign: "listening_share",
  });
  return `${origin.replace(/\/+$/, "")}${publicReleaseHref(releaseId)}?${params.toString()}`;
}

export function listeningShareMessage(
  track: ShareableTrack,
  channel: ShareChannel,
): { title: string; text: string } {
  const title = cleanTitle(track.title);
  const artist = cleanArtist(track.artist);
  const variant = variantIndex(track);
  const hasStems = !!track.hasStems;

  const nativeTitle = `${quotedWork(title, artist)} on Resonate`;

  if (channel === "reddit") {
    return { title: fitRedditTitle(title, artist), text: "" };
  }
  if (channel === "x" || channel === "facebook") {
    return { title: nativeTitle, text: fitXText(title, artist, hasStems, variant) };
  }
  // native + copy: the X text without hashtags, untruncated.
  return { title: nativeTitle, text: `${headline(title, artist)}\n\n${hook(artist, hasStems, variant)}` };
}

/**
 * Social-card description for a public release page (Open Graph / Twitter).
 * Details are dropped first, then title/artist shortened, to stay within the
 * metadata budget.
 */
export function releaseShareDescription(input: {
  title: string;
  artist?: string | null;
  details?: string | null;
  hasStems?: boolean;
}): string {
  const title = cleanTitle(input.title);
  const artist = cleanArtist(input.artist);
  const details = normalize(input.details);
  const closing = input.hasStems
    ? `Stream it or remix the stems; ${ARTIST_SHARE_CLAIM}.`
    : `${capitalize(ARTIST_SHARE_CLAIM)}.`;
  const build = (t: string, a: string | null, d: string) =>
    `Listen to ${quotedWork(t, a)} on Resonate${d ? ` — ${d}` : ""}. ${closing}`;

  const full = build(title, artist, details);
  if (full.length <= RELEASE_DESCRIPTION_MAX_LENGTH) return full;
  return shrinkToFit((t, a) => build(t, a, ""), title, artist, (text) => text.length <= RELEASE_DESCRIPTION_MAX_LENGTH);
}

/**
 * X-weighted length: most Latin/punctuation code points count 1, others
 * (emoji, CJK, "…") count 2. Conservative for emoji sequences.
 */
export function xWeightedLength(text: string): number {
  let length = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    const light =
      cp <= 0x10ff ||
      (cp >= 0x2000 && cp <= 0x200d) ||
      (cp >= 0x2010 && cp <= 0x201f) ||
      (cp >= 0x2032 && cp <= 0x2037);
    length += light ? 1 : 2;
  }
  return length;
}

/** Length X will count for the posted text + the separator + the t.co link. */
export function xPostLength(text: string): number {
  return xWeightedLength(text) + 1 + X_URL_LENGTH;
}

function headline(title: string, artist: string | null) {
  return `🎧 Now playing: ${quotedWork(title, artist)}`;
}

function hook(artist: string | null, hasStems: boolean, variant: number) {
  const supportWho = artist ? `Support ${artist} directly` : "Support the music directly";
  const variants = hasStems
    ? [
        `Listen on Resonate, or pull it apart stem by stem in the Resonate mixer. ${capitalize(ARTIST_SHARE_CLAIM)}.`,
        `${supportWho} on Resonate, or pull the track apart stem by stem in the mixer. ${capitalize(ARTIST_SHARE_CLAIM)}.`,
      ]
    : [
        `Listen on Resonate, where ${ARTIST_SHARE_CLAIM}.`,
        `${supportWho} on Resonate: ${ARTIST_SHARE_CLAIM}.`,
      ];
  return variants[variant % variants.length];
}

function xText(title: string, artist: string | null, hasStems: boolean, variant: number) {
  return `${headline(title, artist)}\n\n${hook(artist, hasStems, variant)}\n\n${X_HASHTAGS}`;
}

function fitXText(title: string, artist: string | null, hasStems: boolean, variant: number) {
  return shrinkToFit(
    (t, a) => xText(t, a, hasStems, variant),
    title,
    artist,
    (text) => xPostLength(text) <= X_MAX_LENGTH,
  );
}

function fitRedditTitle(title: string, artist: string | null) {
  const build = (t: string, a: string | null) =>
    `${quotedWork(t, a)} — listen on Resonate (artists keep at least 85% of every sale)`;
  return shrinkToFit(build, title, artist, (text) => text.length <= REDDIT_TITLE_MAX_LENGTH);
}

/** Shorten title/artist together (longest first) until the built text fits. */
function shrinkToFit(
  build: (title: string, artist: string | null) => string,
  title: string,
  artist: string | null,
  fits: (text: string) => boolean,
): string {
  let text = build(title, artist);
  if (fits(text)) return text;
  for (let max = Math.max(title.length, artist?.length ?? 0) - 1; max >= 1; max -= 1) {
    text = build(truncate(title, max), artist ? truncate(artist, max) : null);
    if (fits(text)) return text;
  }
  return text;
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  if (max <= 1) return "…";
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function quotedWork(title: string, artist: string | null) {
  return artist ? `"${title}" by ${artist}` : `"${title}"`;
}

function normalize(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanTitle(value: unknown) {
  return normalize(value) || "Untitled";
}

function cleanArtist(value: unknown): string | null {
  const artist = normalize(value);
  if (!artist || UNKNOWN_ARTISTS.has(artist.toLowerCase())) return null;
  return artist;
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/** Deterministic variant pick so a feed of shares is not identical. */
function variantIndex(track: ShareableTrack) {
  const key = track.catalogTrackId || track.trackId || track.releaseId || track.title || "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
