import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ShowCampaignStatus, ShowPledgeStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";

export const COMMUNITY_BENEFIT_TYPES = [
  "room_access",
  "discount",
  "early_access",
  "fee_discount",
  "drop_priority",
  "ticket_priority",
  "remix_eligibility",
] as const;

export type CommunityBenefitType = (typeof COMMUNITY_BENEFIT_TYPES)[number];

const ACTIVE_RULE_STATUSES = ["active"] as const;
export const ACTIVE_CAMPAIGN_SUPPORT_PLEDGE_STATUSES: ShowPledgeStatus[] = ["confirmed", "released"];
export const ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES: ShowCampaignStatus[] = [
  "active",
  "funded",
  "booking_confirmed",
  "deposit_released",
  "fulfilled",
  "released",
];
const OWNERSHIP_POLICY_ASSET_TYPES = ["stem_nft"] as const;
const OWNERSHIP_ARTIST_CREDIT_ROLES = ["main", "primary"] as const;

type PolicyObject = Record<string, unknown>;

type EvaluationResult = {
  eligible: boolean;
  reasons: string[];
};

@Injectable()
export class CommunityEligibilityService {
  constructor(private readonly eventBus: EventBus) {}

  async evaluateAccessPolicy(userId: string, rawPolicy: Prisma.JsonValue): Promise<EvaluationResult> {
    return this.evaluatePolicy(userId, rawPolicy);
  }

  async listMyBadges(userId: string) {
    await this.syncCampaignSupporterBadges(userId);
    const badges = await prisma.communityBadge.findMany({
      where: { userId, revokedAt: null },
      orderBy: [{ grantedAt: "desc" }, { createdAt: "desc" }],
    });

    return {
      schemaVersion: "community-badges/v1",
      badges: badges.map((badge) => ({
        id: badge.id,
        badgeType: badge.badgeType,
        sourceType: badge.sourceType,
        sourceId: badge.sourceId,
        visibility: badge.visibility,
        grantedAt: badge.grantedAt.toISOString(),
      })),
      privacy: {
        publicDisplayRequiresProfileOptIn: true,
      },
    };
  }

  async listMyBenefits(userId: string) {
    await this.ensureUser(userId);
    const now = new Date();
    const rules = await prisma.communityBenefitRule.findMany({
      where: activeRuleWhere(now),
      include: {
        redemptions: {
          where: { userId },
          take: 1,
        },
      },
      orderBy: [{ createdAt: "desc" }],
    });
    const visibility = await prisma.communityVisibilitySettings.findUnique({ where: { userId } });

    const benefits = await Promise.all(
      rules.map(async (rule) => {
        const evaluation = await this.evaluatePolicy(userId, rule.eligibilityPolicy);
        const redemption = rule.redemptions[0] ?? null;
        return benefitDto(rule, evaluation, redemption);
      }),
    );

    return {
      schemaVersion: "community-benefits/v1",
      benefits,
      privacy: {
        proofDetails: "private",
        walletAddressVisible: visibility?.showWalletAddress ?? false,
        ownershipDisplayVisible: visibility?.showOwnedItems ?? false,
      },
    };
  }

  async redeemBenefit(userId: string, benefitRuleId: string) {
    await this.ensureUser(userId);
    const rule = await prisma.communityBenefitRule.findUnique({ where: { id: benefitRuleId } });
    if (!rule || !isActiveRule(rule, new Date())) {
      throw new NotFoundException("Community benefit rule not found");
    }

    const evaluation = await this.evaluatePolicy(userId, rule.eligibilityPolicy);
    if (!evaluation.eligible) {
      throw new ForbiddenException("Listener is not eligible for this benefit");
    }

    const existing = await prisma.communityBenefitRedemption.findUnique({
      where: {
        CommunityBenefitRedemption_identity: {
          benefitRuleId,
          userId,
        },
      },
    });
    if (existing) {
      return redemptionResponseDto(rule, evaluation, existing, true);
    }

    const redemption = await prisma.communityBenefitRedemption.create({
      data: {
        benefitRuleId,
        userId,
        redemptionStatus: "redeemed",
        settlementType: resolveSettlementType(rule.redemptionPolicy),
        redeemedAt: new Date(),
      },
    });

    this.eventBus.publish({
      eventName: "community.benefit_redeemed",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      benefitRuleId,
      benefitType: rule.benefitType,
    } as never);

    return redemptionResponseDto(rule, evaluation, redemption, false);
  }

