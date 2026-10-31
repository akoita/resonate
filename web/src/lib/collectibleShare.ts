/**
 * Tailored collectible shares (#1917, parent #1915).
 *
 * Two share moments, one toolkit:
 * - **after_collect** — a fan shares the edition they just collected (or one
 *   from their Moments tab). Links the moment permalink (OG card), upgraded to
 *   the consent-gated edition-pride view with `?c=<collectibleId>`.
 * - **drop_page** — anyone shares a drop (or a single public moment) to invite
 *   people to collect. States the price, or that it is free, honestly.
 *
 * Copy rules (ADR-BM-4, keep them honest):
 * - Collectibles are utility, not yield: no investment, value, appreciation,
 *   royalty, income, or return wording. The only money claim allowed is that
 *   the artist keeps at least 85% of the sale, and ONLY when a sale actually
 *   happened (paid collect) or is available (paid moments still on sale).
 *   Never for a free claim.
 * - Every lyric runs through `maskSensitiveLyric` before it is rendered.
 * - X posts fit the 280-character budget with links counted as 23 (t.co).
 *
 * These shares are deliberately separate from the player's listening share
 * (`listeningShare.ts`), which must never gain collectible or drop details.
 */

import { maskSensitiveLyric } from "../components/punchline/punchlineDropHelpers";
import { publicReleaseHref } from "./artistRoutes";
import {
  REDDIT_TITLE_MAX_LENGTH,
  X_MAX_LENGTH,
  xPostLength,
  type ShareChannel,
} from "./listeningShare";
import { buildMomentShareUrl, siteBaseUrl, truncate } from "./momentShare";

export type { ShareChannel } from "./listeningShare";

export const COLLECTIBLE_SHARE_CAMPAIGN = "collectible_share";

/** Why the share was offered. Sent as the `trigger` on `punchline.moment_shared`. */
export type CollectibleShareTrigger = "after_collect" | "drop_page";

/** Sale claim for a paid collect (a sale happened). */
export const COLLECT_SALE_CLAIM = "the artist keeps at least 85% of the sale";
/** Sale claim for a drop with paid editions still on sale. */
export const DROP_SALE_CLAIM = "the artist keeps at least 85% of each sale";

const LYRIC_MAX = 60;
/** Drop/track titles are capped so the link and the required lines always fit. */
const WORK_MAX = 60;
const X_HASHTAGS = "#Resonate #Drops";
const UNKNOWN_ARTISTS = new Set(["unknown", "unknown artist", "various artists"]);

/** Add `utm_*` attribution (campaign `collectible_share`) to an absolute URL. */
export function withCollectibleUtm(url: string, channel: ShareChannel): string {
  const parsed = new URL(url);
  parsed.searchParams.set("utm_source", channel);
  parsed.searchParams.set(
    "utm_medium",
    channel === "copy" || channel === "native" ? "share" : "social",
  );
  parsed.searchParams.set("utm_campaign", COLLECTIBLE_SHARE_CAMPAIGN);
  return parsed.toString();
}

/** Attributable moment permalink; `collectibleId` upgrades it to the pride view. */
export function collectedMomentShareUrl(
  momentId: string,
  collectibleId: string | null | undefined,
  channel: ShareChannel,
): string {
  return withCollectibleUtm(buildMomentShareUrl(momentId, collectibleId), channel);
}

/** Attributable link to a drop: the release page focused on its moments. */
export function dropShareUrl(
  releaseId: string,
  channel: ShareChannel,
  origin: string = siteBaseUrl(),
): string {
  return withCollectibleUtm(
    `${origin.replace(/\/+$/, "")}${publicReleaseHref(releaseId)}?focus=moments`,
    channel,
  );
}

export type ShareMessage = { title: string; text: string };

