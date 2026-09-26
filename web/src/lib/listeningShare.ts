/**
 * Listening share model: the deep link, UTM attribution, and channel copy used
 * when a listener shares the track they are playing.
 *
 * Copy rules (keep them honest):
 * - The only money claim allowed is that the artist keeps at least 85% of
 *   every sale (ADR-BM-4 wording), and ONLY when something of the track is
 *   actually for sale (`forSale`). Without a sale there is nothing to
 *   "support directly": the copy is a plain invitation to listen.
 * - Only tracks with mixer stems may say they can be pulled apart stem by
 *   stem in the Resonate mixer.
 * - When the artist has a live show campaign, the copy may invite fans to
 *   back it by title, linking the campaign page.
 * - No other numbers, no "free", no per-listen payout or income claims.
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
  /** True only when a license/sale for this track is available right now. */
  forSale?: boolean;
  /**
   * The artist's live show campaign. `url` may be a site path (resolved
   * against the share origin) or an absolute URL.
   */
  campaign?: { title: string; url: string } | null;
};

export type ShareMessageOptions = {
  /** Site origin used to absolutize the campaign link. */
  origin?: string;
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

/**
 * Absolute, attributable link to the artist's show campaign, or null when it
 * cannot be made absolute (no origin for a relative path) or is malformed.
 */
export function listeningCampaignUrl(
  origin: string | undefined,
  campaignUrl: string | null | undefined,
  channel: ShareChannel,
): string | null {
  const raw = campaignUrl?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(raw, origin?.trim() || undefined);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.searchParams.set("utm_source", channel);
  url.searchParams.set("utm_medium", channel === "copy" || channel === "native" ? "share" : "social");
  url.searchParams.set("utm_campaign", "listening_share");
  return url.toString();
}

export function listeningShareMessage(
  track: ShareableTrack,
  channel: ShareChannel,
  options: ShareMessageOptions = {},
): { title: string; text: string } {
  const title = cleanTitle(track.title);
  const artist = cleanArtist(track.artist);
  const copy: ShareCopy = {
    hasStems: !!track.hasStems,
    forSale: !!track.forSale,
    variant: variantIndex(track),
    campaign: shareCampaign(track, channel, options.origin),
  };

  const nativeTitle = `${quotedWork(title, artist)} on Resonate`;

  if (channel === "reddit") {
    return { title: fitRedditTitle(title, artist, copy.forSale), text: "" };
  }
  if (channel === "x" || channel === "facebook") {
    return { title: nativeTitle, text: fitXText(title, artist, copy) };
  }
  // native + copy: the X text without hashtags, untruncated.
  return {
    title: nativeTitle,
    text: [headline(title, artist), hook(artist, copy), copy.campaign ? campaignLine(artist, copy.campaign) : null]
      .filter(Boolean)
      .join("\n\n"),
  };
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
  /** Only when true may the 85% sale claim be made. */
  forSale?: boolean;
}): string {
  const title = cleanTitle(input.title);
  const artist = cleanArtist(input.artist);
  const details = normalize(input.details);
  const closing = input.hasStems
    ? input.forSale
      ? ` Stream it or remix the stems; ${ARTIST_SHARE_CLAIM}.`
      : " Stream it or remix the stems."
    : input.forSale
      ? ` ${capitalize(ARTIST_SHARE_CLAIM)}.`
      : "";
  const build = (t: string, a: string | null, d: string) =>
    `Listen to ${quotedWork(t, a)} on Resonate${d ? ` — ${d}` : ""}.${closing}`;

  const full = build(title, artist, details);
  if (full.length <= RELEASE_DESCRIPTION_MAX_LENGTH) return full;
  return shrinkToFit((t, a) => build(t, a, ""), title, artist, (text) => text.length <= RELEASE_DESCRIPTION_MAX_LENGTH);
}

const URL_IN_TEXT = /https?:\/\/\S+/gi;