  async syncCampaignSupporterBadges(userId: string, campaignId?: string) {
    await this.ensureUser(userId);
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    const pledgeClauses: Prisma.ShowPledgeWhereInput[] = [{ userId }];
    if (wallet?.address) {
      pledgeClauses.push({
        walletAddress: {
          equals: wallet.address.toLowerCase(),
          mode: Prisma.QueryMode.insensitive,
        },
      });
    }

    const pledges = await prisma.showPledge.findMany({
      where: {
        status: { in: ACTIVE_CAMPAIGN_SUPPORT_PLEDGE_STATUSES },
        ...(campaignId ? { campaignId } : {}),
        OR: pledgeClauses,
        campaign: {
          status: { in: ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES },
        },
      },
      include: { campaign: true },
      orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }],
    });

    const granted: Array<{ campaignId: string; badgeId: string; roleId: string }> = [];
    const activeCampaignIds = new Set<string>();
    for (const pledge of pledges) {
      activeCampaignIds.add(pledge.campaignId);
      const [badge, badgeWasGranted] = await this.upsertSupporterBadge(userId, pledge);
      const [role, roleWasGranted] = await this.upsertSupporterRole(userId, pledge);
      if (badgeWasGranted) {
        this.eventBus.publish({
          eventName: "community.badge_granted",
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          userId,
          badgeType: badge.badgeType,
          sourceType: badge.sourceType,
          sourceId: badge.sourceId,
          campaignId: pledge.campaignId,
          artistId: pledge.campaign.artistId,
          visibility: badge.visibility,
        } as never);
      }
      if (roleWasGranted) {
        this.eventBus.publish({
          eventName: "community.role_granted",
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          userId,
          roleType: role.roleType,
          scopeType: role.scopeType,
          scopeId: role.scopeId,
          sourceType: role.sourceType,
          sourceId: role.sourceId,
          campaignId: pledge.campaignId,
          artistId: pledge.campaign.artistId,
          visibility: role.visibility,
        } as never);
      }
      granted.push({ campaignId: pledge.campaignId, badgeId: badge.id, roleId: role.id });
    }
    await this.revokeExpiredSupporterProofs(userId, [...activeCampaignIds], campaignId);

    return {
      schemaVersion: "community-supporter-proofs/v1",
      granted,
      privacy: {
        proofDetails: "private",
        publicDisplayRequiresCampaignSupportOptIn: true,
      },
    };
  }

  private async evaluatePolicy(userId: string, rawPolicy: Prisma.JsonValue): Promise<EvaluationResult> {
    const policy = asPolicyObject(rawPolicy);
    const type = stringField(policy, "type");

    if (type === "manual") {
      return { eligible: true, reasons: ["manual_eligibility"] };
    }
    if (type === "badge") {
      return this.evaluateBadgePolicy(userId, policy);
    }
    if (type === "role") {
      return this.evaluateRolePolicy(userId, policy);
    }
    if (type === "ownership") {
      return this.evaluateOwnershipPolicy(userId, policy);
    }
    if (type === "campaign_support") {
      return this.evaluateCampaignSupportPolicy(userId, policy);
    }
    if (type === "show_attendance") {
      return this.evaluateShowAttendancePolicy(userId, policy);
    }
    if (type === "any_of" || type === "all_of") {
      return this.evaluateCompoundPolicy(userId, type, policy);
    }

    throw new BadRequestException(`Unsupported community eligibility policy type: ${type}`);
  }

  private async evaluateBadgePolicy(userId: string, policy: PolicyObject): Promise<EvaluationResult> {
    const badgeType = stringField(policy, "badgeType");
    const sourceType = optionalStringField(policy, "sourceType");
    const sourceId = optionalStringField(policy, "sourceId");
    const badge = await prisma.communityBadge.findFirst({
      where: {
        userId,
        badgeType,
        revokedAt: null,
        ...(sourceType ? { sourceType } : {}),
        ...(sourceId ? { sourceId } : {}),
      },
    });
    return badge ? { eligible: true, reasons: ["badge"] } : { eligible: false, reasons: ["badge_missing"] };
  }

  private async evaluateRolePolicy(userId: string, policy: PolicyObject): Promise<EvaluationResult> {
    const roleType = stringField(policy, "roleType");
    const scopeType = optionalStringField(policy, "scopeType");
    const scopeId = optionalStringField(policy, "scopeId");
    const role = await prisma.communityRole.findFirst({
      where: {
        userId,
        roleType,
        revokedAt: null,
        ...(scopeType ? { scopeType } : {}),
        ...(scopeId ? { scopeId } : {}),
      },
    });
    return role ? { eligible: true, reasons: ["role"] } : { eligible: false, reasons: ["role_missing"] };
  }

  private async evaluateOwnershipPolicy(userId: string, policy: PolicyObject): Promise<EvaluationResult> {
    const assetType = optionalStringField(policy, "assetType") ?? "stem_nft";
    if (!OWNERSHIP_POLICY_ASSET_TYPES.includes(assetType as (typeof OWNERSHIP_POLICY_ASSET_TYPES)[number])) {
      return { eligible: false, reasons: ["ownership_asset_unsupported"] };
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet?.address) {
      return { eligible: false, reasons: ["wallet_missing"] };
    }
    const walletAddresses = await this.ownershipWalletAddresses(userId, wallet);

    const listingWhere: Prisma.StemListingWhereInput = {};
    const chainId = optionalNumberField(policy, "chainId");
    const tokenId = optionalStringField(policy, "tokenId");
    const stemId = optionalStringField(policy, "stemId");
    const trackId = optionalStringField(policy, "trackId");
    const artistId = optionalStringField(policy, "artistId");

    if (chainId !== undefined) listingWhere.chainId = chainId;
    if (tokenId !== undefined) listingWhere.tokenId = BigInt(tokenId);
    if (stemId !== undefined) listingWhere.stemId = stemId;
    if (trackId !== undefined || artistId !== undefined) {
      listingWhere.stem = {
        ...(trackId ? { trackId } : {}),
        ...(artistId
          ? {
              track: {
                release: {
                  OR: [
                    { artistId },
                    {
                      artistCredits: {
                        some: {
                          artistId,
                          role: { in: [...OWNERSHIP_ARTIST_CREDIT_ROLES] },
                        },
                      },
                    },
                  ],
                },
              },
            }
          : {}),
      };
    }

    const purchases = await prisma.stemPurchase.findMany({
      where: {
        OR: walletAddresses.map((address) => ({
          buyerAddress: { equals: address, mode: Prisma.QueryMode.insensitive },
        })),
        amount: { gt: 0n },
        listing: listingWhere,
      },
      select: {
        amount: true,
        listing: { select: { chainId: true, tokenId: true } },
      },
    });
    const indexedBalances = new Map<string, bigint>();
    for (const purchase of purchases) {
      const key = indexedOwnershipKey(purchase.listing);
      indexedBalances.set(key, (indexedBalances.get(key) ?? 0n) + purchase.amount);
    }

    if (indexedBalances.size === 0) {
      return { eligible: false, reasons: ["ownership_missing"] };
    }

    const sales = await prisma.stemPurchase.findMany({
      where: {
        amount: { gt: 0n },
        listing: {
          ...listingWhere,
          OR: walletAddresses.map((address) => ({
            sellerAddress: { equals: address, mode: Prisma.QueryMode.insensitive },
          })),
        },
      },
      select: {
        amount: true,
        listing: { select: { chainId: true, tokenId: true } },
      },
    });
    for (const sale of sales) {
      const key = indexedOwnershipKey(sale.listing);
      indexedBalances.set(key, (indexedBalances.get(key) ?? 0n) - sale.amount);
    }

    return [...indexedBalances.values()].some((amount) => amount > 0n)
      ? { eligible: true, reasons: ["stem_nft_holder"] }
      : { eligible: false, reasons: ["ownership_missing"] };
  }

  private async ownershipWalletAddresses(
    userId: string,
    wallet: { address: string; ownerAddress: string | null },
  ) {
    const addresses = new Set([wallet.address.toLowerCase()]);
    if (wallet.ownerAddress) {
      addresses.add(wallet.ownerAddress.toLowerCase());
    }

    const linkedWallets = await prisma.wallet.findMany({
      where: {
        OR: [
          { userId },
          { address: { equals: wallet.address, mode: Prisma.QueryMode.insensitive } },
          { ownerAddress: { equals: wallet.address, mode: Prisma.QueryMode.insensitive } },
          ...(wallet.ownerAddress
            ? [
                { address: { equals: wallet.ownerAddress, mode: Prisma.QueryMode.insensitive } },
                { ownerAddress: { equals: wallet.ownerAddress, mode: Prisma.QueryMode.insensitive } },
              ]
            : []),
        ],
      },
      select: { address: true, ownerAddress: true },
    });
    for (const linked of linkedWallets) {
      addresses.add(linked.address.toLowerCase());
      if (linked.ownerAddress) {
        addresses.add(linked.ownerAddress.toLowerCase());
      }
    }

    return [...addresses];
  }

  private async evaluateCampaignSupportPolicy(userId: string, policy: PolicyObject): Promise<EvaluationResult> {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    const campaignId = stringField(policy, "campaignId");
    const minStatus = optionalStringField(policy, "minStatus") ?? "submitted";
    const statuses = campaignStatusesAtLeast(minStatus);
    const pledgeWalletClauses: Prisma.ShowPledgeWhereInput[] = [{ userId }];
    if (wallet?.address) {
      pledgeWalletClauses.push({
        walletAddress: {
          equals: wallet.address.toLowerCase(),
          mode: Prisma.QueryMode.insensitive,
        },
      });
    }

    const pledge = await prisma.showPledge.findFirst({
      where: {
        campaignId,
        status: { in: statuses },
        OR: pledgeWalletClauses,
        campaign: {
          status: { in: ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES },
        },
      },
    });

    return pledge
      ? { eligible: true, reasons: ["private_campaign_support"] }
      : { eligible: false, reasons: ["campaign_support_missing"] };
  }

  private async evaluateShowAttendancePolicy(userId: string, policy: PolicyObject): Promise<EvaluationResult> {
    const sourceId = optionalStringField(policy, "showId") ?? optionalStringField(policy, "campaignId");
    const badge = await prisma.communityBadge.findFirst({
      where: {
        userId,
        badgeType: "attendee",
        sourceType: "show",
        revokedAt: null,
        ...(sourceId ? { sourceId } : {}),
      },
    });

    return badge
      ? { eligible: true, reasons: ["show_attendance_badge"] }
      : { eligible: false, reasons: ["show_attendance_missing"] };
  }

  private async evaluateCompoundPolicy(
    userId: string,
    type: "any_of" | "all_of",
    policy: PolicyObject,
  ): Promise<EvaluationResult> {
    const clauses = Array.isArray(policy.policies) ? policy.policies : [];
    if (clauses.length === 0) {
      throw new BadRequestException("Compound eligibility policies require policies");
    }
    const results = await Promise.all(clauses.map((clause) => this.evaluatePolicy(userId, clause as Prisma.JsonValue)));
    const eligible = type === "any_of"
      ? results.some((result) => result.eligible)
      : results.every((result) => result.eligible);
    return {
      eligible,
      reasons: results.flatMap((result) => result.reasons),
    };
  }

  private async ensureUser(userId: string) {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: `${userId}@wallet.local`,
      },
    });
  }

  private async upsertSupporterBadge(
    userId: string,
    pledge: { campaignId: string },
  ) {
    const identity = {
      userId,
      badgeType: "supporter",
      sourceType: "show_campaign",
      sourceId: pledge.campaignId,
    };
    const existing = await prisma.communityBadge.findUnique({
      where: { CommunityBadge_identity: identity },
    });
    const wasGranted = existing?.revokedAt !== null;
    const badge = await prisma.communityBadge.upsert({
      where: { CommunityBadge_identity: identity },
      update: {
        visibility: "private",
        revokedAt: null,
      },
      create: {
        ...identity,
        visibility: "private",
      },
    });
    return [badge, wasGranted] as const;
  }

  private async upsertSupporterRole(
    userId: string,
    pledge: { id: string; campaignId: string },
  ) {
    const identity = {
      userId,
      roleType: "supporter",
      scopeType: "show_campaign",
      scopeId: pledge.campaignId,
    };
    const existing = await prisma.communityRole.findUnique({
      where: { CommunityRole_identity: identity },
    });
    const wasGranted = existing?.revokedAt !== null;
    const role = await prisma.communityRole.upsert({
      where: { CommunityRole_identity: identity },
      update: {
        sourceType: "campaign_pledge",
        sourceId: pledge.id,
        visibility: "private",
        revokedAt: null,
      },
      create: {
        ...identity,
        sourceType: "campaign_pledge",
        sourceId: pledge.id,
        visibility: "private",
      },
    });
    return [role, wasGranted] as const;
  }

  private async revokeExpiredSupporterProofs(userId: string, activeCampaignIds: string[], campaignId?: string) {
    if (campaignId && activeCampaignIds.includes(campaignId)) {
      return;
    }
    const now = new Date();
    const badgeScope = campaignId
      ? { sourceId: campaignId }
      : activeCampaignIds.length > 0
        ? { sourceId: { notIn: activeCampaignIds } }
        : {};
    const roleScope = campaignId
      ? { scopeId: campaignId }
      : activeCampaignIds.length > 0
        ? { scopeId: { notIn: activeCampaignIds } }
        : {};

    await prisma.$transaction([
      prisma.communityBadge.updateMany({
        where: {
          userId,
          badgeType: "supporter",
          sourceType: "show_campaign",
          revokedAt: null,
          ...badgeScope,
        },
        data: { revokedAt: now },
      }),
      prisma.communityRole.updateMany({
        where: {
          userId,
          roleType: "supporter",
          scopeType: "show_campaign",
          revokedAt: null,
          ...roleScope,
        },
        data: { revokedAt: now },
      }),
    ]);
  }
}

