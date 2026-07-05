/**
 * Resonate Shows — fan-funded artist-booking campaigns.
 *
 * This module defines the UI campaign shape used by the home page and the
 * `/shows` routes. Async reads hit the backend Shows API first and fall back
 * to seeded campaign data for local demos and offline UI tests.
 */

import { API_BASE, type Release } from "./api";

export type CampaignStatus = "active" | "funded" | "refunded" | "booked";
export type CampaignListScope = "all";
export type CampaignListStatus =
  | "active"
  | "funded"
  | "booking_confirmed"
  | "deposit_released"
  | "fulfilled"
  | "released"
  | "cancelled"
  | "refund_available"
  | "refunded";

export type CampaignListOptions = {
  scope?: CampaignListScope;
  status?: CampaignListStatus;
};

export interface CampaignTier {
  id: string;
  title: string;
  description?: string;
  amountCents: number;
  currency: "EUR" | "USD";
  paymentAssetSymbol: string;
}

export interface CampaignVisual {
  id: string;
  role: string;
  url: string;
  sortOrder: number;
  caption?: string | null;
  credit?: string | null;
}

// #949/#950 operator-scoped managed read: a dispute as the operator sees it
// (reason / operator note / initiator — withheld from the public DTO).
export interface ShowCampaignDispute {
  id: string;
  status: string;
  outcome?: string | null;
  reason?: string | null;
  operatorNote?: string | null;
  initiatorRole?: string | null;
  createdAt?: string | null;
  resolvedAt?: string | null;
}

export interface CampaignFeeBreakdown {
  feeBps: number | null;
  totalFeePaidUnits: string;
  grossReleasedUnits: string;
  netReleasedToArtistUnits: string;
  estimatedFeeAtGoalUnits: string | null;
  estimatedNetToArtistAtGoalUnits: string | null;
  feeChargedOnlyOnSuccessfulRelease: boolean;
  refundFeeUnits: string;
}

export interface Campaign {
  id: string;
  backendId: string;
  rawStatus: string;
  campaignLevel: string;
  artistAuthorityStatus: string;
  authorityCredentialId?: string | null;
  authorityEvidenceBundleId?: string | null;
  beneficiaryAddress?: string | null;
  beneficiaryType?: string | null;
  artistName: string;
  artistId?: string | null;
  artistSlug: string;
  artistImage: string;
  artistSummary?: string | null;
  artistLinks: Record<string, string>;
  isSample: boolean;
  title: string;
  city: string;
  country: string;
  venue?: string;
  targetDate: string;     // ISO — when the show would happen
  deadline: string;       // ISO — funding deadline (drives countdown)
  bookingDeadline?: string | null;
  goalCents: number;
  raisedCents: number;
  currency: "EUR" | "USD";
  // #949 trust/terms fields from the public DTO.
  paymentAssetSymbol?: string | null;
  paymentAssetDecimals?: number | null;
  chainId?: number | null;
  releasePolicy?: string | null;
  depositReleaseBps?: number | null;
  disputeWindowSeconds?: number | null;
  onChainStatus?: string | null;
  totalRefundedUnits?: string | null;
  totalReleasedUnits?: string | null;
  feeBps?: number | null;
  totalFeePaidUnits?: string | null;
  campaignFeeBreakdown?: CampaignFeeBreakdown | null;
  // #950 fan-visible dispute state (no operator notes / reason / initiator).
  disputeStatus?: string | null;
  disputeWindowClosesAt?: string | null;
  // #949 operator-scoped managed read only (GET /shows/campaigns/:id/manage).
  // Absent on the public read; populated by getManagedShowCampaign.
  bookingEvidenceBundleId?: string | null;
  fulfillmentEvidenceBundleId?: string | null;
  disputes?: ShowCampaignDispute[];
  backerCount: number;
  thresholdBackers: number;
  heroImage: string;      // optional; empty string → gradient placeholder
  cardImage: string;
  visuals: CampaignVisual[];
  status: CampaignStatus;
  featured: boolean;
  // Sepolia escrow contract. Until Campaign.sol ships, we link to the
  // already-deployed RevenueEscrow.sol as an honest stand-in so the
  // "Trust the code" link leads to a real contract, not a fake address.
  contractAddress: string;
  escrowContractAddress?: string | null;
  contractCampaignId?: string | null;
  paymentTokenAddress?: string | null;
  etherscanUrl: string;
  // Short pitch shown on the hero + detail page.
  tagline: string;
  tiers: CampaignTier[];
}

export const NON_ACTIONABLE_CAMPAIGN_RAW_STATUSES = new Set([
  "refund_available",
  "cancelled",
  "failed",
  "refunded",
  "released",
]);

export function isActionableCampaign(campaign: Pick<Campaign, "rawStatus">): boolean {
  return !NON_ACTIONABLE_CAMPAIGN_RAW_STATUSES.has(campaign.rawStatus);
}

export function filterActionableCampaigns<T extends Pick<Campaign, "rawStatus">>(campaigns: T[]): T[] {
  return campaigns.filter(isActionableCampaign);
}

export type CampaignStatusBadge = {
  label: string;
  tone: "neutral" | "warning" | "danger";
};

export function campaignStatusBadge(campaign: Pick<Campaign, "rawStatus">): CampaignStatusBadge | null {
  switch (campaign.rawStatus) {
    case "cancelled":
      return { label: "Cancelled - refunds open", tone: "danger" };
    case "refund_available":
      return { label: "Refunds open", tone: "warning" };
    case "refunded":
      return { label: "Refunded", tone: "neutral" };
    case "released":
      return { label: "Released", tone: "neutral" };
    case "failed":
      return { label: "Failed - refunds open", tone: "warning" };
    default:
      return null;
  }
}

export function campaignDisplayTitle(campaign: Pick<Campaign, "title" | "artistName" | "city">): string {
  return campaign.title?.trim() || `${campaign.artistName} in ${campaign.city}`;
}

export function campaignDisplayInitial(campaign: Pick<Campaign, "title" | "artistName" | "city">): string {
  return (campaignDisplayTitle(campaign)[0] ?? "?").toUpperCase();
}

export function campaignRouteCode(campaign: Pick<Campaign, "title" | "city">): string {
  const titleCode = slugify(campaign.title || "")
    .replace(new RegExp(`-?in-${slugify(campaign.city)}$`), "")
    .slice(0, 3)
    .toUpperCase();
  const cityCode = campaign.city.slice(0, 3).toUpperCase();
  return `${titleCode || "SHW"}-${cityCode}`;
}

export function campaignVisualEndpoint(
  campaign: Pick<Campaign, "backendId">,
  slot: "card" | "hero",
): string {
  return campaign.backendId
    ? `${API_BASE}/shows/campaigns/${encodeURIComponent(campaign.backendId)}/visuals/${slot}`
    : "";
}

// ============ #949 trust / terms / pledge presentation helpers ============

export type CampaignTrustTone = "neutral" | "info" | "positive" | "warning" | "danger";

export type CampaignTrustState = {
  key:
    | "demand_signal"
    | "provisional"
    | "authorized_escrow"
    | "authority_revoked"
    | "refund_available"
    | "cancelled";
  label: string;
  tone: CampaignTrustTone;
  /** Short, honest description — never implies a guaranteed ticket. */
  description: string;
};

/**
 * Derive the fan-facing trust state from campaign level + backend status +
 * artist-authority status. Order matters: terminal/refund states win, then
 * authority problems, then the escrow ladder.
 */
export function campaignTrustState(
  campaign: Pick<
    Campaign,
    "campaignLevel" | "rawStatus" | "artistAuthorityStatus"
  >,
): CampaignTrustState {
  const level = campaign.campaignLevel;
  const status = campaign.rawStatus;
  const authority = campaign.artistAuthorityStatus;

  if (status === "cancelled") {
    return {
      key: "cancelled",
      label: "Cancelled",
      tone: "danger",
      description: "This campaign was cancelled. Pledged funds are refundable.",
    };
  }
  if (status === "refund_available" || status === "refunded") {
    return {
      key: "refund_available",
      label: "Refund available",
      tone: "warning",
      description:
        "Funding conditions were not met. Backers can claim a refund of their pledge.",
    };
  }
  if (authority === "revoked" || authority === "expired" || authority === "rejected") {
    return {
      key: "authority_revoked",
      label: "Authority revoked",
      tone: "danger",
      description:
        "Artist authorization is no longer valid, so this campaign cannot take pledges.",
    };
  }
  if (level === "signal") {
    return {
      key: "demand_signal",
      label: "Demand signal",
      tone: "neutral",
      description:
        "An open, fan-proposed demand signal. No funds are escrowed and no show is booked yet.",
    };
  }
  if (
    level === "active_escrow_campaign" &&
    (authority === "artist_authorized" || authority === "trusted_source_authorized")
  ) {
    return {
      key: "authorized_escrow",
      label: "Artist-authorized escrow",
      tone: "positive",
      description:
        "An artist-authorized campaign with funds held in escrow. Release depends on booking and fulfillment.",
    };
  }
  return {
    key: "provisional",
    label: "Provisional campaign",
    tone: "info",
    description:
      "A provisional campaign awaiting verified artist authority before escrow activation.",
  };
}

