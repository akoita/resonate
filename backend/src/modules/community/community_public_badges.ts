import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { normalizeCreditName, resolveCreditedArtistName } from "../shared/artist_attribution";
import {
  ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES,
  ACTIVE_CAMPAIGN_SUPPORT_PLEDGE_STATUSES,
  netIndexedStemHoldings,
  resolveOwnershipWalletAddresses,
} from "./community_eligibility.service";

/**
 * Opt-in public supporter and collector badges (#1106).
 *
 * Implements Phase 1 of `docs/rfc/public-supporter-collector-credential-rules.md`:
 * off-chain, non-transferable, revocable badges backed by EXISTING proofs —
 * campaign supporter badges (derived from confirmed pledges), manual
 * artist/operator badge grants, indexed stem NFT ownership, and owned
 * Punchline collectibles. Nothing here writes; it is a read-time projection.
 *
 * Privacy contract (enforced by the shape below, tested in
 * `community_public_badges.spec.ts` / `community_profile.integration.spec.ts`):
 * - display requires the per-type consent flag (`showSupporterBadges` /
 *   `showCollectorBadges`); holding a proof never implies display;
 * - one badge per artist — never token ids, counts, editions, or holdings;
 * - never a wallet address, pledge amount, spend, refund state, campaign or
 *   room id, or raw eligibility policy;
 * - lifecycle (refunded/failed/cancelled campaign, sold tokens), revocation,
 *   expiry, and moderation (ban/removal in an artist- or campaign-scoped room)
 *   all suppress display regardless of consent.
 */

export const PUBLIC_BADGE_SCHEMA_VERSION = "public-community-credential/v1";

/** Hard cap per badge type so a large collection never enumerates everything. */
export const PUBLIC_BADGE_CAP_PER_TYPE = 24;

/**
 * Membership states that mean moderation (or access reconciliation) took the
 * listener out of an artist's community. Both override public display for
 * that artist's badges — the RFC's "moderation removal/ban overrides display".
 */
export const MODERATION_BLOCKING_MEMBERSHIP_STATUSES = ["banned", "removed"] as const;

export type PublicBadgeCredentialType = "artist_supporter" | "artist_collector";
export type PublicBadgeProofMethod = "campaign_support" | "manual_grant" | "indexed_ownership";

export type PublicCommunityBadgeDto = {
  schemaVersion: typeof PUBLIC_BADGE_SCHEMA_VERSION;
  credentialId: string;
  credentialType: PublicBadgeCredentialType;
  displayLabel: string;
  artistId: string | null;
  artistDisplayName: string;
  tier: "supporter" | "collector";
  status: "active";
  visibility: "public_profile";
  issuedAt: string | null;
  expiresAt: string | null;
  proofMethod: PublicBadgeProofMethod;
};

export type PublicBadgeConsent = {
  showSupporterBadges: boolean;
  showCollectorBadges: boolean;
};

type BadgeCandidate = {
  artistId: string | null;
  artistDisplayName: string;
  issuedAt: Date | null;
  expiresAt: Date | null;
  proofMethod: PublicBadgeProofMethod;
};

type ModerationBlocks = {
  artistIds: Set<string>;
  campaignIds: Set<string>;
};

export async function loadPublicCommunityBadges(
  userId: string,
  consent: PublicBadgeConsent,
  now: Date = new Date(),
): Promise<{ supporterBadges: PublicCommunityBadgeDto[]; collectorBadges: PublicCommunityBadgeDto[] }> {
  if (!consent.showSupporterBadges && !consent.showCollectorBadges) {
    return { supporterBadges: [], collectorBadges: [] };
  }

  const badgeTypes = [
    ...(consent.showSupporterBadges ? ["supporter"] : []),
    ...(consent.showCollectorBadges ? ["collector"] : []),
  ];
  const [blocks, wallet, badgeRows] = await Promise.all([
    loadModerationBlocks(userId),
    prisma.wallet.findUnique({ where: { userId }, select: { address: true, ownerAddress: true } }),
    prisma.communityBadge.findMany({
      where: {
        userId,
        badgeType: { in: badgeTypes },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ grantedAt: "asc" }],
    }),
  ]);

  const [supporterBadges, collectorBadges] = await Promise.all([
    consent.showSupporterBadges
      ? supporterCandidates(userId, wallet?.address ?? null, badgeRows.filter((row) => row.badgeType === "supporter"), blocks)
      : Promise.resolve([]),
    consent.showCollectorBadges
      ? collectorCandidates(userId, wallet, badgeRows.filter((row) => row.badgeType === "collector"), blocks)
      : Promise.resolve([]),
  ]);

  return {
    supporterBadges: toDtos(userId, "artist_supporter", supporterBadges),
    collectorBadges: toDtos(userId, "artist_collector", collectorBadges),
  };
}

