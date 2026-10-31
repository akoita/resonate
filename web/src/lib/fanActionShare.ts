/**
 * Tailored shares for the remaining fan-action moments of #1915: a stem
 * license purchase and a published remix. Campaign and collectible shares
 * live in `campaignShare.ts` and `collectibleShare.ts`; the player's
 * listening share (`listeningShare.ts`) stays a plain listening signal.
 *
 * Copy rules (ADR-BM-4, keep them honest):
 * - License share: the only money claim allowed is that the artist keeps at
 *   least 85% of the sale, and ONLY when the purchase was a sale by the stem's
 *   creator (`artistSale`). A resale by another holder pays that holder, so the
 *   claim would be false there and is left out. Never the price paid, the
 *   payment method, a receipt, a transaction, or a wallet.
 * - Remix share: no money claim at all. The remix is a release, not a stake.
 * - No yield, income, royalty-share, value, or "investment" wording.
 * - X posts fit the 280-character budget with links counted as 23 (t.co).
 */

import { publicReleaseHref } from "./artistRoutes";
import {
  REDDIT_TITLE_MAX_LENGTH,
  X_MAX_LENGTH,
  truncate,
  xPostLength,
  type ShareChannel,
} from "./listeningShare";

export type { ShareChannel } from "./listeningShare";

export const LICENSE_SHARE_CAMPAIGN = "license_share";
export const REMIX_SHARE_CAMPAIGN = "remix_share";

/** The license share is offered right after a finished purchase. */
export type LicenseShareTrigger = "after_purchase";
/** The remix share is offered right after publishing. */
export type RemixShareTrigger = "after_publish";

export type ShareLicenseType = "personal" | "remix" | "commercial";

/** Sale claim for a stem sold by its own creator (a sale happened). */
export const LICENSE_SALE_CLAIM = "the artist keeps at least 85% of the sale";

const NAME_MAX = 60;
const LICENSE_HASHTAGS = "#Resonate #Stems";
const REMIX_HASHTAGS = "#Remix #Resonate";
const UNKNOWN_ARTISTS = new Set(["unknown", "unknown artist", "various artists"]);
/** Stem types that do not name a part a fan would recognise. */
const GENERIC_STEM_TYPES = new Set(["other", "original", "master", "mix", "stem", "unknown"]);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN_ID_PATTERN = /^\d{1,78}$/;

export type ShareMessage = { title: string; text: string };

/** Add `utm_*` attribution for one of the action-share campaigns. */
export function withActionShareUtm(url: string, channel: ShareChannel, campaign: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("utm_source", channel);
  parsed.searchParams.set(
    "utm_medium",
    channel === "copy" || channel === "native" ? "share" : "social",
  );
  parsed.searchParams.set("utm_campaign", campaign);
  return parsed.toString();
}

// --- stem license ------------------------------------------------------------

/** Attributable link to the public stem page (it has its own social card). */
export function licenseShareUrl(origin: string, tokenId: string, channel: ShareChannel): string {
  return withActionShareUtm(
    `${origin.replace(/\/+$/, "")}/stem/${encodeURIComponent(tokenId)}`,
    channel,
    LICENSE_SHARE_CAMPAIGN,
  );
}

export type LicenseShareInput = {
  stemType?: string | null;
  trackTitle?: string | null;
  artistName?: string | null;
  licenseType?: ShareLicenseType | string | null;
  /**
   * True only when the stem's creator sold it (a primary sale). Only then is
   * the at-least-85% claim made.
   */
  artistSale: boolean;
};

type LicenseParts = { stem: string; track: string; artist: string | null; use: string };

/** Share copy for a stem license the fan just bought (trigger `after_purchase`). */
export function licenseShareMessage(input: LicenseShareInput, channel: ShareChannel): ShareMessage {
  const parts: LicenseParts = {
    stem: stemPhrase(input.stemType),
    track: truncate(clean(input.trackTitle), NAME_MAX),
    artist: cleanArtist(input.artistName),
    use: licenseUse(input.licenseType),
  };
  const claim = input.artistSale ? `${capitalize(LICENSE_SALE_CLAIM)}.` : null;
  const title = "A stem I licensed on Resonate";
  const action = (p: LicenseParts) => `I licensed ${p.stem}${work(p.track, p.artist)} on Resonate${p.use}.`;

  if (channel === "reddit") {
    const build = (p: LicenseParts) =>
      `${action(p).replace(/\.$/, "")}${input.artistSale ? ` (${LICENSE_SALE_CLAIM})` : ""}`;
    return { title: shrink(build, parts, (t) => t.length <= REDDIT_TITLE_MAX_LENGTH), text: "" };
  }
  if (channel === "x" || channel === "facebook") {
    return { title, text: fitX(action, parts, claim, LICENSE_HASHTAGS) };
  }
  return { title, text: join(action(parts), claim) };
}

/**
 * The compact `marketplace.license_shared` analytics input: the stem token id,
 * the listing id when known, the channel and the trigger. No price, payment
 * method, receipt, transaction, or wallet.
 */
export function licenseShareAnalytics(
  ids: { tokenId: string; listingId?: string | null },
  channel: ShareChannel,
) {
  const listingId = ids.listingId && TOKEN_ID_PATTERN.test(ids.listingId) ? ids.listingId : undefined;
  return {
    source: "buy_modal",
    subjectType: "stem_token",
    subjectId: ids.tokenId,
    payload: {
      tokenId: ids.tokenId,
      ...(listingId ? { listingId } : {}),
      channel,
      trigger: "after_purchase" as LicenseShareTrigger,
    },
  };
}

