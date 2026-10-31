/**
 * Show campaign share model (#1916): the attributable campaign link, the
 * channel copy offered on the campaign page and right after a fan signals
 * demand or pledges, and the compact `shows.campaign_shared` analytics input.
 *
 * Copy rules (keep them honest — they mirror the campaign trust terms):
 * - Never imply a guaranteed show or ticket. Fans "want" the artist in a city;
 *   nothing says the show will happen.
 * - Whenever the copy says the fan pledged, it also says that everyone is
 *   refunded automatically if the show isn't booked.
 * - Never the backer's pledge amount, tier, receipt, or wallet. The inputs are
 *   public campaign fields only, so there is nothing private to leak.
 * - Only a campaign open for pledges is "backed" in the copy. Closed, refund,
 *   and terminal states get neutral copy with no call to back it.
 * - X posts stay within 280 characters with each link counted as 23.
 *
 * Pure and dependency-light so it runs in the node vitest environment.
 */
import {
  REDDIT_TITLE_MAX_LENGTH,
  X_MAX_LENGTH,
  truncate,
  xPostLength,
  type ShareChannel,
} from "./listeningShare";
import {
  NON_ACTIONABLE_CAMPAIGN_RAW_STATUSES,
  campaignDisplayTitle,
  campaignHref,
  campaignPledgeAvailability,
  daysUntil,
  isPledgeWindowClosed,
  type Campaign,
} from "./shows";

export type { ShareChannel } from "./listeningShare";

/** Where the share was offered. */
export type CampaignShareTrigger = "page" | "after_signal" | "after_pledge";

/**
 * The campaign's share-relevant state:
 * - `open`: taking pledges, so the copy may invite fans to back it.
 * - `pre_pledge`: a demand signal or a campaign not yet open for pledges.
 * - `funded`: reached its goal (or later success stages).
 * - `closed`: cancelled, failed, refunding, released, or past its deadline.
 */
export type CampaignShareState = "open" | "pre_pledge" | "funded" | "closed";

export type ShareableCampaign = Pick<
  Campaign,
  | "id"
  | "backendId"
  | "title"
  | "artistName"
  | "city"
  | "rawStatus"
  | "campaignLevel"
  | "artistAuthorityStatus"
  | "beneficiaryAddress"
  | "beneficiaryType"
  | "contractAddress"
  | "contractCampaignId"
  | "deadline"
  | "goalCents"
  | "raisedCents"
>;

export type CampaignShareOptions = {
  trigger: CampaignShareTrigger;
  /**
   * The current time. Pass it only after mount: without it the copy leaves
   * out the time-dependent "days left" and the deadline check.
   */
  nowMs?: number;
};

export const CAMPAIGN_SHARE_UTM_CAMPAIGN = "show_campaign_share";

/** Said whenever the copy states that the fan pledged. */
export const CAMPAIGN_REFUND_LINE = "If the show isn't booked, everyone is refunded automatically.";

const FUNDED_STATUSES = new Set(["funded", "booking_confirmed", "deposit_released", "fulfilled"]);

/** Absolute, attributable link to the public campaign page. */
export function campaignShareUrl(
  origin: string,
  campaign: Pick<Campaign, "id">,
  channel: ShareChannel,
): string {
  const params = new URLSearchParams({
    utm_source: channel,
    utm_medium: channel === "copy" || channel === "native" ? "share" : "social",
    utm_campaign: CAMPAIGN_SHARE_UTM_CAMPAIGN,
  });
  return `${origin.replace(/\/+$/, "")}${campaignHref(campaign)}?${params.toString()}`;
}

export function campaignShareState(campaign: ShareableCampaign, nowMs?: number): CampaignShareState {
  if (NON_ACTIONABLE_CAMPAIGN_RAW_STATUSES.has(campaign.rawStatus)) return "closed";
  if (nowMs !== undefined && isPledgeWindowClosed(campaign, nowMs)) return "closed";
  if (campaign.rawStatus === "draft") return "pre_pledge";
  if (campaignPledgeAvailability(campaign, nowMs).open) return "open";
  if (FUNDED_STATUSES.has(campaign.rawStatus)) return "funded";
  return "pre_pledge";
}

type CopyParts = {
  title: string;
  artist: string;
  city: string;
  /** "42% funded, 12 days left" — public campaign progress, or "". */
  stats: string;
};

type Builder = (parts: CopyParts) => string;