async function loadModerationBlocks(userId: string): Promise<ModerationBlocks> {
  const memberships = await prisma.communityMembership.findMany({
    where: { userId, status: { in: [...MODERATION_BLOCKING_MEMBERSHIP_STATUSES] } },
    select: { room: { select: { artistId: true, ownerType: true, ownerId: true } } },
  });
  const blocks: ModerationBlocks = { artistIds: new Set(), campaignIds: new Set() };
  for (const { room } of memberships) {
    if (room.artistId) blocks.artistIds.add(room.artistId);
    if (room.ownerType === "artist") blocks.artistIds.add(room.ownerId);
    if (room.ownerType === "show_campaign") blocks.campaignIds.add(room.ownerId);
  }
  return blocks;
}

type BadgeRow = {
  badgeType: string;
  sourceType: string;
  sourceId: string | null;
  grantedAt: Date;
  expiresAt: Date | null;
};

async function supporterCandidates(
  userId: string,
  walletAddress: string | null,
  rows: BadgeRow[],
  blocks: ModerationBlocks,
): Promise<BadgeCandidate[]> {
  const candidates: BadgeCandidate[] = [];

  // Campaign supporter badges: re-check the lifecycle live so a refund, failure,
  // or cancellation hides the badge even before the next badge sync revokes it.
  const campaignRows = rows.filter((row) => row.sourceType === "show_campaign" && row.sourceId);
  if (campaignRows.length > 0) {
    const identities: Prisma.ShowPledgeWhereInput[] = [{ userId }];
    if (walletAddress) {
      identities.push({ walletAddress: { equals: walletAddress, mode: Prisma.QueryMode.insensitive } });
    }
    const pledges = await prisma.showPledge.findMany({
      where: {
        campaignId: { in: campaignRows.map((row) => row.sourceId as string) },
        status: { in: ACTIVE_CAMPAIGN_SUPPORT_PLEDGE_STATUSES },
        OR: identities,
        campaign: { status: { in: ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES } },
      },
      select: { campaign: { select: { id: true, artistId: true, artistDisplayName: true } } },
    });
    const liveCampaigns = new Map(pledges.map((pledge) => [pledge.campaign.id, pledge.campaign]));
    for (const row of campaignRows) {
      const campaign = liveCampaigns.get(row.sourceId as string);
      if (!campaign || blocks.campaignIds.has(campaign.id)) continue;
      candidates.push({
        artistId: campaign.artistId,
        artistDisplayName: campaign.artistDisplayName,
        issuedAt: row.grantedAt,
        expiresAt: row.expiresAt,
        proofMethod: "campaign_support",
      });
    }
  }

  candidates.push(...(await manualArtistGrantCandidates(rows)));
  return candidates.filter((candidate) => !candidate.artistId || !blocks.artistIds.has(candidate.artistId));
}

async function collectorCandidates(
  userId: string,
  wallet: { address: string; ownerAddress: string | null } | null,
  rows: BadgeRow[],
  blocks: ModerationBlocks,
): Promise<BadgeCandidate[]> {
  const candidates: BadgeCandidate[] = [...(await manualArtistGrantCandidates(rows))];

  // Current-state collector proof from owned Punchline collectibles.
  const collectibles = await prisma.punchlineCollectible.findMany({
    where: { collectorUserId: userId, status: "owned" },
    select: {
      moment: {
        select: {
          drop: {
            select: {
              artistId: true,
              artist: { select: { displayName: true } },
              track: { select: { artist: true, release: { select: { primaryArtist: true } } } },
            },
          },
        },
      },
    },
  });
  for (const collectible of collectibles) {
    const drop = collectible.moment.drop;
    candidates.push({
      artistId: drop.artistId,
      artistDisplayName: resolveCreditedArtistName({
        trackArtist: drop.track?.artist,
        primaryArtist: drop.track?.release?.primaryArtist,
        accountDisplayName: drop.artist?.displayName,
      }) ?? "",
      issuedAt: null,
      expiresAt: null,
      proofMethod: "indexed_ownership",
    });
  }

  // Current-state collector proof from indexed stem NFT holdings (net of resales).
  if (wallet?.address) {
    const addresses = await resolveOwnershipWalletAddresses(userId, wallet);
    const holdings = await netIndexedStemHoldings(addresses);
    for (const holding of holdings.values()) {
      if (holding.amount <= 0n || !holding.artistId) continue;
      candidates.push({
        artistId: holding.artistId,
        artistDisplayName: holding.artistName ?? "",
        issuedAt: null,
        expiresAt: null,
        proofMethod: "indexed_ownership",
      });
    }
  }

  return candidates.filter((candidate) => candidate.artistId && !blocks.artistIds.has(candidate.artistId));
}