export type CampaignPledgeAvailability = {
  /** True only when the backend would accept a new pledge. */
  open: boolean;
  key:
    | "open"
    | "pending_authority"
    | "not_authorized"
    | "signal"
    | "closed_refund"
    | "cancelled"
    | "closed";
  /** Short heading for the empty state (unused when `open`). */
  title: string;
  /** Honest one-liner explaining why pledging is/ isn't open. */
  message: string;
};

/**
 * Mirror the backend's `ensurePledgeableCampaign` so the pledge panel shows an
 * honest empty state instead of a live form that would only error on submit.
 * Order matches the trust ladder: terminal/refund first, then authority
 * problems, then the escrow-readiness gate. Deliberately time-independent
 * (no deadline check) to stay deterministic across SSR/CSR — the server still
 * rejects expired-deadline pledges.
 */
export function campaignPledgeAvailability(
  campaign: Pick<
    Campaign,
    | "campaignLevel"
    | "rawStatus"
    | "artistAuthorityStatus"
    | "beneficiaryAddress"
    | "beneficiaryType"
  >,
): CampaignPledgeAvailability {
  const status = campaign.rawStatus;
  const level = campaign.campaignLevel;
  const authority = campaign.artistAuthorityStatus;
  const authorized =
    authority === "artist_authorized" || authority === "trusted_source_authorized";

  if (status === "cancelled") {
    return {
      open: false,
      key: "cancelled",
      title: "Pledging closed",
      message: "This campaign was cancelled. If you backed it, you can claim a refund below.",
    };
  }
  if (status === "refund_available" || status === "refunded") {
    return {
      open: false,
      key: "closed_refund",
      title: "Pledging closed",
      message:
        "Funding conditions weren't met. Backers can claim any refund still available below.",
    };
  }
  if (authority === "revoked" || authority === "expired" || authority === "rejected") {
    return {
      open: false,
      key: "not_authorized",
      title: "Not open for pledging",
      message:
        "Artist authorization isn't valid for this campaign, so it can't take escrow pledges.",
    };
  }
  if (level === "signal") {
    return {
      open: false,
      key: "signal",
      title: "Open demand signal",
      message:
        "This is a fan-proposed demand signal — no funds are escrowed yet. Backing opens only if it's authorized as an escrow campaign.",
    };
  }
  if (
    level !== "active_escrow_campaign" ||
    !authorized ||
    !campaign.beneficiaryAddress ||
    !campaign.beneficiaryType
  ) {
    return {
      open: false,
      key: "pending_authority",
      title: "Awaiting artist authority",
      message:
        "This campaign is provisional. Pledging opens once an operator verifies the artist's authority and the escrow terms are locked.",
    };
  }
  if (status !== "active") {
    return {
      open: false,
      key: "closed",
      title: "Pledging closed",
      message: "This campaign isn't accepting new pledges right now.",
    };
  }
  return { open: true, key: "open", title: "", message: "" };
}

export function chainName(chainId?: number | null): string {
  switch (chainId) {
    case 1:
      return "Ethereum";
    case 11155111:
      return "Sepolia";
    case 84532:
      return "Base Sepolia";
    case 421614:
      return "Arbitrum Sepolia";
    case 31337:
    case 1337:
      return "Local";
    default:
      return chainId ? `Chain ${chainId}` : "—";
  }
}

export function releasePolicyLabel(policy?: string | null): string {
  switch (policy) {
    case "refund_only_until_booking":
      return "Refund-only until booking is confirmed";
    case "staged_release":
      return "Staged release (deposit on booking, remainder on fulfillment)";
    case "manual_ops_release":
      return "Manual operator release";
    default:
      return "Refund-first";
  }
}

export function formatCampaignFeePercent(feeBps?: number | null): string | null {
  if (feeBps == null || !Number.isSafeInteger(feeBps) || feeBps <= 0) return null;
  const percent = feeBps / 100;
  const display = Number.isInteger(percent)
    ? percent.toFixed(0)
    : percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${display}%`;
}

export function campaignFeeNotice(campaign: Pick<Campaign, "feeBps">): string | null {
  const percent = formatCampaignFeePercent(campaign.feeBps);
  if (!percent) return null;
  return `A ${percent} platform fee applies only if the campaign is funded — deducted from the artist payout at release. If the campaign fails, you are refunded 100%.`;
}

export function maskAddress(address?: string | null): string {
  if (!address) return "—";
  const value = address.trim();
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatDisputeWindow(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86_400);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.floor(seconds / 3_600));
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export type CampaignTerm = { label: string; value: string };

/**
 * The immutable terms a fan must be able to read before signing a pledge.
 * Values are formatted for display; pure so it is unit-testable.
 */
export function campaignTerms(campaign: Campaign): CampaignTerm[] {
  // Guard against malformed dates: new Date("bad").toISOString() throws, which
  // would 500 the server-rendered detail page. Fall back to the raw value.
  const fmtDate = (iso?: string | null) => {
    if (!iso) return "—";
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
  };
  const depositPct =
    campaign.depositReleaseBps != null
      ? `${(campaign.depositReleaseBps / 100).toFixed(campaign.depositReleaseBps % 100 === 0 ? 0 : 2)}%`
      : "—";
  const terms: CampaignTerm[] = [
    { label: "Funding goal", value: formatMoney(campaign.goalCents, campaign.currency) },
    { label: "Funding deadline", value: fmtDate(campaign.deadline) },
    {
      label: "Minimum backers",
      value: campaign.thresholdBackers > 0 ? String(campaign.thresholdBackers) : "—",
    },
    {
      label: "Payment",
      value: `${campaign.paymentAssetSymbol ?? "USDC"} on ${chainName(campaign.chainId)}`,
    },
    { label: "Booking deadline", value: fmtDate(campaign.bookingDeadline) },
    { label: "Deposit released on booking", value: depositPct },
    { label: "Dispute window", value: formatDisputeWindow(campaign.disputeWindowSeconds) },
    { label: "Refund policy", value: releasePolicyLabel(campaign.releasePolicy) },
  ];
  const feePercent = formatCampaignFeePercent(campaign.feeBps);
  if (feePercent) {
    terms.push({
      label: "Platform fee",
      value: `${feePercent} success-only; refunds fee-free`,
    });
  }
  return terms;
}

/**
 * #1240: pre-sign confirmation summary shown before the wallet signature, so a
 * fan confirms the fan-risk terms at the moment of commitment (not just on the
 * page). Composed from {@link campaignTerms} + {@link formatMoney} so it can't
 * drift from the on-page terms panel. Returned as a `\n`-joined string for the
 * shared `ConfirmDialog` (which renders `message` with `white-space: pre-line`).
 */
export function pledgeConfirmSummary(
  campaign: Campaign,
  tier: Pick<CampaignTier, "title" | "amountCents" | "currency">,
): string {
  const terms = campaignTerms(campaign);
  const pick = (label: string) => terms.find((term) => term.label === label)?.value;
  const lines = [`You're pledging ${formatMoney(tier.amountCents, tier.currency)} — ${tier.title}.`, ""];
  for (const label of ["Payment", "Deposit released on booking", "Refund policy", "Dispute window"]) {
    const value = pick(label);
    if (value && value !== "—") {
      lines.push(`${label}: ${value}`);
    }
  }
  const feeNotice = campaignFeeNotice(campaign);
  if (feeNotice) {
    lines.push(`Platform fee: ${feeNotice}`);
  }
  lines.push("");
  lines.push(
    "Funds are held in escrow. Funding never guarantees a ticket — your pledge is refunded automatically if the show isn't confirmed.",
  );
  return lines.join("\n");
}

