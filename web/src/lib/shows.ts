/**
 * Resonate Shows — fan-funded artist-booking campaigns.
 *
 * This module defines the UI campaign shape used by the home page and the
 * `/shows` routes. Async reads hit the backend Shows API first and fall back
 * to seeded campaign data for local demos and offline UI tests.
 */

import { API_BASE, type Release } from "./api";

export type CampaignStatus = "active" | "funded" | "refunded" | "booked";

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
  contractAddress?: string | null;
  contractCampaignId?: string | null;
  description?: string | null;
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

export async function listCampaigns(): Promise<Campaign[]> {
  const campaigns = await fetchShowsApi<BackendShowCampaign[]>("/shows/campaigns");
  if (!campaigns?.length) {
    return CAMPAIGNS;
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
  return CAMPAIGNS.find((c) => c.featured) ?? CAMPAIGNS[0];
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