function activeRuleWhere(now: Date): Prisma.CommunityBenefitRuleWhereInput {
  return {
    status: { in: [...ACTIVE_RULE_STATUSES] },
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ],
  };
}

function isActiveRule(rule: { status: string; startsAt: Date | null; endsAt: Date | null }, now: Date) {
  return rule.status === "active" &&
    (!rule.startsAt || rule.startsAt <= now) &&
    (!rule.endsAt || rule.endsAt > now);
}

function benefitDto(
  rule: {
    id: string;
    title: string;
    description: string | null;
    benefitType: string;
    artistId: string | null;
    redemptionPolicy: Prisma.JsonValue | null;
  },
  evaluation: EvaluationResult,
  redemption: { id: string; redemptionStatus: string; redeemedAt: Date | null } | null,
) {
  return {
    id: rule.id,
    title: rule.title,
    description: rule.description,
    benefitType: rule.benefitType,
    artistId: rule.artistId,
    eligible: evaluation.eligible,
    redeemable: evaluation.eligible && !redemption,
    redeemed: Boolean(redemption),
    redemptionStatus: redemption?.redemptionStatus ?? null,
    redeemedAt: redemption?.redeemedAt?.toISOString() ?? null,
    reasons: evaluation.reasons,
    privacy: {
      proofDetails: "private",
    },
  };
}