export type CampaignDisputeView = {
  /** "active" | "resolved" | "none" — fan-visible status from the public DTO. */
  status: string;
  label: string;
  tone: CampaignTrustTone;
  /** Dispute-window close time (post-fulfillment), formatted, or null. */
  windowClosesAt: string | null;
  windowOpen: boolean;
};

/**
 * #950: fan-visible dispute summary for the detail page. Derives only from the
 * public DTO fields (`disputeStatus`, `disputeWindowClosesAt`) — never operator
 * notes, reasons, or initiator identity (the backend withholds those).
 */
export function campaignDisputeView(
  campaign: Pick<Campaign, "disputeStatus" | "disputeWindowClosesAt">,
): CampaignDisputeView {
  const status = campaign.disputeStatus ?? "none";
  const closesAtIso = campaign.disputeWindowClosesAt ?? null;
  const windowOpen = closesAtIso ? new Date(closesAtIso).getTime() > Date.now() : false;
  const windowClosesAt = (() => {
    if (!closesAtIso) return null;
    const date = new Date(closesAtIso);
    return Number.isNaN(date.getTime()) ? closesAtIso : date.toISOString().slice(0, 10);
  })();
  const label =
    status === "active"
      ? "Dispute under review"
      : status === "resolved"
        ? "Dispute resolved"
        : windowOpen
          ? "Dispute window open"
          : "No active dispute";
  const tone: CampaignTrustTone =
    status === "active" ? "warning" : status === "resolved" ? "info" : windowOpen ? "info" : "neutral";
  return { status, label, tone, windowClosesAt, windowOpen };
}

/** Human-readable pledge state covering every backend status. */
export function pledgeStateLabel(
  status: string,
  confirmationStatus?: string | null,
): string {
  switch (status) {
    case "intent_created":
      return "Pledge started";
    case "submitted":
      return confirmationStatus === "pending"
        ? "Submitted — awaiting on-chain confirmation"
        : "Submitted";
    case "confirmed":
      return "Confirmed on-chain";
    case "refund_available":
      return "Refund available";
    case "refunded":
      return "Refunded";
    case "deposit_released":
      return "Deposit released to artist";
    case "fulfilled":
      return "Show fulfilled";
    case "released":
      return "Funds released to artist";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status.replaceAll("_", " ");
  }
}

export type CatalogArtistCandidate = {
  optionId: string;
  artistId: string | null;
  name: string;
  releaseCount: number;
  latestReleaseTitle: string;
  artworkUrl?: string | null;
};

function normalizedArtistCredit(value?: string | null) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function mainReleaseCredits(release: Pick<Release, "artistCredits">) {
  return (release.artistCredits || [])
    .filter((credit) => ["main", "primary"].includes(credit.role.toLowerCase()))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName));
}

function releaseArtistCreditName(release: Pick<Release, "primaryArtist" | "artist" | "artistCredits">) {
  const mainCredits = mainReleaseCredits(release).map((credit) => credit.displayName.trim()).filter(Boolean);
  if (mainCredits.length > 0) return mainCredits.join(", ");
  return release.primaryArtist?.trim() || release.artist?.displayName?.trim() || "Unknown Artist";
}

function releaseCreditProfileId(release: Pick<Release, "primaryArtist" | "artist" | "artistCredits">) {
  const mainCredit = mainReleaseCredits(release)[0];
  if (mainCredit?.artistId) return mainCredit.artistId;

  const profileId = release.artist?.id || null;
  if (!profileId) return null;

  const primaryArtist = normalizedArtistCredit(release.primaryArtist);
  const profileName = normalizedArtistCredit(release.artist?.displayName);
  return !primaryArtist || primaryArtist === profileName ? profileId : null;
}

export function catalogArtistOptionId(candidate: Pick<CatalogArtistCandidate, "artistId" | "name">) {
  if (candidate.artistId) return `profile:${candidate.artistId}`;
  return `credit:${normalizedArtistCredit(candidate.name)}`;
}

