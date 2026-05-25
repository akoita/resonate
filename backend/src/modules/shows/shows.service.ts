import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type {
  Artist,
  ShowArtistAuthorityStatus,
  ShowCampaignBeneficiaryType,
  ShowCampaignLevel,
  ShowCampaignReleasePolicy,
  ShowPledgeConfirmationStatus,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  AnalyticsGeoDimension,
  normalizeAnalyticsGeoDimension,
} from "../analytics/analytics_event";
import { pseudonymousAnalyticsActorId } from "../analytics/analytics_identity";
import { AnalyticsInstrumentationService } from "../analytics/analytics_instrumentation.service";
import {
  assertShowArtistAuthorityStatus,
  assertShowCampaignBeneficiaryType,
  assertShowCampaignLevel,
  assertShowCampaignReleasePolicy,
  assertShowPledgeConfirmationStatus,
} from "./show-status";

type Actor = {
  userId: string;
  role?: string;
};

type CampaignBaseInput = {
  artistId?: string | null;
  artistDisplayName: string;
  artistImageUrl?: string | null;
  title?: string | null;
  description?: string | null;
  city: string;
  country: string;
  venueTarget?: string | null;
  targetDate?: string | null;
  deadline: string;
  goalAmountUnits?: string | null;
  minimumBackers?: number | null;
  currency?: string | null;
  paymentAssetId?: string | null;
  paymentAssetSymbol?: string | null;
  paymentAssetDecimals?: number | null;
  paymentTokenAddress?: string | null;
  chainId?: number | null;
  bookingTerms?: unknown;
  fulfillmentNotes?: string | null;
  metadata?: Record<string, unknown> | null;
};

type CreateSignalInput = CampaignBaseInput & {
  campaignLevel?: ShowCampaignLevel;
};

type CreateCampaignInput = CampaignBaseInput & {
  campaignLevel?: ShowCampaignLevel;
  artistAuthorityStatus?: ShowArtistAuthorityStatus;
  authorityCredentialId?: string | null;
  authorityEvidenceBundleId?: string | null;
  beneficiaryAddress?: string | null;
  beneficiaryType?: ShowCampaignBeneficiaryType | null;
  bookingDeadline?: string | null;
  releasePolicy?: ShowCampaignReleasePolicy | null;
  depositReleaseBps?: number | null;
  disputeWindowSeconds?: number | null;
  tiers?: CampaignTierInput[] | null;
};

type CampaignTierInput = {
  title: string;
  description?: string | null;
  amountUnits: string;
  currency?: string | null;
  paymentAssetId?: string | null;
  paymentAssetSymbol?: string | null;
  paymentAssetDecimals?: number | null;
  maxBackers?: number | null;
  sortOrder?: number | null;
  benefits?: Record<string, unknown> | null;
};

type AuthorityRequestInput = {
  beneficiaryAddress?: string | null;
  beneficiaryType?: ShowCampaignBeneficiaryType | null;
  authorityEvidenceBundleId?: string | null;
  evidence?: Record<string, unknown> | null;
  requestedAuthorityStatus?: ShowArtistAuthorityStatus | null;
};

type AuthorityApprovalInput = {
  authorityStatus: ShowArtistAuthorityStatus;
  authorityCredentialId?: string | null;
  authorityEvidenceBundleId?: string | null;
  beneficiaryAddress?: string | null;
  beneficiaryType?: ShowCampaignBeneficiaryType | null;
};

type AuthorityRejectionInput = {
  reason?: string | null;
  authorityEvidenceBundleId?: string | null;
  evidence?: Record<string, unknown> | null;
};

type AuthorityRevocationInput = {
  reason?: string | null;
  authorityEvidenceBundleId?: string | null;
  evidence?: Record<string, unknown> | null;
};

type ActivateCampaignInput = {
  contractAddress?: string | null;
  contractCampaignId?: string | null;
};

type PledgeIntentInput = {
  tierId?: string | null;
  walletAddress: string;
  amountUnits?: string | null;
  paymentAssetId?: string | null;
  paymentAssetSymbol?: string | null;
  paymentAssetDecimals?: number | null;
  paymentTokenAddress?: string | null;
  chainId?: number | null;
  geo?: AnalyticsGeoDimension | null;
  metadata?: Record<string, unknown> | null;
};

type PledgeConfirmationInput = {
  transactionHash: string;
  blockNumber?: number | string | bigint | null;
  confirmationStatus?: ShowPledgeConfirmationStatus | null;
  failureReason?: string | null;
  receipt?: Record<string, unknown> | null;
};

type PledgeRefundConfirmationInput = {
  transactionHash: string;
  blockNumber?: number | string | bigint | null;
  receipt?: Record<string, unknown> | null;
};

type CampaignLifecycleInput = {
  evidenceBundleId?: string | null;
  reason?: string | null;
  evidence?: Record<string, unknown> | null;
};

type MyPledgesQuery = {
  walletAddress?: string | null;
  chainId?: number | string | null;
};

const DEFAULT_CURRENCY = "USD";
const DEFAULT_PAYMENT_ASSET_DECIMALS = 6;
const DEFAULT_DISPUTE_WINDOW_SECONDS = 604800;
const AUTHORIZED_STATUSES: ShowArtistAuthorityStatus[] = [
  "artist_authorized",
  "trusted_source_authorized",
];
const TERMINAL_AUTHORITY_STATUSES: ShowArtistAuthorityStatus[] = [
  "rejected",
  "revoked",
  "expired",
];

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${field} is required`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDate(value: unknown, field: string): Date {
  const text = requireText(value, field);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO date`);
  }
  return date;
}

function parseOptionalDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return parseDate(value, field);
}

function optionalPositiveInteger(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException(`${field} must be a non-negative integer`);
  }
  return value;
}

function optionalPositiveSafeInteger(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  return parsed;
}

function requireAmountUnits(value: unknown, field: string): string {
  const text = requireText(value, field);
  if (!/^[0-9]+$/.test(text) || BigInt(text) <= 0n) {
    throw new BadRequestException(`${field} must be a positive integer amount in base units`);
  }
  return text;
}

function parseOptionalBlockNumber(value: unknown): bigint | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "bigint") {
    if (value < 0n) throw new BadRequestException("blockNumber must be a non-negative integer");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new BadRequestException("blockNumber must be a non-negative integer");
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return BigInt(value);
  }
  throw new BadRequestException("blockNumber must be a non-negative integer");
}

function validateTransactionHash(value: unknown) {
  const text = requireText(value, "transactionHash").toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(text)) {
    throw new BadRequestException("transactionHash must be a valid EVM transaction hash");
  }
  return text;
}