function redemptionResponseDto(
  rule: {
    id: string;
    title: string;
    description: string | null;
    benefitType: string;
    artistId: string | null;
    redemptionPolicy: Prisma.JsonValue | null;
  },
  evaluation: EvaluationResult,
  redemption: { id: string; redemptionStatus: string; redeemedAt: Date | null; settlementType: string; settlementReference: string | null },
  idempotent: boolean,
) {
  return {
    schemaVersion: "community-benefit-redemption/v1",
    idempotent,
    benefit: benefitDto(rule, evaluation, redemption),
    redemption: {
      id: redemption.id,
      status: redemption.redemptionStatus,
      settlementType: redemption.settlementType,
      settlementReference: redemption.settlementReference,
      redeemedAt: redemption.redeemedAt?.toISOString() ?? null,
    },
  };
}

function asPolicyObject(policy: Prisma.JsonValue): PolicyObject {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new BadRequestException("Eligibility policy must be an object");
  }
  return policy as PolicyObject;
}

function stringField(policy: PolicyObject, field: string): string {
  const value = policy[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`Eligibility policy ${field} must be a string`);
  }
  return value.trim();
}

function optionalStringField(policy: PolicyObject, field: string): string | undefined {
  const value = policy[field];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new BadRequestException(`Eligibility policy ${field} must be a string`);
  }
  return String(value).trim();
}

function optionalNumberField(policy: PolicyObject, field: string): number | undefined {
  const value = policy[field];
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new BadRequestException(`Eligibility policy ${field} must be an integer`);
  }
  return number;
}

function indexedOwnershipKey(listing: { chainId: number; tokenId: bigint }) {
  return `${listing.chainId}:${listing.tokenId.toString()}`;
}

function campaignStatusesAtLeast(minStatus: string): ShowPledgeStatus[] {
  if (minStatus === "confirmed") return [...ACTIVE_CAMPAIGN_SUPPORT_PLEDGE_STATUSES];
  if (minStatus === "submitted") return ["submitted", ...ACTIVE_CAMPAIGN_SUPPORT_PLEDGE_STATUSES];
  throw new BadRequestException("campaign_support minStatus must be submitted or confirmed");
}

function resolveSettlementType(redemptionPolicy: Prisma.JsonValue | null): string {
  if (!redemptionPolicy || typeof redemptionPolicy !== "object" || Array.isArray(redemptionPolicy)) {
    return "none";
  }
  const settlementType = (redemptionPolicy as PolicyObject).settlementType;
  return typeof settlementType === "string" && settlementType.trim() ? settlementType.trim() : "none";
}