export function buildCatalogArtistCandidates(releases: Release[]): CatalogArtistCandidate[] {
  const byArtist = new Map<string, CatalogArtistCandidate>();

  for (const release of releases) {
    const mainCredits = mainReleaseCredits(release);
    const credits = mainCredits.length > 0
      ? mainCredits.map((credit) => ({
          name: credit.displayName.trim(),
          artistId: credit.artistId || credit.artist?.id || null,
        }))
      : [{
          name: releaseArtistCreditName(release),
          artistId: releaseCreditProfileId(release),
        }];

    for (const credit of credits) {
      const name = credit.name || "Unknown Artist";
      const artistId = credit.artistId;
      const optionId = catalogArtistOptionId({ artistId, name });
      const existing = byArtist.get(optionId);

      if (existing) {
        existing.releaseCount += 1;
        if (!existing.artworkUrl && release.artworkUrl) existing.artworkUrl = release.artworkUrl;
        continue;
      }

      byArtist.set(optionId, {
        optionId,
        artistId,
        name,
        releaseCount: 1,
        latestReleaseTitle: release.title,
        artworkUrl: release.artworkUrl,
      });
    }
  }

  return Array.from(byArtist.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export type PledgeContractCall = {
  chainId: number;
  contractAddress: string;
  functionName: "pledge";
  args: [string, string];
  value: string;
  paymentTokenAddress: string | null;
};

export type ShowPledgeIntent = {
  pledge: {
    id: string;
    campaignId: string;
    tierId?: string | null;
    walletAddress: string;
    amountUnits: string;
    currency: string;
    paymentAssetSymbol?: string | null;
    paymentAssetDecimals: number;
    chainId: number;
    status: string;
    confirmationStatus: string;
    receiptId?: string | null;
    receipt?: Record<string, unknown> | null;
  };
  contractCall: PledgeContractCall | null;
};

export type ShowPledgeConfirmation = {
  pledge: ShowPledgeIntent["pledge"] & {
    transactionHash?: string | null;
    blockNumber?: string | null;
    campaign?: {
      id: string;
      slug?: string | null;
      title?: string | null;
      status?: string | null;
      contractAddress?: string | null;
      contractCampaignId?: string | null;
    };
    tier?: { id: string; title?: string | null } | null;
    createdAt?: string;
    confirmedAt?: string | null;
    failedAt?: string | null;
  };
};

export type ShowPledgeReceipt = ShowPledgeConfirmation["pledge"];

export type ShowCampaignCommunityRoom = {
  id: string;
  roomType: string;
  ownerType: string;
  ownerId: string;
  artistId?: string | null;
  title: string;
  description?: string | null;
  status: string;
  membership?: {
    role: string;
    status: string;
    joinedAt: string;
    endedAt?: string | null;
  } | null;
  access?: {
    joinable: boolean;
    reason: string;
    reasons?: string[];
  };
  createdAt: string;
  updatedAt: string;
};

export type ShowCampaignCommunity = {
  schemaVersion: "show-campaign-community/v1";
  campaign: {
    id: string;
    slug: string;
    title: string;
    artistId?: string | null;
    artistDisplayName: string;
    city: string;
    country: string;
    status: string;
    campaignLevel: string;
  };
  rooms: ShowCampaignCommunityRoom[];
};

export type ShowCampaignCommunityMessage = {
  id: string;
  roomId: string;
  authorId: string;
  body: string | null;
  messageType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ShowCampaignCommunityMessages = {
  schemaVersion: "community-messages/v1";
  room: ShowCampaignCommunityRoom;
  messages: ShowCampaignCommunityMessage[];
};

export type ShowCampaignDraftTierInput = {
  title: string;
  description?: string | null;
  amountUnits: string;
  currency?: "EUR" | "USD";
  paymentAssetSymbol?: string;
  paymentAssetDecimals?: number;
  sortOrder?: number;
};

export type ShowCampaignDraftInput = {
  artistId?: string | null;
  artistDisplayName: string;
  title?: string | null;
  description?: string | null;
  city: string;
  country: string;
  venueTarget?: string | null;
  targetDate?: string | null;
  deadline: string;
  bookingDeadline?: string | null;
  goalAmountUnits: string;
  minimumBackers?: number | null;
  currency: "EUR" | "USD";
  paymentAssetSymbol: string;
  paymentAssetDecimals: number;
  paymentTokenAddress?: string | null;
  beneficiaryAddress?: string | null;
  beneficiaryType?: "wallet" | "split_contract" | "multisig" | null;
  authorityEvidenceBundleId?: string | null;
  tiers: ShowCampaignDraftTierInput[];
};

const SEPOLIA_REVENUE_ESCROW = "0x411e121a97b6901b2e81f67a795e8063c1b8d472";
const SHOWS_EXPLORER_BASE_URL =
  process.env.NEXT_PUBLIC_SHOWS_EXPLORER_BASE_URL ?? "https://sepolia.etherscan.io/address";
const SEPOLIA_ETHERSCAN = `${SHOWS_EXPLORER_BASE_URL}/${SEPOLIA_REVENUE_ESCROW}`;

type BackendShowCampaign = {
  id: string;
  slug: string;
  artistId?: string | null;
  artistDisplayName: string;
  artist?: {
    imageUrl?: string | null;
    summary?: string | null;
    socialLinks?: unknown;
  } | null;
  heroImageUrl?: string | null;
  cardImageUrl?: string | null;
  visuals?: BackendShowCampaignVisual[];
  title: string;
  city: string;
  country: string;
  venueTarget?: string | null;
  targetDate?: string | null;
  deadline: string;
  goalAmountUnits: string;
  raisedAmountUnits: string;
  currency: string;
  paymentAssetSymbol?: string | null;
  paymentAssetDecimals?: number | null;
  paymentTokenAddress?: string | null;
  minimumBackers?: number | null;
  confirmedPledgeCount?: number | null;
  uniqueBackerCount?: number | null;
  status: string;
  campaignLevel?: string | null;
  artistAuthorityStatus?: string | null;
  authorityCredentialId?: string | null;
  authorityEvidenceBundleId?: string | null;
  beneficiaryAddress?: string | null;
  beneficiaryType?: string | null;
  bookingDeadline?: string | null;
  chainId?: number | null;
  releasePolicy?: string | null;
  depositReleaseBps?: number | null;
  disputeWindowSeconds?: number | null;
  onChainStatus?: string | null;
  totalRefundedUnits?: string | null;
  totalReleasedUnits?: string | null;
  feeBps?: number | null;
  totalFeePaid?: string | null;
  totalFeePaidUnits?: string | null;
  campaignFeeBreakdown?: CampaignFeeBreakdown | null;
  disputeStatus?: string | null;
  disputeWindowClosesAt?: string | null;
  // #949 managed-read-only fields (operator/owner scoped). The managed DTO's
  // dispute shape is intentionally structurally identical to the UI-facing
  // ShowCampaignDispute, so we reuse it directly here; if the backend dispute
  // payload ever diverges, give this its own raw type.
  bookingEvidenceBundleId?: string | null;
  fulfillmentEvidenceBundleId?: string | null;
  disputes?: ShowCampaignDispute[];
  contractAddress?: string | null;
  contractCampaignId?: string | null;
  description?: string | null;
  metadata?: unknown;
  tiers?: BackendShowCampaignTier[];
};

type BackendShowCampaignVisual = {
  id: string;
  role?: string | null;
  publicUrl?: string | null;
  sortOrder?: number | null;
  caption?: string | null;
  credit?: string | null;
};

type BackendShowCampaignTier = {
  id: string;
  title: string;
  description?: string | null;
  amountUnits: string;
  currency: string;
  paymentAssetSymbol?: string | null;
  paymentAssetDecimals?: number | null;
};

const addDays = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

/* Historical placeholder campaigns retained in the diff for easy review.
const CAMPAIGNS: Campaign[] = [
  {
    id: "sennarin-paris",
    backendId: "sennarin-paris",
    rawStatus: "active",
    campaignLevel: "active_escrow_campaign",
    artistAuthorityStatus: "artist_authorized",
    authorityCredentialId: null,
    authorityEvidenceBundleId: null,
    beneficiaryAddress: null,
    beneficiaryType: null,
    artistName: "Sennarin",
    artistSlug: "sennarin",
    title: "Sennarin in Paris",
    city: "Paris",
    country: "FR",
    venue: "Le Trianon",
    targetDate: addDays(180),
    deadline: addDays(14),
    bookingDeadline: addDays(45),
    goalCents: 10_000_000,
    raisedCents: 6_720_000,
    currency: "EUR",
    backerCount: 127,
    thresholdBackers: 500,
    heroImage: "",
    cardImage: "",
    visuals: [],
    status: "active",
    featured: true,
    contractAddress: SEPOLIA_REVENUE_ESCROW,
    escrowContractAddress: null,
    contractCampaignId: null,
    paymentTokenAddress: null,
    etherscanUrl: SEPOLIA_ETHERSCAN,
    tagline: "Bring Sennarin to Paris for her first European headline show.",
    tiers: [
      {
        id: "sennarin-fan-signal",
        title: "Fan signal",
        amountCents: 2_500,
        currency: "EUR",
        paymentAssetSymbol: "USDC",
        description: "Refundable support signal and campaign receipt.",
      },
      {
        id: "sennarin-ticket-intent",
        title: "Ticket intent",
        amountCents: 7_500,
        currency: "EUR",
        paymentAssetSymbol: "USDC",
        description: "Priority allocation if the show is booked.",
      },
      {
        id: "sennarin-patron-circle",
        title: "Patron circle",
        amountCents: 25_000,
        currency: "EUR",
        paymentAssetSymbol: "USDC",
        description: "Premium campaign receipt and patron allocation.",
      },
    ],
  },
  {
    id: "luka-tokyo",
    backendId: "luka-tokyo",
    rawStatus: "active",
    campaignLevel: "active_escrow_campaign",
    artistAuthorityStatus: "artist_authorized",
    authorityCredentialId: null,
    authorityEvidenceBundleId: null,
    beneficiaryAddress: null,
    beneficiaryType: null,
    artistName: "LUKA",
    artistSlug: "luka",
    title: "LUKA in Tokyo",
    city: "Tokyo",
    country: "JP",
    targetDate: addDays(210),
    deadline: addDays(28),
    bookingDeadline: addDays(58),
    goalCents: 8_000_000,
    raisedCents: 2_480_000,
    currency: "EUR",
    backerCount: 89,
    thresholdBackers: 400,
    heroImage: "",
    cardImage: "",
    visuals: [],
    status: "active",
    featured: false,
    contractAddress: SEPOLIA_REVENUE_ESCROW,
    escrowContractAddress: null,
    contractCampaignId: null,
    paymentTokenAddress: null,
    etherscanUrl: SEPOLIA_ETHERSCAN,
    tagline: "The Tokyo fanbase has been asking for a hometown show since 2023.",
    tiers: [],
  },
  {
    id: "meridian-lagos",
    backendId: "meridian-lagos",
    rawStatus: "active",
    campaignLevel: "active_escrow_campaign",
    artistAuthorityStatus: "artist_authorized",
    authorityCredentialId: null,
    authorityEvidenceBundleId: null,
    beneficiaryAddress: null,
    beneficiaryType: null,
    artistName: "Meridian",
    artistSlug: "meridian",
    title: "Meridian in Lagos",
    city: "Lagos",
    country: "NG",
    targetDate: addDays(240),
    deadline: addDays(45),
    bookingDeadline: addDays(75),
    goalCents: 6_000_000,
    raisedCents: 480_000,
    currency: "EUR",
    backerCount: 42,
    thresholdBackers: 300,
    heroImage: "",
    cardImage: "",
    visuals: [],
    status: "active",
    featured: false,
    contractAddress: SEPOLIA_REVENUE_ESCROW,
    escrowContractAddress: null,
    contractCampaignId: null,
    paymentTokenAddress: null,
    etherscanUrl: SEPOLIA_ETHERSCAN,
    tagline: "Afrobeats in its capital — the campaign just opened.",
    tiers: [],
  },
];
*/

const PARIS_VENUE_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/0/0e/Le_Trianon%2C_80_boulevard_de_Rochechouart%2C_Paris_18e.jpg";
const DUBLIN_VENUE_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/a/a1/Dame_Street_-_The_Olympia_Theatre_%283433685951%29.jpg";
const LAGOS_CITY_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/2/21/Eko_Atlantic_%28Lagos%29_Skyline.jpg";
const MONTREAL_CITY_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/7/71/Montreal_Skyline_at_Night.jpg";
// Real, recent artist photos — Getty editorial, all rights reserved, demo use only.
// Committed locally (mirrors the backend fixture assets) instead of hot-linking
// Getty comp URLs, whose signed tokens expire and 404 in the browser.
const AYA_PORTRAIT_IMAGE = "/shows/aya-nakamura-portrait.jpg";
// Aya performing at Vogue World: Paris (June 2024) — editorial press photo via RTL.fr,
// all rights reserved, demo use only; locally committed.
const AYA_HERO_IMAGE = "/shows/aya-nakamura-montreal-hero.jpg";
const AYA_LIVE_IMAGE = "/shows/aya-nakamura-live.jpg";
const AYA_STAGE_IMAGE = "/shows/aya-nakamura-stage.jpg";
const LEONA_LIVE_IMAGE = "/shows/leona-lewis-live.jpg";
const LEONA_HERO_IMAGE = "/shows/leona-lewis-lagos-hero.jpg";
const LEONA_VEGAS_IMAGE = "/shows/leona-lewis-vegas.jpg";
const LEONA_WIMBLEDON_IMAGE = "/shows/leona-lewis-wimbledon.jpg";
const SENNARIN_PORTRAIT_IMAGE = "/shows/sennarin-portrait.jpg";
const SENNARIN_EDITORIAL_IMAGE = "/shows/sennarin-editorial.jpg";
const SENNARIN_BAND_IMAGE = "/shows/sennarin-band.jpg";
// Wide hero composed from her cinematic @senna_rin editorial portrait, locally committed.
const SENNARIN_HERO_IMAGE = "/shows/sennarin-paris-hero.jpg";
// "After Rain" single cover art (locally committed, demo use only) — replaces the prior press photo.
const FELICIA_PORTRAIT_IMAGE = "/shows/felicia-farerre-portrait.jpg";
// Wide hero composed from her "After Rain" cover (locally committed, demo use only).
const FELICIA_HERO_IMAGE = "/shows/felicia-farerre-dublin-hero.jpg";
const FELICIA_STUDIO_IMAGE = "/shows/felicia-farerre-studio.jpg";
const FELICIA_ANGELS_IMAGE = "/shows/felicia-angels-cover.jpg";

function sampleTiers(prefix: string, currency: "EUR" | "USD"): CampaignTier[] {
  return [
    { id: `${prefix}-fan-signal`, title: "Fan signal", amountCents: 2_500, currency, paymentAssetSymbol: "USDC", description: "Refundable support signal and campaign receipt." },
    { id: `${prefix}-ticket-intent`, title: "Ticket intent", amountCents: 7_500, currency, paymentAssetSymbol: "USDC", description: "Priority allocation if the concept advances to a confirmed show." },
    { id: `${prefix}-patron-circle`, title: "Patron circle", amountCents: 25_000, currency, paymentAssetSymbol: "USDC", description: "Premium campaign receipt and patron allocation." },
  ];
}

const sampleBase = {
  rawStatus: "active",
  campaignLevel: "active_escrow_campaign",
  artistAuthorityStatus: "none",
  authorityCredentialId: null,
  authorityEvidenceBundleId: null,
  beneficiaryAddress: null,
  beneficiaryType: null,
  status: "active" as const,
  featured: false,
  contractAddress: SEPOLIA_REVENUE_ESCROW,
  escrowContractAddress: null,
  contractCampaignId: null,
  paymentTokenAddress: null,
  etherscanUrl: SEPOLIA_ETHERSCAN,
  isSample: true,
};

const CAMPAIGNS: Campaign[] = [
  {
    ...sampleBase,
    id: "sennarin-paris", backendId: "sennarin-paris",
    artistName: "SennaRin", artistSlug: "sennarin", artistImage: SENNARIN_PORTRAIT_IMAGE,
    artistSummary: "Japanese singer, lyricist and illustrator SennaRin emerged through J-pop and anime-song covers on YouTube before composer Hiroyuki Sawano produced her 2022 debut EP, Dignified. Her expressive low register quickly became a fixture of cinematic anime — 'dust' and 'melt' soundtracked Legend of the Galactic Heroes: Die Neue These, and her single 'Saihate' served as an ending theme for Bleach: Thousand-Year Blood War. Signed to Sony's Sacra Music, she pairs that voice with her own lyrics and artwork.",
    artistLinks: { official: "https://www.sennarin.com/" },
    title: "SennaRin in Paris", city: "Paris", country: "FR", venue: "Le Trianon",
    targetDate: addDays(180), deadline: addDays(21), bookingDeadline: addDays(52),
    goalCents: 10_000_000, raisedCents: 6_720_000, currency: "EUR", backerCount: 127, thresholdBackers: 500,
    heroImage: SENNARIN_HERO_IMAGE, cardImage: SENNARIN_PORTRAIT_IMAGE,
    visuals: [
      { id: "sample-sennarin-paris-portrait", role: "gallery", url: SENNARIN_PORTRAIT_IMAGE, sortOrder: 10, caption: "SennaRin.", credit: "© SennaRin / staff — official photo (@senna_rin on X), demo use only" },
      { id: "sample-sennarin-paris-editorial", role: "gallery", url: SENNARIN_EDITORIAL_IMAGE, sortOrder: 11, caption: "SennaRin.", credit: "© SennaRin / staff — official photo (@senna_rin on X), demo use only" },
      { id: "sample-sennarin-paris-band", role: "gallery", url: SENNARIN_BAND_IMAGE, sortOrder: 12, caption: "SennaRin (centre) with her band.", credit: "© SennaRin / staff — official photo, demo use only" },
      { id: "sample-sennarin-paris-venue", role: "gallery", url: PARIS_VENUE_IMAGE, sortOrder: 13, caption: "Le Trianon, the proposed venue target.", credit: "Celette, CC BY-SA 4.0" },
    ],
    featured: true,
    tagline: "A cinematic Paris night for a voice built to fill the room. This fan-created concept turns scattered European demand into one visible, refundable signal.",
    tiers: sampleTiers("sennarin-paris", "EUR"),
  },
  {
    ...sampleBase,
    id: "felicia-farerre-dublin", backendId: "felicia-farerre-dublin",
    artistName: "Felicia Farerre", artistSlug: "felicia-farerre", artistImage: FELICIA_PORTRAIT_IMAGE,
    artistSummary: "Felicia Farerre is an American vocalist, composer and producer whose four-decade career has made her voice a fixture of film, television and epic trailer music. She is the soaring lead voice on Two Steps from Hell's 'Star Sky' and crowned the Billboard charts as lead vocalist for the classical-crossover Taliesin Orchestra, and her vocals carry trailers for films from Maleficent and 300: Rise of an Empire to Ocean's Twelve. A lyricist, author and vocal coach, she also created the Epic Women project and the Real Singers Don't Sing training program.",
    artistLinks: { official: "https://www.feliciafarerre.com/" },
    title: "Felicia Farerre in Dublin", city: "Dublin", country: "IE", venue: "3Olympia Theatre",
    targetDate: addDays(205), deadline: addDays(28), bookingDeadline: addDays(60),
    goalCents: 7_000_000, raisedCents: 2_940_000, currency: "EUR", backerCount: 94, thresholdBackers: 350,
    heroImage: FELICIA_HERO_IMAGE, cardImage: FELICIA_PORTRAIT_IMAGE,
    visuals: [
      { id: "sample-felicia-farerre-dublin-portrait", role: "gallery", url: FELICIA_PORTRAIT_IMAGE, sortOrder: 10, caption: "Felicia Farerre.", credit: "© Felicia Farerre — \"After Rain\" cover art, demo use only" },
      { id: "sample-felicia-farerre-dublin-studio", role: "gallery", url: FELICIA_STUDIO_IMAGE, sortOrder: 11, caption: "Felicia Farerre at the microphone.", credit: "© Felicia Farerre — press photo, demo use only" },
      { id: "sample-felicia-farerre-dublin-angels", role: "gallery", url: FELICIA_ANGELS_IMAGE, sortOrder: 12, caption: "Felicia Farerre — “In the Company of Angels” cover.", credit: "© Felicia Farerre — album cover art, demo use only" },
      { id: "sample-felicia-farerre-dublin-venue", role: "gallery", url: DUBLIN_VENUE_IMAGE, sortOrder: 13, caption: "3Olympia Theatre, the proposed venue target.", credit: "William Murphy, CC BY-SA 2.0" },
    ],
    tagline: "From trailer-scale power to a pin-drop vocal, this fan-created Dublin concept imagines an intimate, story-led evening at 3Olympia Theatre.",
    tiers: sampleTiers("felicia-farerre-dublin", "EUR"),
  },
  {
    ...sampleBase,
    id: "leona-lewis-lagos", backendId: "leona-lewis-lagos",
    artistName: "Leona Lewis", artistSlug: "leona-lewis", artistImage: LEONA_LIVE_IMAGE,
    artistSummary: "London-born singer, songwriter and actress Leona Lewis trained at the BRIT School before winning The X Factor in 2006. Her debut album Spirit went 10× platinum in the UK and ranks among the best-selling albums in British chart history, while its single 'Bleeding Love' reached number one in more than thirty countries, including the UK and the US Billboard Hot 100. Three Grammy nominations, a Beijing Olympics closing-ceremony duet with Jimmy Page and over 30 million records sold cemented a pop-soul career defined by range and emotional scale.",
    artistLinks: { official: "https://www.leonalewismusic.com/" },
    title: "Leona Lewis in Lagos", city: "Lagos", country: "NG", venue: "Eko Convention Centre",
    targetDate: addDays(225), deadline: addDays(35), bookingDeadline: addDays(68),
    goalCents: 12_000_000, raisedCents: 4_560_000, currency: "USD", backerCount: 211, thresholdBackers: 650,
    heroImage: LEONA_HERO_IMAGE, cardImage: LEONA_WIMBLEDON_IMAGE,
    visuals: [
      { id: "sample-leona-lewis-lagos-live", role: "gallery", url: LEONA_LIVE_IMAGE, sortOrder: 10, caption: "Leona Lewis performing live (amfAR Venice, 2023).", credit: "© Getty Images — editorial, demo use only" },
      { id: "sample-leona-lewis-lagos-vegas", role: "gallery", url: LEONA_VEGAS_IMAGE, sortOrder: 11, caption: "Leona Lewis on her Las Vegas Christmas show.", credit: "© Getty Images — editorial, demo use only" },
      { id: "sample-leona-lewis-lagos-wimbledon", role: "gallery", url: LEONA_WIMBLEDON_IMAGE, sortOrder: 12, caption: "Leona Lewis at Wimbledon.", credit: "© Getty Images — editorial, demo use only" },
      { id: "sample-leona-lewis-lagos-city", role: "gallery", url: LAGOS_CITY_IMAGE, sortOrder: 13, caption: "Lagos skyline.", credit: "SmartAfricanBoy, CC BY-SA 4.0" },
    ],
    tagline: "Lagos deserves the full voice, full band and full-room chorus. This fan-created concept turns local demand into a signal strong enough to make the journey viable.",
    tiers: sampleTiers("leona-lewis-lagos", "USD"),
  },
  {
    ...sampleBase,
    id: "aya-nakamura-montreal", backendId: "aya-nakamura-montreal",
    artistName: "Aya Nakamura", artistSlug: "aya-nakamura", artistImage: AYA_PORTRAIT_IMAGE,
    artistSummary: "Bamako-born French-Malian singer-songwriter Aya Nakamura is the most-streamed French-language female artist in history. Her 2018 single 'Djadja' topped the French charts, was certified diamond, and became the first video by a female African artist to pass one billion YouTube views — also making her the first French woman to reach number one in the Netherlands since Édith Piaf. Across the diamond-certified Nakamura, the Victoires de la Musique-winning Aya and DNK she has fused R&B, Afrobeats, zouk and pop, and in 2024 she headlined the opening ceremony of the Paris Olympic Games.",
    artistLinks: { instagram: "https://www.instagram.com/ayanakamura_officiel/" },
    title: "Aya Nakamura in Montréal", city: "Montréal", country: "CA", venue: "MTELUS",
    targetDate: addDays(165), deadline: addDays(18), bookingDeadline: addDays(48),
    goalCents: 9_500_000, raisedCents: 7_410_000, currency: "USD", backerCount: 306, thresholdBackers: 550,
    heroImage: AYA_HERO_IMAGE, cardImage: AYA_PORTRAIT_IMAGE,
    visuals: [
      { id: "sample-aya-nakamura-montreal-portrait", role: "gallery", url: AYA_PORTRAIT_IMAGE, sortOrder: 10, caption: "Aya Nakamura (2024).", credit: "© Getty Images — editorial, demo use only" },
      { id: "sample-aya-nakamura-montreal-live", role: "gallery", url: AYA_LIVE_IMAGE, sortOrder: 11, caption: "Aya Nakamura performing (Wembley, 2023).", credit: "© Getty Images — editorial, demo use only" },
      { id: "sample-aya-nakamura-montreal-stage", role: "gallery", url: AYA_STAGE_IMAGE, sortOrder: 12, caption: "Aya Nakamura on stage (2023).", credit: "© Getty Images — editorial, demo use only" },
      { id: "sample-aya-nakamura-montreal-city", role: "gallery", url: MONTREAL_CITY_IMAGE, sortOrder: 13, caption: "Montréal at night.", credit: "Mathieu Landretti, CC BY-SA 4.0" },
    ],
    tagline: "Montréal already speaks the language of this show: francophone hooks, Afrobeats pulse and a crowd ready to answer every line.",
    tiers: sampleTiers("aya-nakamura-montreal", "USD"),
  },
];

export function showsCampaignListPath(options: CampaignListOptions = {}): string {
  const params = new URLSearchParams();
  if (options.status) {
    params.set("status", options.status);
  } else if (options.scope === "all") {
    params.set("scope", "all");
  }
  const query = params.toString();
  return `/shows/campaigns${query ? `?${query}` : ""}`;
}

export async function listCampaigns(options: CampaignListOptions = {}): Promise<Campaign[]> {
  const campaigns = await fetchShowsApi<BackendShowCampaign[]>(showsCampaignListPath(options));
  if (!campaigns?.length) {
    const fallback = options.status
      ? CAMPAIGNS.filter((campaign) => campaign.rawStatus === options.status)
      : CAMPAIGNS;
    return options.scope === "all" ? fallback : filterActionableCampaigns(fallback);
  }
  return campaigns.map(mapBackendCampaign);
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const campaign = await fetchShowsApi<BackendShowCampaign>(`/shows/campaigns/${encodeURIComponent(id)}`);
  if (campaign) {
    return mapBackendCampaign(campaign);
  }
  return CAMPAIGNS.find((c) => c.id === id) ?? null;
}

export async function createPledgeIntent(input: {
  campaign: Campaign;
  tierId: string;
  walletAddress: string;
  token: string;
}): Promise<ShowPledgeIntent> {
  const response = await fetch(
    `${API_BASE}/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/pledges/intent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        tierId: input.tierId,
        walletAddress: input.walletAddress,
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Pledge intent failed with status ${response.status}`);
  }

  return await response.json() as ShowPledgeIntent;
}

export async function confirmPledge(input: {
  pledgeId: string;
  token: string;
  transactionHash: string;
  confirmationStatus: "pending" | "confirmed" | "failed";
  blockNumber?: string;
  failureReason?: string;
  receipt?: Record<string, unknown>;
}): Promise<ShowPledgeConfirmation> {
  const response = await fetch(
    `${API_BASE}/shows/pledges/${encodeURIComponent(input.pledgeId)}/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        transactionHash: input.transactionHash,
        confirmationStatus: input.confirmationStatus,
        blockNumber: input.blockNumber,
        failureReason: input.failureReason,
        receipt: input.receipt,
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Pledge confirmation failed with status ${response.status}`);
  }

  return await response.json() as ShowPledgeConfirmation;
}

export async function confirmPledgeRefund(input: {
  pledgeId: string;
  token: string;
  transactionHash: string;
  blockNumber?: string;
  receipt?: Record<string, unknown>;
}): Promise<ShowPledgeConfirmation> {
  const response = await fetch(
    `${API_BASE}/shows/pledges/${encodeURIComponent(input.pledgeId)}/refund/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        transactionHash: input.transactionHash,
        blockNumber: input.blockNumber,
        receipt: input.receipt,
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Pledge refund confirmation failed with status ${response.status}`);
  }

  return await response.json() as ShowPledgeConfirmation;
}