export type CollectedMomentShareInput = {
  lyricText: string;
  artistName?: string | null;
  trackTitle?: string | null;
  /** The fan's own edition number; omitted when unknown. */
  editionNumber?: number | null;
  editionSize?: number | null;
  /** What the fan paid. > 0 is a paid collect (the only case the sale claim is made). */
  pricePaidCents: number;
  /** Delivery held during the withdrawal period (#1776): the edition is reserved, not yet delivered. */
  held?: boolean;
  /** Editions still available, when known: a free invite is only made while some are left. */
  editionsLeft?: number | null;
};

/** Share copy for an edition the fan collected (trigger `after_collect`). */
export function collectedMomentShareMessage(
  input: CollectedMomentShareInput,
  channel: ShareChannel,
): ShareMessage {
  const artist = cleanArtist(input.artistName);
  const track = truncate(clean(input.trackTitle), WORK_MAX);
  const paid = input.pricePaidCents > 0;
  const edition =
    input.editionNumber && input.editionNumber > 0
      ? input.editionSize && input.editionSize > 0
        ? `edition №${input.editionNumber} of ${input.editionSize}`
        : `edition №${input.editionNumber}`
      : null;
  const action = edition
    ? input.held
      ? `${capitalize(edition)} is reserved for me on Resonate.`
      : `I collected ${edition} on Resonate.`
    : input.held
      ? "This moment is reserved for me on Resonate."
      : "I collected this moment on Resonate.";
  const trackLine = track ? `A vocal moment from "${track}".` : null;
  const closing = paid
    ? `${capitalize(COLLECT_SALE_CLAIM)}.`
    : input.editionsLeft === 0
      ? null
      : "Free to collect while editions last.";

  const title = "A moment I collected on Resonate";

  if (channel === "reddit") {
    const build = (lyric: string) =>
      [
        `${quote(lyric, artist)}: ${action.replace(/\.$/, "")}`,
        paid ? ` (${COLLECT_SALE_CLAIM})` : "",
      ].join("");
    return {
      title: fitLyric(input.lyricText, build, (t) => t.length <= REDDIT_TITLE_MAX_LENGTH),
      text: "",
    };
  }

  const head = (lyric: string) => quote(lyric, artist);
  if (channel === "x" || channel === "facebook") {
    return { title, text: fitX(input.lyricText, head, [action], [trackLine, closing]) };
  }
  return {
    title,
    text: join(head(maskedLyric(input.lyricText)), action, trackLine, closing),
  };
}

export type DropShareMoment = {
  priceCents: number;
  editionSize: number;
  collectedCount: number;
};

export type DropShareInput = {
  dropTitle?: string | null;
  trackTitle?: string | null;
  artistName?: string | null;
  moments: ReadonlyArray<DropShareMoment>;
  /** Sharing a single moment (permalink): its lyric leads the post, masked. */
  lyricText?: string | null;
};

/** Honest price summary for what is still available in a drop. */
export function dropPriceSummary(moments: ReadonlyArray<DropShareMoment>): {
  soldOut: boolean;
  /** Paid editions are still on sale: the only case the sale claim is made. */
  paidAvailable: boolean;
  line: string;
} {
  const available = moments.filter((m) => m.collectedCount < m.editionSize);
  if (available.length === 0) {
    return { soldOut: true, paidAvailable: false, line: "Every edition has been collected." };
  }
  const paid = available.filter((m) => m.priceCents > 0).map((m) => m.priceCents);
  const freeCount = available.length - paid.length;
  if (paid.length === 0) {
    return { soldOut: false, paidAvailable: false, line: "Free to collect while editions last." };
  }
  const min = Math.min(...paid);
  const max = Math.max(...paid);
  const price = dollars(min);
  if (freeCount > 0) {
    return {
      soldOut: false,
      paidAvailable: true,
      line: `Some editions are free to collect; others are ${price}${max > min ? " and up" : ""}.`,
    };
  }
  return {
    soldOut: false,
    paidAvailable: true,
    line: max > min ? `Editions from ${price}.` : `${price} an edition.`,
  };
}