/**
 * Whether a finished purchase was a sale by the stem's creator. x402 checkout
 * pays the artist directly; a wallet purchase is one only when the listing's
 * seller is the creator. Unknown addresses never count.
 */
export function isArtistSale(input: {
  method: "onchain" | "x402";
  seller?: string | null;
  creator?: string | null;
}): boolean {
  if (input.method === "x402") return true;
  const seller = input.seller?.trim().toLowerCase();
  const creator = input.creator?.trim().toLowerCase();
  if (!seller || !creator || /^0x0{40}$/.test(seller)) return false;
  return seller === creator;
}

// --- remix publish -----------------------------------------------------------

/** Attributable link to the published remix release page. */
export function remixShareUrl(origin: string, releaseId: string, channel: ShareChannel): string {
  return withActionShareUtm(
    `${origin.replace(/\/+$/, "")}${publicReleaseHref(releaseId)}`,
    channel,
    REMIX_SHARE_CAMPAIGN,
  );
}

export type RemixShareInput = {
  remixTitle?: string | null;
  sourceTrackTitle?: string | null;
  sourceArtistName?: string | null;
};

type RemixParts = { remix: string; track: string; artist: string | null };

/** Share copy for a remix the fan just published (trigger `after_publish`). */
export function remixShareMessage(input: RemixShareInput, channel: ShareChannel): ShareMessage {
  const parts: RemixParts = {
    remix: truncate(clean(input.remixTitle), NAME_MAX),
    track: truncate(clean(input.sourceTrackTitle), NAME_MAX),
    artist: cleanArtist(input.sourceArtistName),
  };
  const action = (p: RemixParts) => {
    const source = p.track ? `my remix${work(p.track, p.artist)}` : "my remix";
    return p.remix
      ? `I just published "${p.remix}", ${source}, on Resonate.`
      : `I just published ${source} on Resonate.`;
  };
  const title = "My remix on Resonate";

  if (channel === "reddit") {
    const build = (p: RemixParts) => action(p).replace(/\.$/, "");
    return { title: shrink(build, parts, (t) => t.length <= REDDIT_TITLE_MAX_LENGTH), text: "" };
  }
  const invite = "Have a listen.";
  if (channel === "x" || channel === "facebook") {
    return { title, text: fitX(action, parts, invite, REMIX_HASHTAGS) };
  }
  return { title, text: join(action(parts), invite) };
}

/**
 * The compact `remix.published_shared` analytics input: the remix release id,
 * the project id, the channel and the trigger.
 */
export function remixShareAnalytics(
  ids: { releaseId: string; projectId?: string | null },
  channel: ShareChannel,
) {
  const projectId = ids.projectId && ID_PATTERN.test(ids.projectId) ? ids.projectId : undefined;
  return {
    source: "remix_studio",
    subjectType: "release",
    subjectId: ids.releaseId,
    payload: {
      releaseId: ids.releaseId,
      ...(projectId ? { projectId } : {}),
      channel,
      trigger: "after_publish" as RemixShareTrigger,
    },
  };
}

// --- helpers -----------------------------------------------------------------

function stemPhrase(stemType: unknown): string {
  const type = clean(stemType).toLowerCase();
  if (!type || GENERIC_STEM_TYPES.has(type)) return "a stem";
  return `the ${truncate(type, 24)} stem`;
}

function licenseUse(licenseType: unknown): string {
  if (licenseType === "remix") return " to remix it";
  if (licenseType === "commercial") return " for commercial use";
  return "";
}

/** ` of "Track" by Artist`, ` of "Track"`, or nothing. */
function work(track: string, artist: string | null): string {
  if (track) return artist ? ` of "${track}" by ${artist}` : ` of "${track}"`;
  return artist ? ` by ${artist}` : "";
}

/**
 * Fit an X post: the action line always stays; the optional line, then the
 * hashtags, are dropped first; then names are shortened.
 */
function fitX<P extends Record<string, string | null>>(
  action: (p: P) => string,
  parts: P,
  optional: string | null,
  hashtags: string,
): string {
  const fits = (text: string) => xPostLength(text) <= X_MAX_LENGTH;
  for (const [opt, tags] of [
    [optional, hashtags],
    [optional, null],
    [null, hashtags],
    [null, null],
  ] as const) {
    const text = join(action(parts), opt, tags);
    if (fits(text)) return text;
  }
  return shrink(action, parts, fits);
}

/** Shorten every name (longest first) until the text fits. */
function shrink<P extends Record<string, string | null>>(
  build: (p: P) => string,
  parts: P,
  fits: (text: string) => boolean,
): string {
  let text = build(parts);
  if (fits(text)) return text;
  const longest = Math.max(...Object.values(parts).map((v) => v?.length ?? 0));
  for (let max = longest - 1; max >= 1; max -= 1) {
    const shortened = Object.fromEntries(
      Object.entries(parts).map(([k, v]) => [k, k === "use" || k === "stem" || !v ? v : truncate(v, max)]),
    ) as P;
    text = build(shortened);
    if (fits(text)) return text;
  }
  return text;
}

function join(...parts: ReadonlyArray<string | null>): string {
  return parts.filter(Boolean).join("\n\n");
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanArtist(value: unknown): string | null {
  const artist = truncate(clean(value), NAME_MAX);
  if (!artist || UNKNOWN_ARTISTS.has(artist.toLowerCase())) return null;
  return artist;
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