export async function listMyShowPledges(input: {
  token: string;
  walletAddress?: string | null;
  chainId?: number;
}): Promise<ShowPledgeReceipt[]> {
  const params = new URLSearchParams();
  if (input.walletAddress) params.set("walletAddress", input.walletAddress);
  if (input.chainId) params.set("chainId", String(input.chainId));
  const suffix = params.toString() ? `?${params.toString()}` : "";

  const response = await fetch(`${API_BASE}/shows/me/pledges${suffix}`, {
    headers: {
      Authorization: `Bearer ${input.token}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Pledge receipt lookup failed with status ${response.status}`);
  }

  return await response.json() as ShowPledgeReceipt[];
}

export async function getShowCampaignCommunity(input: {
  campaign: Campaign;
  token: string;
}): Promise<ShowCampaignCommunity> {
  const response = await fetch(
    `${API_BASE}/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/community`,
    {
      headers: { Authorization: `Bearer ${input.token}` },
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Campaign community lookup failed with status ${response.status}`);
  }

  return await response.json() as ShowCampaignCommunity;
}

export async function joinShowCampaignCommunity(input: {
  campaign: Campaign;
  token: string;
}): Promise<{ schemaVersion: "community-membership/v1"; room: ShowCampaignCommunityRoom }> {
  const response = await fetch(
    `${API_BASE}/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/community/join`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}` },
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Campaign community join failed with status ${response.status}`);
  }

  return await response.json();
}

export async function joinShowCampaignCityDemand(input: {
  campaign: Campaign;
  token: string;
}): Promise<{ schemaVersion: "community-membership/v1"; room: ShowCampaignCommunityRoom }> {
  const response = await fetch(
    `${API_BASE}/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/community/city-interest/join`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}` },
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Campaign city demand join failed with status ${response.status}`);
  }

  return await response.json();
}

export async function createShowCampaignCommunityUpdate(input: {
  campaign: Campaign;
  token: string;
  body: string;
}): Promise<{ schemaVersion: "community-message/v1"; message: ShowCampaignCommunityMessage }> {
  const response = await fetch(
    `${API_BASE}/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/community/updates`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({ body: input.body }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Campaign update failed with status ${response.status}`);
  }

  return await response.json();
}