export function campaignShareMessage(
  campaign: ShareableCampaign,
  channel: ShareChannel,
  options: CampaignShareOptions,
): { title: string; text: string } {
  const parts: CopyParts = {
    title: normalize(campaignDisplayTitle(campaign)) || "Show campaign",
    artist: normalize(campaign.artistName) || "this artist",
    city: normalize(campaign.city) || "their city",
    stats: progressStats(campaign, options.nowMs),
  };
  const state = campaignShareState(campaign, options.nowMs);
  const nativeTitle = `"${parts.title}" on Resonate`;

  if (channel === "reddit") {
    const build: Builder = (p) => `${p.artist} in ${p.city}: "${p.title}", a show campaign on Resonate`;
    return { title: shrinkToFit(build, parts, (text) => text.length <= REDDIT_TITLE_MAX_LENGTH), text: "" };
  }

  const builders = copyBuilders(state, options.trigger, campaign.rawStatus);
  if (channel === "x" || channel === "facebook") {
    return { title: nativeTitle, text: fitXText(builders, parts) };
  }
  // native + copy: the most complete copy, untruncated.
  return { title: nativeTitle, text: builders[0](parts) };
}

/**
 * The compact `shows.campaign_shared` analytics input: the campaign id, the
 * channel, and the trigger only. No amounts, wallet, tier, or location.
 */
export function campaignShareAnalytics(
  campaign: Pick<Campaign, "backendId">,
  channel: ShareChannel,
  trigger: CampaignShareTrigger,
) {
  return {
    source: "shows_campaign_page",
    subjectType: "show_campaign",
    subjectId: campaign.backendId,
    payload: { campaignId: campaign.backendId, channel, trigger },
  };
}

/** Most complete first; later builders drop the progress numbers. */
function copyBuilders(state: CampaignShareState, trigger: CampaignShareTrigger, rawStatus: string): Builder[] {
  const withStats = (lead: (p: CopyParts) => string, tail = ""): Builder[] => [
    (p) => join(p.stats ? `${lead(p)}: ${p.stats}.` : `${lead(p)}.`, tail),
    (p) => join(`${lead(p)}.`, tail),
  ];

  if (state === "closed") {
    return [(p) => `Fans rallied for ${p.artist} in ${p.city} on Resonate: "${p.title}".`];
  }

  if (trigger === "after_signal") {
    return [(p) => `I want ${p.artist} in ${p.city}. Add your signal to "${p.title}" on Resonate.`];
  }

  if (state === "open") {
    return trigger === "after_pledge"
      ? withStats((p) => `I backed "${p.title}" on Resonate`, CAMPAIGN_REFUND_LINE)
      : withStats((p) => `I want ${p.artist} in ${p.city}. Back "${p.title}" on Resonate`, CAMPAIGN_REFUND_LINE);
  }

  if (state === "funded") {
    // The refund line holds only until booking; once booked, the pledge
    // statement is dropped rather than paired with a stale refund promise.
    if (trigger === "after_pledge" && rawStatus === "funded") {
      return [(p) => join(`I backed "${p.title}" on Resonate, and it reached its funding goal.`, CAMPAIGN_REFUND_LINE)];
    }
    return [(p) => `"${p.title}" reached its funding goal on Resonate. Fans want ${p.artist} in ${p.city}.`];
  }

  // pre_pledge: no funds are escrowed yet, so fans add their signal.
  return [(p) => `I want ${p.artist} in ${p.city}. Add your signal to "${p.title}" on Resonate.`];
}

function fitXText(builders: Builder[], parts: CopyParts): string {
  const fits = (text: string) => xPostLength(text) <= X_MAX_LENGTH;
  for (const build of builders) {
    const text = build(parts);
    if (fits(text)) return text;
  }
  // Keep the refund line; shorten the public names instead.
  return shrinkToFit(builders[builders.length - 1], parts, fits);
}

/** Shorten title, artist and city together (longest first) until the text fits. */
function shrinkToFit(build: Builder, parts: CopyParts, fits: (text: string) => boolean): string {
  let text = build(parts);
  if (fits(text)) return text;
  const longest = Math.max(parts.title.length, parts.artist.length, parts.city.length);
  for (let max = longest - 1; max >= 1; max -= 1) {
    text = build({
      ...parts,
      title: truncate(parts.title, max),
      artist: truncate(parts.artist, max),
      city: truncate(parts.city, max),
    });
    if (fits(text)) return text;
  }
  return text;
}

function progressStats(campaign: Pick<Campaign, "goalCents" | "raisedCents" | "deadline">, nowMs?: number) {
  const stats: string[] = [];
  if (campaign.goalCents > 0) {
    const ratio = Math.max(0, Math.min(1, campaign.raisedCents / campaign.goalCents));
    stats.push(`${Math.round(ratio * 100)}% funded`);
  }
  if (nowMs !== undefined && campaign.deadline && Number.isFinite(new Date(campaign.deadline).getTime())) {
    const days = daysUntil(campaign.deadline, nowMs);
    stats.push(days <= 1 ? "last day to pledge" : `${days} days left`);
  }
  return stats.join(", ");
}

function join(...lines: string[]) {
  return lines.filter(Boolean).join(" ");
}

function normalize(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