/**
 * X-weighted length: most Latin/punctuation code points count 1, others
 * (emoji, CJK, "…") count 2. Conservative for emoji sequences. Links inside
 * the text count as a t.co URL (23), whatever their real length.
 */
export function xWeightedLength(text: string): number {
  const urls = text.match(URL_IN_TEXT) ?? [];
  let length = urls.length * X_URL_LENGTH;
  for (const char of text.replace(URL_IN_TEXT, "")) {
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

type ShareCopy = {
  hasStems: boolean;
  forSale: boolean;
  variant: number;
  campaign: { title: string; url: string } | null;
};

/** Campaign titles are capped so the link and the rest of the post still fit. */
const CAMPAIGN_TITLE_MAX_LENGTH = 60;

function shareCampaign(
  track: ShareableTrack,
  channel: ShareChannel,
  origin: string | undefined,
): { title: string; url: string } | null {
  const title = normalize(track.campaign?.title);
  const url = listeningCampaignUrl(origin, track.campaign?.url, channel);
  if (!title || !url) return null;
  return { title: truncate(title, CAMPAIGN_TITLE_MAX_LENGTH), url };
}

function hook(artist: string | null, copy: Pick<ShareCopy, "hasStems" | "forSale" | "variant">) {
  if (!copy.forSale) {
    // Nothing is for sale: invite listening only — no "support directly",
    // no sale claim.
    return copy.hasStems
      ? "Listen on Resonate, or pull it apart stem by stem in the mixer."
      : "Listen on Resonate.";
  }
  const supportWho = artist ? `Support ${artist} directly` : "Support the music directly";
  const variants = copy.hasStems
    ? [
        `Listen on Resonate, or pull it apart stem by stem in the Resonate mixer. ${capitalize(ARTIST_SHARE_CLAIM)}.`,
        `${supportWho} on Resonate, or pull the track apart stem by stem in the mixer. ${capitalize(ARTIST_SHARE_CLAIM)}.`,
      ]
    : [
        `Listen on Resonate, where ${ARTIST_SHARE_CLAIM}.`,
        `${supportWho} on Resonate: ${ARTIST_SHARE_CLAIM}.`,
      ];
  return variants[copy.variant % variants.length];
}

function campaignLine(artist: string | null, campaign: { title: string; url: string }) {
  const whose = artist ? `${artist}'s` : "the artist's";
  return `Back ${whose} show campaign "${campaign.title}": ${campaign.url}`;
}

function fitXText(title: string, artist: string | null, copy: ShareCopy) {
  const fits = (text: string) => xPostLength(text) <= X_MAX_LENGTH;
  const join = (...parts: Array<string | null>) => parts.filter(Boolean).join("\n\n");
  const campaign = copy.campaign;
  // Most complete first; with a campaign, drop hashtags and then the hook
  // before squeezing the title/artist, so the campaign link always fits.
  const candidates: Array<(t: string, a: string | null) => string> = campaign
    ? [
        (t, a) => join(headline(t, a), hook(a, copy), campaignLine(a, campaign), X_HASHTAGS),
        (t, a) => join(headline(t, a), hook(a, copy), campaignLine(a, campaign)),
        (t, a) => join(headline(t, a), campaignLine(a, campaign), X_HASHTAGS),
      ]
    : [(t, a) => join(headline(t, a), hook(a, copy), X_HASHTAGS)];

  for (const build of candidates) {
    const text = build(title, artist);
    if (fits(text)) return text;
  }
  let text = "";
  for (const build of candidates) {
    text = shrinkToFit(build, title, artist, fits);
    if (fits(text)) return text;
  }
  return text;
}

function fitRedditTitle(title: string, artist: string | null, forSale: boolean) {
  const build = (t: string, a: string | null) =>
    forSale
      ? `${quotedWork(t, a)} — listen on Resonate (artists keep at least 85% of every sale)`
      : `${quotedWork(t, a)} — listen on Resonate`;
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