export async function createShowCampaignDraft(input: {
  token: string;
  draft: ShowCampaignDraftInput;
}): Promise<Campaign> {
  return await mutateShowCampaign("/shows/campaigns", {
    method: "POST",
    token: input.token,
    body: input.draft,
  });
}

export async function updateShowCampaignDraft(input: {
  campaign: Campaign;
  token: string;
  draft: ShowCampaignDraftInput;
}): Promise<Campaign> {
  return await mutateShowCampaign(`/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}`, {
    method: "PATCH",
    token: input.token,
    body: input.draft,
  });
}

export async function uploadShowCampaignVisuals(input: {
  campaign: Campaign;
  token: string;
  visuals: FormData;
}): Promise<Campaign> {
  return await mutateShowCampaign(`/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/visuals`, {
    method: "PATCH",
    token: input.token,
    body: input.visuals,
  });
}

export async function replaceShowCampaignVisual(input: {
  campaign: Campaign;
  token: string;
  visualId: string;
  visual: File;
}): Promise<Campaign> {
  const formData = new FormData();
  formData.append("visual", input.visual);
  return await mutateShowCampaign(`/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/visuals/${encodeURIComponent(input.visualId)}`, {
    method: "PATCH",
    token: input.token,
    body: formData,
  });
}

export async function reorderShowCampaignVisuals(input: {
  campaign: Campaign;
  token: string;
  visualIds: string[];
}): Promise<Campaign> {
  return await mutateShowCampaign(`/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/visuals/order`, {
    method: "PATCH",
    token: input.token,
    body: { visualIds: input.visualIds },
  });
}