/** Artist/operator manual grants: `sourceType = "artist"`, `sourceId = artistId`. */
async function manualArtistGrantCandidates(rows: BadgeRow[]): Promise<BadgeCandidate[]> {
  const artistRows = rows.filter((row) => row.sourceType === "artist" && row.sourceId);
  if (artistRows.length === 0) return [];
  const artists = await prisma.artist.findMany({
    where: { id: { in: artistRows.map((row) => row.sourceId as string) } },
    select: { id: true, displayName: true },
  });
  const names = new Map(artists.map((artist) => [artist.id, artist.displayName]));
  return artistRows
    .filter((row) => names.has(row.sourceId as string))
    .map((row) => ({
      artistId: row.sourceId,
      artistDisplayName: names.get(row.sourceId as string) ?? "",
      issuedAt: row.grantedAt,
      expiresAt: row.expiresAt,
      proofMethod: "manual_grant" as const,
    }));
}

const PROOF_PRIORITY: Record<PublicBadgeProofMethod, number> = {
  campaign_support: 0,
  indexed_ownership: 1,
  manual_grant: 2,
};

/** Collapse candidates to one badge per artist and shape the public DTO. */
export function toDtos(
  userId: string,
  credentialType: PublicBadgeCredentialType,
  candidates: BadgeCandidate[],
): PublicCommunityBadgeDto[] {
  const byArtist = new Map<string, BadgeCandidate>();
  for (const candidate of candidates) {
    const name = normalizeCreditName(candidate.artistDisplayName);
    if (!candidate.artistId && !name) continue;
    const key = candidate.artistId ?? `name:${name.toLowerCase()}`;
    const existing = byArtist.get(key);
    if (!existing) {
      byArtist.set(key, { ...candidate, artistDisplayName: name });
      continue;
    }
    byArtist.set(key, {
      artistId: existing.artistId,
      artistDisplayName: existing.artistDisplayName || name,
      issuedAt: earliest(existing.issuedAt, candidate.issuedAt),
      // A non-expiring proof keeps the badge open-ended; otherwise the latest expiry wins.
      expiresAt: existing.expiresAt && candidate.expiresAt
        ? (existing.expiresAt > candidate.expiresAt ? existing.expiresAt : candidate.expiresAt)
        : null,
      proofMethod: PROOF_PRIORITY[candidate.proofMethod] < PROOF_PRIORITY[existing.proofMethod]
        ? candidate.proofMethod
        : existing.proofMethod,
    });
  }

  const tier = credentialType === "artist_supporter" ? "supporter" : "collector";
  return [...byArtist.entries()]
    .map(([key, badge]) => {
      const artistDisplayName = badge.artistDisplayName || "Artist";
      return {
        schemaVersion: PUBLIC_BADGE_SCHEMA_VERSION,
        credentialId: publicCredentialId(userId, credentialType, key),
        credentialType,
        displayLabel: tier === "supporter" ? `Supporter of ${artistDisplayName}` : `Collector of ${artistDisplayName}`,
        artistId: badge.artistId,
        artistDisplayName,
        tier,
        status: "active",
        visibility: "public_profile",
        issuedAt: badge.issuedAt ? badge.issuedAt.toISOString() : null,
        expiresAt: badge.expiresAt ? badge.expiresAt.toISOString() : null,
        proofMethod: badge.proofMethod,
      } satisfies PublicCommunityBadgeDto;
    })
    .sort((a, b) => a.artistDisplayName.localeCompare(b.artistDisplayName))
    .slice(0, PUBLIC_BADGE_CAP_PER_TYPE);
}

/** Stable, opaque id — never a wallet, badge row id, campaign id, or token id. */
export function publicCredentialId(userId: string, credentialType: string, artistKey: string) {
  const digest = createHash("sha256").update(`${userId}:${credentialType}:${artistKey}`).digest("hex");
  return `cred_${digest.slice(0, 24)}`;
}

function earliest(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}