/** Share copy inviting people to collect from a drop (trigger `drop_page`). */
export function dropShareMessage(input: DropShareInput, channel: ShareChannel): ShareMessage {
  const artist = cleanArtist(input.artistName);
  const dropTitle = clean(input.dropTitle);
  const track = clean(input.trackTitle);
  const price = dropPriceSummary(input.moments);
  const work = truncate(dropTitle || track, WORK_MAX);
  const subject = work ? `"${work}"` : "a drop";
  const invite = price.soldOut
    ? `Limited-edition vocal moments from ${subject} on Resonate.`
    : `Collect a limited-edition vocal moment from ${subject} on Resonate.`;
  const claim = price.paidAvailable ? `${capitalize(DROP_SALE_CLAIM)}.` : null;
  const lyric = clean(input.lyricText);
  const headFor = (l: string) =>
    lyric ? quote(l, artist) : artist ? `🎤 A drop from ${artist}` : "🎤 A drop on Resonate";
  const title = artist ? `A drop from ${artist} on Resonate` : "A drop on Resonate";

  if (channel === "reddit") {
    const build = (l: string) =>
      [
        lyric ? `${quote(l, artist)}: ` : artist ? `${artist}: ` : "",
        invite.replace(/\.$/, ""),
        ` (${decapitalize(price.line.replace(/\.$/, ""))}`,
        claim ? `; ${DROP_SALE_CLAIM})` : ")",
      ].join("");
    return {
      title: fitLyric(lyric, build, (t) => t.length <= REDDIT_TITLE_MAX_LENGTH, false),
      text: "",
    };
  }
  if (channel === "x" || channel === "facebook") {
    return { title, text: fitX(lyric, headFor, [invite, price.line], [claim]) };
  }
  return { title, text: join(headFor(maskedLyric(lyric)), invite, price.line, claim) };
}

// --- helpers ---------------------------------------------------------------

function maskedLyric(lyric: string): string {
  return truncate(maskSensitiveLyric(lyric), LYRIC_MAX);
}

/**
 * Fit an X post: required lines always stay; optional lines are dropped (last
 * first) with the hashtags; then the lyric is shortened. The lyric is masked
 * before any length is measured.
 */
function fitX(
  lyric: string,
  head: (lyric: string) => string,
  required: ReadonlyArray<string | null>,
  optional: ReadonlyArray<string | null>,
): string {
  const fits = (text: string) => xPostLength(text) <= X_MAX_LENGTH;
  const opt = optional.filter((line): line is string => !!line);
  const build = (l: string, keep: number, tags: boolean) =>
    join(head(l), ...required, ...opt.slice(0, keep), tags ? X_HASHTAGS : null);

  const full = maskedLyric(lyric);
  for (let keep = opt.length; keep >= 0; keep -= 1) {
    for (const tags of [true, false]) {
      const text = build(full, keep, tags);
      if (fits(text)) return text;
    }
  }
  const masked = maskSensitiveLyric(lyric).trim();
  for (let max = Math.min(masked.length, LYRIC_MAX) - 1; max >= 1; max -= 1) {
    const text = build(truncate(masked, max), 0, false);
    if (fits(text)) return text;
  }
  return build("…", 0, false);
}

function fitLyric(
  lyric: string,
  build: (lyric: string) => string,
  fits: (text: string) => boolean,
  required = true,
): string {
  const masked = maskSensitiveLyric(lyric).trim();
  if (!masked && !required) return build("");
  let text = build(truncate(masked, LYRIC_MAX));
  if (fits(text)) return text;
  for (let max = Math.min(masked.length, LYRIC_MAX) - 1; max >= 1; max -= 1) {
    text = build(truncate(masked, max));
    if (fits(text)) return text;
  }
  return text;
}

function quote(lyric: string, artist: string | null): string {
  const body = lyric || "…";
  return artist ? `“${body}” — ${artist}` : `“${body}”`;
}

function join(...parts: ReadonlyArray<string | null>): string {
  return parts.filter(Boolean).join("\n\n");
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanArtist(value: unknown): string | null {
  const artist = truncate(clean(value), 60);
  if (!artist || UNKNOWN_ARTISTS.has(artist.toLowerCase())) return null;
  return artist;
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function decapitalize(value: string): string {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