export async function deleteShowCampaignVisual(input: {
  campaign: Campaign;
  token: string;
  visualId: string;
}): Promise<Campaign> {
  const response = await fetch(
    `${API_BASE}/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/visuals/${encodeURIComponent(input.visualId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${input.token}` },
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Campaign visual deletion failed with status ${response.status}`);
  }

  return mapBackendCampaign(await response.json() as BackendShowCampaign);
}

export async function approveShowCampaignAuthority(input: {
  campaign: Campaign;
  token: string;
  authorityStatus: "artist_authorized" | "trusted_source_authorized";
  beneficiaryAddress: string;
  beneficiaryType: "wallet" | "split_contract" | "multisig";
  authorityCredentialId?: string | null;
  authorityEvidenceBundleId?: string | null;
}): Promise<Campaign> {
  return await mutateShowCampaign(`/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/authority`, {
    method: "PATCH",
    token: input.token,
    body: {
      authorityStatus: input.authorityStatus,
      beneficiaryAddress: input.beneficiaryAddress,
      beneficiaryType: input.beneficiaryType,
      authorityCredentialId: input.authorityCredentialId,
      authorityEvidenceBundleId: input.authorityEvidenceBundleId,
    },
  });
}

export async function activateShowCampaign(input: {
  campaign: Campaign;
  token: string;
  contractAddress?: string | null;
  contractCampaignId?: string | null;
}): Promise<Campaign> {
  return await mutateShowCampaign(`/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/activate`, {
    method: "POST",
    token: input.token,
    body: {
      contractAddress: input.contractAddress,
      contractCampaignId: input.contractCampaignId,
    },
  });
}

export async function cancelShowCampaign(input: {
  campaign: Campaign;
  token: string;
  reason?: string | null;
  evidenceBundleId?: string | null;
}): Promise<Campaign> {
  return await mutateShowCampaign(`/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/cancel`, {
    method: "POST",
    token: input.token,
    body: {
      reason: input.reason,
      evidenceBundleId: input.evidenceBundleId,
    },
  });
}

export async function confirmShowCampaignBooking(input: {
  campaign: Campaign;
  token: string;
  evidenceBundleId?: string | null;
  reason?: string | null;
}): Promise<Campaign> {
  return await mutateShowCampaign(`/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/confirm-booking`, {
    method: "POST",
    token: input.token,
    body: {
      evidenceBundleId: input.evidenceBundleId,
      reason: input.reason,
    },
  });
}

export async function confirmShowCampaignFulfillment(input: {
  campaign: Campaign;
  token: string;
  evidenceBundleId?: string | null;
  reason?: string | null;
}): Promise<Campaign> {
  return await mutateShowCampaign(`/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/confirm-fulfillment`, {
    method: "POST",
    token: input.token,
    body: {
      evidenceBundleId: input.evidenceBundleId,
      reason: input.reason,
    },
  });
}

/**
 * #949 operator-scoped managed read. Returns the campaign with the fields the
 * public DTO withholds (authority credential/evidence ids, the dispute list)
 * so the operator panel can prefill inputs and act on open disputes. Requires
 * an operator/admin or the owning artist's token (403 otherwise → null).
 */
export async function getManagedShowCampaign(input: {
  campaignId: string;
  token: string;
}): Promise<Campaign | null> {
  const response = await fetch(
    `${API_BASE}/shows/campaigns/${encodeURIComponent(input.campaignId)}/manage`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.token}`,
      },
    },
  );
  if (!response.ok) {
    return null;
  }
  return mapBackendCampaign(await response.json() as BackendShowCampaign);
}

/**
 * #950 operator-only: raise a dispute against a campaign in the booking →
 * release window. Returns the created dispute; refetch the managed campaign to
 * refresh the panel's dispute list.
 */
export async function initiateShowCampaignDispute(input: {
  campaign: Campaign;
  token: string;
  reason?: string | null;
}): Promise<ShowCampaignDispute> {
  const response = await fetch(
    `${API_BASE}/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/dispute`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({ reason: input.reason }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Raising the dispute failed with status ${response.status}`);
  }
  return await response.json() as ShowCampaignDispute;
}

/**
 * #950 operator-only: resolve an open dispute. Resolution is audited and does
 * NOT itself release funds — release stays gated by the contract time-lock.
 */
export async function resolveShowCampaignDispute(input: {
  campaign: Campaign;
  token: string;
  disputeId: string;
  outcome: "upheld" | "rejected" | "inconclusive";
  operatorNote?: string | null;
}): Promise<ShowCampaignDispute> {
  const response = await fetch(
    `${API_BASE}/shows/campaigns/${encodeURIComponent(input.campaign.backendId)}/dispute/${encodeURIComponent(input.disputeId)}/resolve`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({ outcome: input.outcome, operatorNote: input.operatorNote }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Resolving the dispute failed with status ${response.status}`);
  }
  return await response.json() as ShowCampaignDispute;
}