function optionalJsonObject(value: unknown, field: string): Prisma.InputJsonObject | undefined {
  if (value === undefined) return undefined;
  if (value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${field} must be an object`);
  }
  return value as Prisma.InputJsonObject;
}

function mergeMetadata(existing: Prisma.JsonValue | null | undefined, patch: Record<string, unknown>): Prisma.InputJsonObject {
  return {
    ...(typeof existing === "object" && existing && !Array.isArray(existing)
      ? existing as Record<string, unknown>
      : {}),
    ...patch,
  } as Prisma.InputJsonObject;
}

function validateOptionalAddress(address: string | null | undefined, field: string) {
  if (address === undefined) return undefined;
  if (address === null) return null;
  const normalized = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
    throw new BadRequestException(`${field} must be a valid EVM address`);
  }
  return normalized;
}

function slugifyParts(parts: string[]) {
  const slug = parts
    .join(" ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || `campaign-${Date.now()}`;
}

function isPrivilegedActor(actor: Actor) {
  return ["admin", "operator"].includes(actor.role ?? "");
}

function configuredNumber(keys: string[], fallback: number) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (!value) continue;
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function defaultChainId() {
  return configuredNumber(["SHOWS_DEFAULT_CHAIN_ID", "PAYMENT_CHAIN_ID", "AA_CHAIN_ID", "CHAIN_ID"], 84532);
}

function defaultPaymentAssetSymbol() {
  return process.env.SHOWS_DEFAULT_PAYMENT_ASSET_SYMBOL?.trim() || "USDC";
}

function configuredDefaultPaymentTokenAddress() {
  return validateOptionalAddress(
    optionalText(process.env.SHOWS_DEFAULT_PAYMENT_TOKEN_ADDRESS)
      ?? optionalText(process.env.PAYMENT_USDC_ADDRESS),
    "SHOWS_DEFAULT_PAYMENT_TOKEN_ADDRESS",
  ) ?? null;
}

function configuredAllowedPaymentTokenAddresses() {
  const values = [
    ...(process.env.SHOWS_ALLOWED_PAYMENT_TOKEN_ADDRESSES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    optionalText(process.env.SHOWS_DEFAULT_PAYMENT_TOKEN_ADDRESS),
    optionalText(process.env.PAYMENT_USDC_ADDRESS),
  ].filter(Boolean) as string[];

  return new Set(values.map((value) => validateOptionalAddress(value, "SHOWS_ALLOWED_PAYMENT_TOKEN_ADDRESSES")!));
}

@Injectable()
export class ShowsService {
  constructor(private readonly analyticsInstrumentationService?: AnalyticsInstrumentationService) {}

  async listCampaigns(query: { includeSignals?: boolean; status?: string } = {}) {
    const includeSignals = query.includeSignals === true;
    return prisma.showCampaign.findMany({
      where: {
        ...(query.status ? { status: query.status as any } : {}),
        ...(includeSignals ? {} : { campaignLevel: { not: "signal" } }),
      },
      include: {
        tiers: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    });
  }

  async getCampaign(slug: string) {
    const campaign = await prisma.showCampaign.findUnique({
      where: { slug },
      include: {
        tiers: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
        events: { orderBy: { occurredAt: "desc" }, take: 50 },
      },
    });
    if (!campaign) {
      throw new NotFoundException("Show campaign not found");
    }
    return campaign;
  }

  async createSignal(actor: Actor, input: CreateSignalInput) {
    const normalized = this.normalizeCampaignBase(input, {
      defaultGoalAmountUnits: input.goalAmountUnits ?? "0",
      defaultChainId: input.chainId ?? defaultChainId(),
    });
    const slug = await this.uniqueSlug(normalized.artistDisplayName, normalized.city, normalized.country);

    const campaign = await prisma.showCampaign.create({
      data: {
        ...normalized,
        slug,
        title: input.title?.trim() || `${normalized.artistDisplayName} in ${normalized.city}`,
        status: "draft",
        campaignLevel: "signal",
        artistAuthorityStatus: "none",
        releasePolicy: "refund_only_until_booking",
        events: {
          create: {
            eventType: "campaign_signal_created",
            actorUserId: actor.userId,
            nextStatus: "draft",
            metadata: {
              campaignLevel: "signal",
              source: "shows-api",
            },
          },
        },
      },
      include: { events: true, tiers: true },
    });
    await this.recordShowAnalytics("shows.signal_created", actor, campaign, {
      campaignLevel: "signal",
    });
    return campaign;
  }

  async createDraftCampaign(actor: Actor, input: CreateCampaignInput) {
    const artistIdentity = await this.resolveCampaignArtistIdentity(actor, input.artistId ?? null);
    const normalized = this.normalizeCampaignBase(
      this.withPlatformArtistIdentity(input, artistIdentity),
      {
        defaultGoalAmountUnits: input.goalAmountUnits ?? undefined,
        defaultChainId: input.chainId ?? defaultChainId(),
      },
    );
    const campaignLevel = input.campaignLevel
      ? assertShowCampaignLevel(input.campaignLevel)
      : "active_escrow_campaign";
    if (campaignLevel === "signal") {
      throw new BadRequestException("Use /shows/signals for fan-proposed demand signals");
    }

    const depositReleaseBps = input.depositReleaseBps ?? 0;
    if (!Number.isSafeInteger(depositReleaseBps) || depositReleaseBps < 0 || depositReleaseBps > 3000) {
      throw new BadRequestException("depositReleaseBps must be between 0 and 3000");
    }

    const authorityStatus = input.artistAuthorityStatus
      ? assertShowArtistAuthorityStatus(input.artistAuthorityStatus)
      : "none";
    const beneficiary = this.normalizeCampaignBeneficiary(actor, artistIdentity, input);
    const releasePolicy = input.releasePolicy
      ? assertShowCampaignReleasePolicy(input.releasePolicy)
      : "refund_only_until_booking";
    const slug = await this.uniqueSlug(normalized.artistDisplayName, normalized.city, normalized.country);
    const tiers = this.normalizeCampaignTiers(input.tiers ?? [], normalized);

    const campaign = await prisma.showCampaign.create({
      data: {
        ...normalized,
        slug,
        title: input.title?.trim() || `${normalized.artistDisplayName} in ${normalized.city}`,
        status: "draft",
        campaignLevel,
        artistAuthorityStatus: authorityStatus,
        authorityCredentialId: optionalText(input.authorityCredentialId),
        authorityEvidenceBundleId: optionalText(input.authorityEvidenceBundleId),
        beneficiaryAddress: beneficiary.address,
        beneficiaryType: beneficiary.type,
        bookingDeadline: parseOptionalDate(input.bookingDeadline, "bookingDeadline"),
        releasePolicy,
        depositReleaseBps,
        disputeWindowSeconds: input.disputeWindowSeconds ?? DEFAULT_DISPUTE_WINDOW_SECONDS,
        ...(tiers.length > 0 ? { tiers: { create: tiers } } : {}),
        events: {
          create: {
            eventType: "campaign_created",
            actorUserId: actor.userId,
            nextStatus: "draft",
            metadata: {
              campaignLevel,
              artistAuthorityStatus: authorityStatus,
              source: "shows-api",
            },
          },
        },
      },
      include: { events: true, tiers: true },
    });
    await this.recordShowAnalytics("shows.campaign_created", actor, campaign, {
      campaignLevel,
      artistAuthorityStatus: authorityStatus,
    });
    return campaign;
  }

  async updateDraftCampaign(actor: Actor, campaignId: string, input: CreateCampaignInput) {
    const campaign = await this.getCampaignForMutation(actor, campaignId);
    if (campaign.status !== "draft") {
      throw new BadRequestException("Only draft campaigns can be edited");
    }
    if (campaign.campaignLevel === "signal") {
      throw new BadRequestException("Use the signal flow for fan-proposed campaigns");
    }

    const artistIdentity = await this.resolveCampaignArtistIdentity(actor, input.artistId ?? campaign.artistId);
    const normalized = this.normalizeCampaignBase(
      this.withPlatformArtistIdentity(input, artistIdentity),
      {
        defaultGoalAmountUnits: input.goalAmountUnits ?? undefined,
        defaultChainId: input.chainId ?? campaign.chainId,
      },
    );
    const depositReleaseBps = input.depositReleaseBps ?? campaign.depositReleaseBps;
    if (!Number.isSafeInteger(depositReleaseBps) || depositReleaseBps < 0 || depositReleaseBps > 3000) {
      throw new BadRequestException("depositReleaseBps must be between 0 and 3000");
    }

    const beneficiary = this.normalizeCampaignBeneficiary(actor, artistIdentity, input, {
      address: campaign.beneficiaryAddress,
      type: campaign.beneficiaryType,
    });
    const releasePolicy = input.releasePolicy
      ? assertShowCampaignReleasePolicy(input.releasePolicy)
      : campaign.releasePolicy;
    const tiers = this.normalizeCampaignTiers(input.tiers ?? [], normalized);

    return prisma.$transaction(async (tx) => {
      await tx.showCampaignTier.deleteMany({ where: { campaignId: campaign.id } });
      return tx.showCampaign.update({
        where: { id: campaign.id },
        data: {
          ...normalized,
          title: input.title?.trim() || `${normalized.artistDisplayName} in ${normalized.city}`,
          beneficiaryAddress: beneficiary.address,
          beneficiaryType: beneficiary.type,
          authorityEvidenceBundleId: optionalText(input.authorityEvidenceBundleId),
          bookingDeadline: parseOptionalDate(input.bookingDeadline, "bookingDeadline"),
          releasePolicy,
          depositReleaseBps,
          disputeWindowSeconds: input.disputeWindowSeconds ?? campaign.disputeWindowSeconds,
          tiers: tiers.length > 0 ? { create: tiers } : undefined,
          events: {
            create: {
              eventType: "campaign_updated",
              actorUserId: actor.userId,
              previousStatus: campaign.status,
              nextStatus: campaign.status,
              metadata: {
                source: "shows-api",
                tierCount: tiers.length,
              },
            },
          },
        },
        include: { events: { orderBy: { createdAt: "desc" }, take: 5 }, tiers: true },
      });
    });
  }

  async requestAuthority(actor: Actor, campaignId: string, input: AuthorityRequestInput) {
    const campaign = await this.getCampaignForMutation(actor, campaignId);
    if (campaign.status !== "draft") {
      throw new BadRequestException("Artist authority can only be requested before campaign activation");
    }
    const requested = input.requestedAuthorityStatus
      ? assertShowArtistAuthorityStatus(input.requestedAuthorityStatus)
      : "artist_acknowledged";
    if (AUTHORIZED_STATUSES.includes(requested)) {
      throw new BadRequestException("Authority approval must be performed by an operator");
    }
    if (TERMINAL_AUTHORITY_STATUSES.includes(requested)) {
      throw new BadRequestException("Use the authority review endpoints for terminal authority states");
    }

    const artistIdentity = await this.campaignArtistIdentity(campaign.artistId);
    const beneficiary = this.normalizeCampaignBeneficiary(actor, artistIdentity, input, {
      address: campaign.beneficiaryAddress,
      type: campaign.beneficiaryType,
    });
    const authorityEvidenceBundleId = optionalText(input.authorityEvidenceBundleId)
      ?? campaign.authorityEvidenceBundleId;
    const evidence = optionalJsonObject(input.evidence, "evidence");

    return prisma.showCampaign.update({
      where: { id: campaign.id },
      data: {
        artistAuthorityStatus: requested,
        beneficiaryAddress: beneficiary.address,
        beneficiaryType: beneficiary.type,
        authorityEvidenceBundleId,
        metadata: mergeMetadata(campaign.metadata, {
          ...(evidence !== undefined ? { authorityRequestEvidence: evidence } : {}),
        }),
        events: {
          create: {
            eventType: "artist_authority_requested",
            actorUserId: actor.userId,
            previousStatus: campaign.status,
            nextStatus: campaign.status,
            metadata: {
              requestedAuthorityStatus: requested,
              authorityEvidenceBundleId,
            },
          },
        },
      },
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 }, tiers: true },
    });
  }

  async approveAuthority(actor: Actor, campaignId: string, input: AuthorityApprovalInput) {
    if (!isPrivilegedActor(actor)) {
      throw new ForbiddenException("Only operators can approve artist authority");
    }
    const campaign = await this.findCampaignOrThrow(campaignId);
    if (campaign.status !== "draft") {
      throw new BadRequestException("Artist authority can only be approved before campaign activation");
    }
    const authorityStatus = assertShowArtistAuthorityStatus(input.authorityStatus);
    if (!AUTHORIZED_STATUSES.includes(authorityStatus)) {
      throw new BadRequestException("Approved authority status must authorize escrow activation");
    }
    const beneficiaryAddress = validateOptionalAddress(optionalText(input.beneficiaryAddress), "beneficiaryAddress")
      ?? campaign.beneficiaryAddress;
    const beneficiaryType = input.beneficiaryType
      ? assertShowCampaignBeneficiaryType(input.beneficiaryType)
      : campaign.beneficiaryType;
    if (!beneficiaryAddress || !beneficiaryType) {
      throw new BadRequestException("beneficiaryAddress and beneficiaryType are required for authority approval");
    }

    return prisma.showCampaign.update({
      where: { id: campaign.id },
      data: {
        artistAuthorityStatus: authorityStatus,
        authorityCredentialId: optionalText(input.authorityCredentialId) ?? campaign.authorityCredentialId,
        authorityEvidenceBundleId: optionalText(input.authorityEvidenceBundleId) ?? campaign.authorityEvidenceBundleId,
        beneficiaryAddress,
        beneficiaryType,
        artistAcceptedAt: new Date(),
        events: {
          create: {
            eventType: "artist_authority_approved",
            actorUserId: actor.userId,
            previousStatus: campaign.status,
            nextStatus: campaign.status,
            metadata: { artistAuthorityStatus: authorityStatus },
          },
        },
      },
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 }, tiers: true },
    });
  }

  async rejectAuthority(actor: Actor, campaignId: string, input: AuthorityRejectionInput = {}) {
    if (!isPrivilegedActor(actor)) {
      throw new ForbiddenException("Only operators can reject artist authority");
    }
    const campaign = await this.findCampaignOrThrow(campaignId);
    if (campaign.status !== "draft") {
      throw new BadRequestException("Artist authority can only be rejected before campaign activation");
    }
    const evidence = optionalJsonObject(input.evidence, "evidence");
    const authorityEvidenceBundleId = optionalText(input.authorityEvidenceBundleId)
      ?? campaign.authorityEvidenceBundleId;

    return prisma.showCampaign.update({
      where: { id: campaign.id },
      data: {
        artistAuthorityStatus: "rejected",
        authorityCredentialId: null,
        authorityEvidenceBundleId,
        metadata: mergeMetadata(campaign.metadata, {
          ...(evidence !== undefined ? { authorityRejectionEvidence: evidence } : {}),
        }),
        events: {
          create: {
            eventType: "artist_authority_rejected",
            actorUserId: actor.userId,
            previousStatus: campaign.status,
            nextStatus: campaign.status,
            metadata: {
              reason: optionalText(input.reason),
              authorityEvidenceBundleId,
            },
          },
        },
      },
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 }, tiers: true },
    });
  }

  async revokeAuthority(actor: Actor, campaignId: string, input: AuthorityRevocationInput = {}) {
    if (!isPrivilegedActor(actor)) {
      throw new ForbiddenException("Only operators can revoke artist authority");
    }
    const campaign = await this.findCampaignOrThrow(campaignId);
    if (["released", "refunded"].includes(campaign.status)) {
      throw new BadRequestException("Completed campaigns cannot have authority revoked");
    }
    const evidence = optionalJsonObject(input.evidence, "evidence");
    const authorityEvidenceBundleId = optionalText(input.authorityEvidenceBundleId)
      ?? campaign.authorityEvidenceBundleId;

    return prisma.showCampaign.update({
      where: { id: campaign.id },
      data: {
        artistAuthorityStatus: "revoked",
        authorityCredentialId: null,
        authorityEvidenceBundleId,
        metadata: mergeMetadata(campaign.metadata, {
          ...(evidence !== undefined ? { authorityRevocationEvidence: evidence } : {}),
        }),
        events: {
          create: {
            eventType: "artist_authority_revoked",
            actorUserId: actor.userId,
            previousStatus: campaign.status,
            nextStatus: campaign.status,
            metadata: {
              reason: optionalText(input.reason),
              authorityEvidenceBundleId,
            },
          },
        },
      },
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 }, tiers: true },
    });
  }

  async expireAuthority(actor: Actor, campaignId: string, input: AuthorityRevocationInput = {}) {
    if (!isPrivilegedActor(actor)) {
      throw new ForbiddenException("Only operators can expire artist authority");
    }
    const campaign = await this.findCampaignOrThrow(campaignId);
    if (campaign.status !== "draft") {
      throw new BadRequestException("Artist authority can only expire before campaign activation");
    }
    const evidence = optionalJsonObject(input.evidence, "evidence");
    const authorityEvidenceBundleId = optionalText(input.authorityEvidenceBundleId)
      ?? campaign.authorityEvidenceBundleId;

    return prisma.showCampaign.update({
      where: { id: campaign.id },
      data: {
        artistAuthorityStatus: "expired",
        authorityCredentialId: null,
        authorityEvidenceBundleId,
        metadata: mergeMetadata(campaign.metadata, {
          ...(evidence !== undefined ? { authorityExpiryEvidence: evidence } : {}),
        }),
        events: {
          create: {
            eventType: "artist_authority_expired",
            actorUserId: actor.userId,
            previousStatus: campaign.status,
            nextStatus: campaign.status,
            metadata: {
              reason: optionalText(input.reason),
              authorityEvidenceBundleId,
            },
          },
        },
      },
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 }, tiers: true },
    });
  }

  async activateCampaign(actor: Actor, campaignId: string, input: ActivateCampaignInput = {}) {
    const campaign = await this.getCampaignForMutation(actor, campaignId);
    if (campaign.campaignLevel !== "active_escrow_campaign") {
      throw new BadRequestException("Only active escrow campaigns can be activated");
    }
    if (!AUTHORIZED_STATUSES.includes(campaign.artistAuthorityStatus)) {
      throw new BadRequestException("Artist authority must be approved before activation");
    }
    if (!campaign.beneficiaryAddress || !campaign.beneficiaryType) {
      throw new BadRequestException("Campaign beneficiary must be bound before activation");
    }
    if (campaign.status !== "draft") {
      throw new BadRequestException("Only draft campaigns can be activated");
    }

    return prisma.showCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "active",
        activatedAt: new Date(),
        contractAddress: validateOptionalAddress(optionalText(input.contractAddress), "contractAddress")
          ?? campaign.contractAddress,
        contractCampaignId: optionalText(input.contractCampaignId) ?? campaign.contractCampaignId,
        events: {
          create: {
            eventType: "campaign_activated",
            actorUserId: actor.userId,
            previousStatus: "draft",
            nextStatus: "active",
            metadata: {
              artistAuthorityStatus: campaign.artistAuthorityStatus,
              beneficiaryAddress: campaign.beneficiaryAddress,
              releasePolicy: campaign.releasePolicy,
            },
          },
        },
      },
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 }, tiers: true },
    });
  }

  async createPledgeIntent(actor: Actor, campaignId: string, input: PledgeIntentInput) {
    const campaign = await prisma.showCampaign.findUnique({
      where: { id: campaignId },
      include: { tiers: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!campaign) {
      throw new NotFoundException("Show campaign not found");
    }
    this.ensurePledgeableCampaign(campaign);

    const walletAddress = validateOptionalAddress(input.walletAddress, "walletAddress");
    if (!walletAddress) {
      throw new BadRequestException("walletAddress is required");
    }

    const tierId = optionalText(input.tierId);
    const tier = tierId ? campaign.tiers.find((candidate) => candidate.id === tierId) : null;
    if (tierId && !tier) {
      throw new BadRequestException("tierId must reference an active campaign tier");
    }

    const amountUnits = input.amountUnits === undefined || input.amountUnits === null || input.amountUnits === ""
      ? tier?.amountUnits
      : requireAmountUnits(input.amountUnits, "amountUnits");
    if (!amountUnits) {
      throw new BadRequestException("amountUnits is required when no tier is selected");
    }
    if (tier && amountUnits !== tier.amountUnits) {
      throw new BadRequestException("amountUnits must match the selected tier amount");
    }

    const chainId = optionalPositiveSafeInteger(input.chainId, "chainId") ?? campaign.chainId;
    const paymentTokenAddress = this.normalizePaymentTokenAddress(
      optionalText(input.paymentTokenAddress) ?? campaign.paymentTokenAddress,
    );
    const paymentAssetDecimals = optionalPositiveInteger(input.paymentAssetDecimals, "paymentAssetDecimals")
      ?? tier?.paymentAssetDecimals
      ?? campaign.paymentAssetDecimals;
    const paymentAssetSymbol = optionalText(input.paymentAssetSymbol)
      ?? tier?.paymentAssetSymbol
      ?? campaign.paymentAssetSymbol;
    const paymentAssetId = optionalText(input.paymentAssetId)
      ?? tier?.paymentAssetId
      ?? campaign.paymentAssetId;
    const metadata = optionalJsonObject(input.metadata, "metadata");
    const receiptId = randomUUID();
    const createdAt = new Date();
    const receipt = {
      id: receiptId,
      campaignId: campaign.id,
      campaignSlug: campaign.slug,
      campaignTitle: campaign.title,
      tierId: tier?.id ?? null,
      tierTitle: tier?.title ?? null,
      walletAddress,
      amountUnits,
      currency: tier?.currency ?? campaign.currency,
      paymentAssetId,
      paymentAssetSymbol,
      paymentAssetDecimals,
      paymentTokenAddress,
      chainId,
      refundPolicy: campaign.releasePolicy,
      createdAt: createdAt.toISOString(),
    } satisfies Prisma.InputJsonObject;

    const pledge = await prisma.showPledge.create({
      data: {
        campaignId: campaign.id,
        tierId: tier?.id,
        userId: actor.userId,
        walletAddress,
        amountUnits,
        currency: tier?.currency ?? campaign.currency,
        paymentAssetId,
        paymentAssetSymbol,
        paymentAssetDecimals,
        paymentTokenAddress,
        chainId,
        status: "intent_created",
        confirmationStatus: "not_submitted",
        receiptId,
        receipt,
        events: {
          create: {
            campaignId: campaign.id,
            eventType: "pledge_intent_created",
            actorUserId: actor.userId,
            actorWalletAddress: walletAddress,
            nextStatus: "intent_created",
            metadata: {
              tierId: tier?.id ?? null,
              amountUnits,
              paymentAssetSymbol,
              chainId,
              ...(metadata !== undefined ? { clientMetadata: metadata } : {}),
            },
          },
        },
      },
      include: {
        campaign: true,
        tier: true,
        events: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    await this.recordShowAnalytics("shows.pledge_intent_created", actor, campaign, {
      pledgeId: pledge.id,
      tierId: tier?.id,
      amountUnits,
      paymentAssetSymbol,
      chainId,
      geo: normalizeAnalyticsGeoDimension(input.geo) ?? campaignTargetGeo(campaign),
    });

    return {
      pledge: this.serializePledge(pledge),
      contractCall: this.buildPledgeContractCall(campaign, amountUnits, chainId, paymentTokenAddress),
    };
  }

  async confirmPledge(actor: Actor, pledgeId: string, input: PledgeConfirmationInput) {
    const pledge = await prisma.showPledge.findUnique({
      where: { id: pledgeId },
      include: {
        campaign: true,
        tier: true,
        events: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    if (!pledge) {
      throw new NotFoundException("Show pledge not found");
    }
    if (pledge.userId && pledge.userId !== actor.userId && !isPrivilegedActor(actor)) {
      throw new ForbiddenException("Only the pledge owner or an operator can confirm this pledge");
    }

    const transactionHash = validateTransactionHash(input.transactionHash);
    const duplicate = await prisma.showPledge.findFirst({
      where: {
        transactionHash,
        chainId: pledge.chainId,
        id: { not: pledge.id },
      },
    });
    if (duplicate) {
      throw new BadRequestException("transactionHash is already attached to another pledge");
    }

    const confirmationStatus = input.confirmationStatus
      ? assertShowPledgeConfirmationStatus(input.confirmationStatus)
      : "pending";
    if (confirmationStatus === "not_submitted") {
      throw new BadRequestException("confirmationStatus cannot return to not_submitted once a transaction is provided");
    }

    const blockNumber = parseOptionalBlockNumber(input.blockNumber);
    const now = new Date();
    const nextStatus = confirmationStatus === "confirmed"
      ? "confirmed"
      : confirmationStatus === "failed"
        ? "failed"
        : "submitted";
    const eventType = confirmationStatus === "confirmed"
      ? "pledge_confirmed"
      : confirmationStatus === "failed"
        ? "pledge_failed"
        : "pledge_submitted";
    const receiptPatch = optionalJsonObject(input.receipt, "receipt");
    const receipt = mergeMetadata(pledge.receipt, {
      transactionHash,
      confirmationStatus,
      submittedAt: pledge.submittedAt?.toISOString() ?? now.toISOString(),
      ...(confirmationStatus === "confirmed" ? { confirmedAt: now.toISOString() } : {}),
      ...(confirmationStatus === "failed" ? { failedAt: now.toISOString() } : {}),
      ...(receiptPatch !== undefined ? { confirmationReceipt: receiptPatch } : {}),
    });

    const updated = await prisma.showPledge.update({
      where: { id: pledge.id },
      data: {
        transactionHash,
        blockNumber,
        confirmationStatus,
        status: nextStatus,
        receipt,
        failureReason: confirmationStatus === "failed" ? optionalText(input.failureReason) : null,
        submittedAt: pledge.submittedAt ?? now,
        confirmedAt: confirmationStatus === "confirmed" ? now : pledge.confirmedAt,
        failedAt: confirmationStatus === "failed" ? now : pledge.failedAt,
        events: {
          create: {
            campaignId: pledge.campaignId,
            eventType,
            actorUserId: actor.userId,
            actorWalletAddress: pledge.walletAddress,
            previousStatus: pledge.status,
            nextStatus,
            transactionHash,
            blockNumber,
            metadata: {
              confirmationStatus,
              source: isPrivilegedActor(actor) ? "operator" : "wallet-user",
            },
          },
        },
      },
      include: {
        campaign: true,
        tier: true,
        events: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    await this.recordShowAnalytics(`shows.${eventType}`, actor, updated.campaign, {
      pledgeId: updated.id,
      tierId: updated.tierId,
      amountUnits: updated.amountUnits,
      paymentAssetSymbol: updated.paymentAssetSymbol,
      chainId: updated.chainId,
      confirmationStatus,
      geo: campaignTargetGeo(updated.campaign),
    });

    return { pledge: this.serializePledge(updated) };
  }

  async confirmPledgeRefund(actor: Actor, pledgeId: string, input: PledgeRefundConfirmationInput) {
    const pledge = await prisma.showPledge.findUnique({
      where: { id: pledgeId },
      include: {
        campaign: true,
        tier: true,
        events: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    if (!pledge) {
      throw new NotFoundException("Show pledge not found");
    }
    if (pledge.userId && pledge.userId !== actor.userId && !isPrivilegedActor(actor)) {
      throw new ForbiddenException("Only the pledge owner or an operator can confirm this refund");
    }
    if (!["submitted", "confirmed", "refund_available"].includes(pledge.status)) {
      throw new BadRequestException("Only submitted or confirmed pledges can be refunded");
    }
    if (!["refund_available", "refunded", "cancelled"].includes(pledge.campaign.status)) {
      throw new BadRequestException("Campaign refunds are not available");
    }

    const transactionHash = validateTransactionHash(input.transactionHash);
    const blockNumber = parseOptionalBlockNumber(input.blockNumber);
    const receiptPatch = optionalJsonObject(input.receipt, "receipt");
    const now = new Date();
    const receipt = mergeMetadata(pledge.receipt, {
      refund: {
        transactionHash,
        blockNumber: blockNumber?.toString() ?? null,
        confirmedAt: now.toISOString(),
        ...(receiptPatch !== undefined ? { receipt: receiptPatch } : {}),
      },
    });

    const updated = await prisma.showPledge.update({
      where: { id: pledge.id },
      data: {
        status: "refunded",
        refundAvailableAt: pledge.refundAvailableAt ?? now,
        refundedAt: now,
        receipt,
        events: {
          create: {
            campaignId: pledge.campaignId,
            eventType: "pledge_refunded",
            actorUserId: actor.userId,
            actorWalletAddress: pledge.walletAddress,
            previousStatus: pledge.status,
            nextStatus: "refunded",
            transactionHash,
            blockNumber,
            metadata: {
              source: isPrivilegedActor(actor) ? "operator" : "wallet-user",
            },
          },
        },
      },
      include: {
        campaign: true,
        tier: true,
        events: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });

    return { pledge: this.serializePledge(updated) };
  }

  async cancelCampaign(actor: Actor, campaignId: string, input: CampaignLifecycleInput = {}) {
    const campaign = await this.getCampaignForMutation(actor, campaignId);
    if (!["draft", "active", "funded", "booking_confirmed"].includes(campaign.status)) {
      throw new BadRequestException("Campaign cannot be cancelled from its current status");
    }

    const evidence = optionalJsonObject(input.evidence, "evidence");
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const refundablePledges = await tx.showPledge.findMany({
        where: {
          campaignId: campaign.id,
          status: { in: ["submitted", "confirmed"] },
        },
        select: { id: true, status: true, walletAddress: true },
      });

      const updated = await tx.showCampaign.update({
        where: { id: campaign.id },
        data: {
          status: "refund_available",
          cancelledAt: now,
          refundAvailableAt: now,
          metadata: mergeMetadata(campaign.metadata, {
            ...(evidence !== undefined ? { cancellationEvidence: evidence } : {}),
          }),
          events: {
            create: [
              {
                eventType: "campaign_cancelled",
                actorUserId: actor.userId,
                previousStatus: campaign.status,
                nextStatus: "refund_available",
                metadata: {
                  reason: optionalText(input.reason),
                  evidenceBundleId: optionalText(input.evidenceBundleId),
                },
              },
              {
                eventType: "refund_available",
                actorUserId: actor.userId,
                previousStatus: campaign.status,
                nextStatus: "refund_available",
                metadata: {
                  source: "campaign-cancelled",
                },
              },
            ],
          },
        },
        include: { events: { orderBy: { createdAt: "desc" }, take: 5 }, tiers: true },
      });

      if (refundablePledges.length > 0) {
        await tx.showPledge.updateMany({
          where: { id: { in: refundablePledges.map((pledge) => pledge.id) } },
          data: {
            status: "refund_available",
            refundAvailableAt: now,
          },
        });
        await tx.showCampaignEvent.createMany({
          data: refundablePledges.map((pledge) => ({
            campaignId: campaign.id,
            pledgeId: pledge.id,
            eventType: "pledge_refund_available",
            actorUserId: actor.userId,
            actorWalletAddress: pledge.walletAddress,
            previousStatus: pledge.status,
            nextStatus: "refund_available",
            metadata: { source: "campaign-cancelled" },
          })),
        });
      }

      return updated;
    });
  }

  async confirmBooking(actor: Actor, campaignId: string, input: CampaignLifecycleInput = {}) {
    if (!isPrivilegedActor(actor)) {
      throw new ForbiddenException("Only operators can confirm booking evidence");
    }
    const campaign = await this.findCampaignOrThrow(campaignId);
    if (campaign.status !== "funded") {
      throw new BadRequestException("Campaign must be funded before booking can be confirmed");
    }
    if (campaign.bookingDeadline && campaign.bookingDeadline.getTime() < Date.now()) {
      throw new BadRequestException("Booking deadline has passed; refunds should be opened");
    }

    const evidence = optionalJsonObject(input.evidence, "evidence");
    const evidenceBundleId = optionalText(input.evidenceBundleId) ?? campaign.bookingEvidenceBundleId;
    const now = new Date();
    return prisma.showCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "booking_confirmed",
        bookingConfirmedAt: now,
        bookingEvidenceBundleId: evidenceBundleId,
        metadata: mergeMetadata(campaign.metadata, {
          ...(evidence !== undefined ? { bookingEvidence: evidence } : {}),
        }),
        events: {
          create: {
            eventType: "booking_confirmed",
            actorUserId: actor.userId,
            previousStatus: campaign.status,
            nextStatus: "booking_confirmed",
            metadata: {
              evidenceBundleId,
              reason: optionalText(input.reason),
            },
          },
        },
      },
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 }, tiers: true },
    });
  }

  async confirmFulfillment(actor: Actor, campaignId: string, input: CampaignLifecycleInput = {}) {
    if (!isPrivilegedActor(actor)) {
      throw new ForbiddenException("Only operators can confirm fulfillment evidence");
    }
    const campaign = await this.findCampaignOrThrow(campaignId);
    if (!["booking_confirmed", "deposit_released"].includes(campaign.status)) {
      throw new BadRequestException("Campaign must be booking-confirmed before fulfillment can be confirmed");
    }

    const evidence = optionalJsonObject(input.evidence, "evidence");
    const evidenceBundleId = optionalText(input.evidenceBundleId) ?? campaign.fulfillmentEvidenceBundleId;
    const now = new Date();
    return prisma.showCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "fulfilled",
        fulfilledAt: now,
        fulfillmentEvidenceBundleId: evidenceBundleId,
        metadata: mergeMetadata(campaign.metadata, {
          ...(evidence !== undefined ? { fulfillmentEvidence: evidence } : {}),
        }),
        events: {
          create: {
            eventType: "fulfillment_confirmed",
            actorUserId: actor.userId,
            previousStatus: campaign.status,
            nextStatus: "fulfilled",
            metadata: {
              evidenceBundleId,
              reason: optionalText(input.reason),
            },
          },
        },
      },
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 }, tiers: true },
    });
  }

  async getMyPledges(actor: Actor, query: MyPledgesQuery = {}) {
    const walletAddress = validateOptionalAddress(optionalText(query.walletAddress), "walletAddress");
    const chainId = optionalPositiveSafeInteger(query.chainId, "chainId");
    const pledges = await prisma.showPledge.findMany({
      where: {
        userId: actor.userId,
        ...(walletAddress ? { walletAddress } : {}),
        ...(chainId ? { chainId } : {}),
      },
      include: {
        campaign: true,
        tier: true,
        events: { orderBy: { createdAt: "desc" }, take: 5 },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return pledges.map((pledge) => this.serializePledge(pledge));
  }

  private ensurePledgeableCampaign(campaign: {
    status: string;
    campaignLevel: string;
    artistAuthorityStatus: ShowArtistAuthorityStatus;
    beneficiaryAddress: string | null;
    beneficiaryType: ShowCampaignBeneficiaryType | null;
    deadline: Date;
  }) {
    if (campaign.campaignLevel !== "active_escrow_campaign") {
      throw new BadRequestException("Only active escrow campaigns can receive pledges");
    }
    if (campaign.status !== "active") {
      throw new BadRequestException("Campaign must be active before pledges can be created");
    }
    if (!AUTHORIZED_STATUSES.includes(campaign.artistAuthorityStatus)) {
      throw new BadRequestException("Artist authority must be approved before pledges can be created");
    }
    if (!campaign.beneficiaryAddress || !campaign.beneficiaryType) {
      throw new BadRequestException("Campaign beneficiary must be bound before pledges can be created");
    }
    if (campaign.deadline.getTime() <= Date.now()) {
      throw new BadRequestException("Campaign deadline has passed");
    }
  }

  private buildPledgeContractCall(
    campaign: { contractAddress: string | null; contractCampaignId: string | null },
    amountUnits: string,
    chainId: number,
    paymentTokenAddress: string | null | undefined,
  ) {
    if (!campaign.contractAddress || !campaign.contractCampaignId) {
      return null;
    }
    return {
      chainId,
      contractAddress: campaign.contractAddress,
      functionName: "pledge",
      args: [campaign.contractCampaignId, amountUnits],
      value: "0",
      paymentTokenAddress: paymentTokenAddress ?? null,
    };
  }

  private serializePledge<T extends {
    blockNumber: bigint | number | string | null;
    events?: Array<{ blockNumber: bigint | number | string | null }>;
  }>(pledge: T) {
    return {
      ...pledge,
      blockNumber: pledge.blockNumber?.toString() ?? null,
      events: pledge.events?.map((event) => ({
        ...event,
        blockNumber: event.blockNumber?.toString() ?? null,
      })),
    };
  }

  private normalizeCampaignBase(input: CampaignBaseInput, defaults: {
    defaultGoalAmountUnits?: string;
    defaultChainId: number;
  }) {
    const deadline = parseDate(input.deadline, "deadline");
    if (deadline.getTime() <= Date.now()) {
      throw new BadRequestException("deadline must be in the future");
    }
    const goalAmountUnits = optionalText(input.goalAmountUnits) ?? defaults.defaultGoalAmountUnits;
    if (!goalAmountUnits) {
      throw new BadRequestException("goalAmountUnits is required");
    }

    return {
      artistId: optionalText(input.artistId),
      artistDisplayName: requireText(input.artistDisplayName, "artistDisplayName"),
      artistImageUrl: optionalText(input.artistImageUrl),
      description: optionalText(input.description),
      city: requireText(input.city, "city"),
      country: requireText(input.country, "country"),
      venueTarget: optionalText(input.venueTarget),
      targetDate: parseOptionalDate(input.targetDate, "targetDate"),
      deadline,
      goalAmountUnits,
      minimumBackers: optionalPositiveInteger(input.minimumBackers, "minimumBackers"),
      currency: optionalText(input.currency) ?? DEFAULT_CURRENCY,
      paymentAssetId: optionalText(input.paymentAssetId),
      paymentAssetSymbol: optionalText(input.paymentAssetSymbol) ?? defaultPaymentAssetSymbol(),
      paymentAssetDecimals: input.paymentAssetDecimals ?? DEFAULT_PAYMENT_ASSET_DECIMALS,
      paymentTokenAddress: this.normalizePaymentTokenAddress(input.paymentTokenAddress),
      chainId: input.chainId ?? defaults.defaultChainId,
      bookingTerms: optionalJsonObject(input.bookingTerms, "bookingTerms"),
      fulfillmentNotes: optionalText(input.fulfillmentNotes),
      metadata: optionalJsonObject(input.metadata, "metadata"),
    };
  }

  private normalizeCampaignTiers(
    tiers: CampaignTierInput[],
    campaignDefaults: {
      currency: string;
      paymentAssetId?: string | null;
      paymentAssetSymbol: string;
      paymentAssetDecimals: number;
    },
  ) {
    if (!Array.isArray(tiers)) {
      throw new BadRequestException("tiers must be an array");
    }
    if (tiers.length > 12) {
      throw new BadRequestException("tiers cannot contain more than 12 entries");
    }

    return tiers.map((tier, index) => ({
      title: requireText(tier.title, `tiers[${index}].title`),
      description: optionalText(tier.description),
      amountUnits: requireAmountUnits(tier.amountUnits, `tiers[${index}].amountUnits`),
      currency: optionalText(tier.currency) ?? campaignDefaults.currency,
      paymentAssetId: optionalText(tier.paymentAssetId) ?? campaignDefaults.paymentAssetId,
      paymentAssetSymbol: optionalText(tier.paymentAssetSymbol) ?? campaignDefaults.paymentAssetSymbol,
      paymentAssetDecimals: optionalPositiveInteger(tier.paymentAssetDecimals, `tiers[${index}].paymentAssetDecimals`)
        ?? campaignDefaults.paymentAssetDecimals,
      maxBackers: optionalPositiveInteger(tier.maxBackers, `tiers[${index}].maxBackers`),
      sortOrder: optionalPositiveInteger(tier.sortOrder, `tiers[${index}].sortOrder`) ?? index,
      benefits: optionalJsonObject(tier.benefits, `tiers[${index}].benefits`),
      isActive: true,
    }));
  }

  private async uniqueSlug(artistDisplayName: string, city: string, country: string) {
    const base = slugifyParts([artistDisplayName, city, country]);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const existing = await prisma.showCampaign.findUnique({ where: { slug } });
      if (!existing) return slug;
    }
    return `${base}-${Date.now()}`;
  }

  private async resolveCampaignArtistIdentity(actor: Actor, artistId?: string | null) {
    if (artistId) {
      const artist = await prisma.artist.findUnique({ where: { id: artistId } });
      if (!artist) {
        throw new BadRequestException("artistId must reference an existing artist profile");
      }
      if (!isPrivilegedActor(actor) && artist.userId !== actor.userId) {
        throw new ForbiddenException("Campaign artist identity must match the authenticated artist profile");
      }
      return artist;
    }

    if (isPrivilegedActor(actor)) return null;
    const artist = await prisma.artist.findUnique({ where: { userId: actor.userId } });
    if (!artist) {
      throw new ForbiddenException("Artist profile or operator role is required");
    }
    return artist;
  }

  private async campaignArtistIdentity(artistId: string | null) {
    if (!artistId) return null;
    return prisma.artist.findUnique({ where: { id: artistId } });
  }

  private withPlatformArtistIdentity<T extends CampaignBaseInput>(input: T, artist: Artist | null): T {
    if (!artist) return input;
    return {
      ...input,
      artistId: artist.id,
      artistDisplayName: artist.displayName,
    };
  }

  private normalizeCampaignBeneficiary(
    actor: Actor,
    artist: Artist | null,
    input: {
      beneficiaryAddress?: string | null;
      beneficiaryType?: ShowCampaignBeneficiaryType | null;
    },
    fallback: {
      address?: string | null;
      type?: ShowCampaignBeneficiaryType | null;
    } = {},
  ) {
    const requestedAddress = validateOptionalAddress(optionalText(input.beneficiaryAddress), "beneficiaryAddress");
    const requestedType = input.beneficiaryType
      ? assertShowCampaignBeneficiaryType(input.beneficiaryType)
      : undefined;

    if (artist && !isPrivilegedActor(actor)) {
      const payoutAddress = validateOptionalAddress(artist.payoutAddress, "artist.payoutAddress")!;
      if (requestedAddress && requestedAddress !== payoutAddress) {
        throw new BadRequestException(
          "beneficiaryAddress must match the authenticated artist payout address; update the artist profile or ask an operator to review an override",
        );
      }
      return {
        address: payoutAddress,
        type: "wallet" as ShowCampaignBeneficiaryType,
      };
    }

    return {
      address: requestedAddress ?? fallback.address ?? null,
      type: requestedType ?? fallback.type ?? (requestedAddress ? "wallet" as ShowCampaignBeneficiaryType : null),
    };
  }

  private normalizePaymentTokenAddress(value: unknown) {
    const paymentTokenAddress = validateOptionalAddress(optionalText(value), "paymentTokenAddress");
    if (!paymentTokenAddress) {
      return configuredDefaultPaymentTokenAddress();
    }

    const allowed = configuredAllowedPaymentTokenAddresses();
    if (allowed.size > 0 && !allowed.has(paymentTokenAddress)) {
      throw new BadRequestException("paymentTokenAddress must be one of the configured Shows payment tokens");
    }

    return paymentTokenAddress;
  }

  private async getCampaignForMutation(actor: Actor, campaignId: string) {
    const campaign = await this.findCampaignOrThrow(campaignId);
    if (isPrivilegedActor(actor)) return campaign;
    if (!campaign.artistId) {
      throw new ForbiddenException("Artist-owned campaign is required");
    }
    const artist = await prisma.artist.findUnique({ where: { id: campaign.artistId } });
    if (!artist || artist.userId !== actor.userId) {
      throw new ForbiddenException("Only the campaign artist or an operator can update this campaign");
    }
    return campaign;
  }

  private async findCampaignOrThrow(campaignId: string) {
    const campaign = await prisma.showCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException("Show campaign not found");
    }
    return campaign;
  }

  private async recordShowAnalytics(
    eventName: string,
    actor: Actor,
    campaign: {
      id: string;
      slug: string;
      artistId: string | null;
      artistDisplayName: string;
      city: string;
      country: string;
      campaignLevel: string;
    },
    details: {
      pledgeId?: string | null;
      tierId?: string | null;
      amountUnits?: string | null;
      paymentAssetSymbol?: string | null;
      chainId?: number | null;
      campaignLevel?: string | null;
      artistAuthorityStatus?: string | null;
      confirmationStatus?: string | null;
      geo?: AnalyticsGeoDimension;
    } = {},
  ) {
    if (!this.analyticsInstrumentationService) {
      return;
    }

    try {
      await this.analyticsInstrumentationService.recordProductEvent({
        eventName,
        producer: "shows-service",
        actorId: pseudonymousAnalyticsActorId(actor.userId),
        subjectType: "show_campaign",
        subjectId: campaign.id,
        source: "shows-api",
        geo: details.geo ?? campaignTargetGeo(campaign),
        payload: {
          campaignId: campaign.id,
          campaignSlug: campaign.slug,
          campaignLevel: details.campaignLevel ?? campaign.campaignLevel,
          artistId: campaign.artistId ?? undefined,
          pledgeId: details.pledgeId ?? undefined,
          tierId: details.tierId ?? undefined,
          amountUnits: details.amountUnits ?? undefined,
          paymentAssetSymbol: details.paymentAssetSymbol ?? undefined,
          chainId: details.chainId ?? undefined,
          artistAuthorityStatus: details.artistAuthorityStatus ?? undefined,
          confirmationStatus: details.confirmationStatus ?? undefined,
          campaignCountryCode: countryCode(campaign.country),
          campaignCitySlug: slugifyParts([campaign.city]),
        },
        sourceRefs: {
          campaignId: campaign.id,
          ...(details.pledgeId ? { pledgeId: details.pledgeId } : {}),
        },
      });
    } catch (error) {
      console.warn(
        `[Shows] Failed to record analytics event ${eventName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function campaignTargetGeo(campaign: { city: string; country: string }): AnalyticsGeoDimension | undefined {
  const code = countryCode(campaign.country);
  if (!code) {
    return undefined;
  }
  return {
    countryCode: code,
    citySlug: slugifyParts([campaign.city]),
    source: "campaign_target",
    precision: "city",
  };
}

function countryCode(country: string) {
  const normalized = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}