// Re-exported as a sync getter for synchronous render paths (e.g. initial
// Sennarin hero render before client-side fetch resolves). Keep the async
// API above as the canonical one — delete this when a real API hooks in.
export function listCampaignsSync(): Campaign[] {
  return CAMPAIGNS;
}

export function getCampaignSync(id: string): Campaign | null {
  return CAMPAIGNS.find((c) => c.id === id) ?? null;
}

export function getFeaturedCampaignSync(): Campaign {
  const campaigns = filterActionableCampaigns(CAMPAIGNS);
  return campaigns.find((c) => c.featured) ?? campaigns[0] ?? CAMPAIGNS[0];
}

async function fetchShowsApi<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return null;
    }
    return await response.json() as T;
  } catch {
    return null;
  }
}

async function mutateShowCampaign(path: string, input: {
  method: "POST" | "PATCH";
  token: string;
  body: Record<string, unknown> | FormData;
}): Promise<Campaign> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.token}`,
  };
  let requestBody: BodyInit;
  if (typeof FormData !== "undefined" && input.body instanceof FormData) {
    requestBody = input.body;
  } else {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(input.body);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method: input.method,
    headers,
    body: requestBody,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Campaign update failed with status ${response.status}`);
  }

  return mapBackendCampaign(await response.json() as BackendShowCampaign);
}

function mapBackendCampaign(campaign: BackendShowCampaign, index = 0): Campaign {
  const decimals = campaign.paymentAssetDecimals ?? 2;
  const contractAddress = campaign.contractAddress ?? SEPOLIA_REVENUE_ESCROW;
  return {
    id: campaign.slug,
    backendId: campaign.id,
    rawStatus: campaign.status,
    campaignLevel: campaign.campaignLevel ?? "signal",
    artistAuthorityStatus: campaign.artistAuthorityStatus ?? "none",
    authorityCredentialId: campaign.authorityCredentialId ?? null,
    authorityEvidenceBundleId: campaign.authorityEvidenceBundleId ?? null,
    beneficiaryAddress: campaign.beneficiaryAddress ?? null,
    beneficiaryType: campaign.beneficiaryType ?? null,
    artistName: campaign.artistDisplayName,
    artistId: campaign.artistId ?? null,
    artistSlug: slugify(campaign.artistDisplayName),
    artistImage: mediaUrl(campaign.artist?.imageUrl),
    artistSummary: campaign.artist?.summary ?? null,
    artistLinks: stringRecord(campaign.artist?.socialLinks),
    isSample: booleanField(campaign.metadata, "fixture"),
    title: campaign.title,
    city: campaign.city,
    country: campaign.country,
    venue: campaign.venueTarget ?? undefined,
    targetDate: campaign.targetDate ?? addDaysFrom(campaign.deadline, 120),
    deadline: campaign.deadline,
    bookingDeadline: campaign.bookingDeadline ?? null,
    goalCents: unitsToCents(campaign.goalAmountUnits, decimals),
    raisedCents: unitsToCents(campaign.raisedAmountUnits, decimals),
    currency: campaign.currency === "EUR" ? "EUR" : "USD",
    paymentAssetSymbol: campaign.paymentAssetSymbol ?? "USDC",
    paymentAssetDecimals: decimals,
    chainId: campaign.chainId ?? null,
    releasePolicy: campaign.releasePolicy ?? null,
    depositReleaseBps: campaign.depositReleaseBps ?? null,
    disputeWindowSeconds: campaign.disputeWindowSeconds ?? null,
    onChainStatus: campaign.onChainStatus ?? null,
    totalRefundedUnits: campaign.totalRefundedUnits ?? null,
    totalReleasedUnits: campaign.totalReleasedUnits ?? null,
    feeBps: Number.isSafeInteger(campaign.feeBps) ? campaign.feeBps : null,
    totalFeePaidUnits: campaign.totalFeePaidUnits ?? campaign.totalFeePaid ?? null,
    campaignFeeBreakdown: campaign.campaignFeeBreakdown ?? null,
    disputeStatus: campaign.disputeStatus ?? null,
    disputeWindowClosesAt: campaign.disputeWindowClosesAt ?? null,
    // Managed-read-only; undefined on the public read. The mapper passes them
    // through so getManagedShowCampaign surfaces them in the operator panel.
    bookingEvidenceBundleId: campaign.bookingEvidenceBundleId ?? null,
    fulfillmentEvidenceBundleId: campaign.fulfillmentEvidenceBundleId ?? null,
    disputes: Array.isArray(campaign.disputes) ? campaign.disputes : [],
    backerCount: campaign.uniqueBackerCount ?? campaign.confirmedPledgeCount ?? 0,
    thresholdBackers: campaign.minimumBackers ?? 0,
    heroImage: mediaUrl(campaign.heroImageUrl),
    cardImage: mediaUrl(campaign.cardImageUrl) || mediaUrl(campaign.heroImageUrl),
    visuals: (campaign.visuals ?? [])
      .map((visual) => ({
        id: visual.id,
        role: visual.role ?? "gallery",
        url: mediaUrl(visual.publicUrl),
        sortOrder: visual.sortOrder ?? 0,
        caption: visual.caption ?? null,
        credit: visual.credit ?? null,
      }))
      .filter((visual) => visual.url),
    status: mapBackendStatus(campaign.status),
    featured: index === 0,
    contractAddress,
    escrowContractAddress: campaign.contractAddress ?? null,
    contractCampaignId: campaign.contractCampaignId ?? null,
    paymentTokenAddress: campaign.paymentTokenAddress ?? null,
    etherscanUrl: `${SHOWS_EXPLORER_BASE_URL}/${contractAddress}`,
    tagline: campaign.description || campaign.title,
    tiers: (campaign.tiers ?? []).map((tier) => ({
      id: tier.id,
      title: tier.title,
      description: tier.description ?? undefined,
      amountCents: unitsToCents(tier.amountUnits, tier.paymentAssetDecimals ?? decimals),
      currency: tier.currency === "EUR" ? "EUR" : "USD",
      paymentAssetSymbol: tier.paymentAssetSymbol ?? campaign.paymentAssetSymbol ?? "USDC",
    })),
  };
}

function mediaUrl(value?: string | null): string {
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:") || value.startsWith("blob:")) {
    return value;
  }
  return `${API_BASE}${value.startsWith("/") ? value : `/${value}`}`;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function booleanField(value: unknown, field: string): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>)[field] === true);
}

function unitsToCents(amountUnits: string, decimals: number): number {
  try {
    const units = BigInt(amountUnits);
    if (decimals >= 2) {
      const divisor = 10n ** BigInt(decimals - 2);
      return Number(units / divisor);
    }
    return Number(units * (10n ** BigInt(2 - decimals)));
  } catch {
    return 0;
  }
}

function addDaysFrom(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapBackendStatus(status: string): CampaignStatus {
  if (status === "funded") return "funded";
  if (["cancelled", "refund_available", "refunded"].includes(status)) return "refunded";
  if (["booking_confirmed", "deposit_released", "fulfilled", "released"].includes(status)) {
    return "booked";
  }
  return "active";
}

/**
 * Format a cents amount like 6_720_000 → "€67,200" (no fractional part
 * for the progress readout; the pledge flow will render cents later).
 */
export function formatMoney(cents: number, currency: Campaign["currency"]): string {
  const amount = Math.floor(cents / 100);
  const symbol = currency === "EUR" ? "€" : "$";
  return `${symbol}${amount.toLocaleString("en-US")}`;
}

/**
 * Format a cents amount compact: 6_720_000 → "€67.2k".
 */
export function formatMoneyCompact(cents: number, currency: Campaign["currency"]): string {
  const amount = cents / 100;
  const symbol = currency === "EUR" ? "€" : "$";
  if (amount >= 1000) {
    const k = amount / 1000;
    // 67.2 → "67.2", 80 → "80"
    const display = k >= 100 || k % 1 === 0 ? k.toFixed(0) : k.toFixed(1);
    return `${symbol}${display}k`;
  }
  return `${symbol}${amount.toLocaleString("en-US")}`;
}

/**
 * Clamp a 0-1 progress ratio from raised/goal.
 */
export function progressRatio(c: Campaign): number {
  if (c.goalCents <= 0) return 0;
  return Math.max(0, Math.min(1, c.raisedCents / c.goalCents));
}

/**
 * Integer days between now and the deadline, clamped to 0.
 */
export function daysUntil(deadlineIso: string, now: number = Date.now()): number {
  const diff = new Date(deadlineIso).getTime() - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}
