import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import {
  ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES,
  ACTIVE_CAMPAIGN_SUPPORT_PLEDGE_STATUSES,
} from "./community_eligibility.service";

export const COMMUNITY_PROFILE_VISIBILITIES = ["private", "community", "followers", "public"] as const;

export type CommunityProfileVisibility = (typeof COMMUNITY_PROFILE_VISIBILITIES)[number];

export interface CommunityVisibilitySettingsDto {
  showTasteBadges: boolean;
  showOwnedItems: boolean;
  showCampaignSupport: boolean;
  showShowAttendance: boolean;
  showPlaylists: boolean;
  showWalletAddress: boolean;
  allowTasteMatching: boolean;
  allowCityScenes: boolean;
}

export interface CommunityProfileDto {
  id: string;
  userId: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  profileVisibility: CommunityProfileVisibility;
  createdAt: string;
  updatedAt: string;
}

type ProfileRecord = {
  id: string;
  userId: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  profileVisibility: string;
  createdAt: Date;
  updatedAt: Date;
};

type VisibilityRecord = CommunityVisibilitySettingsDto;

type PublicProfileRecord = {
  profile: ProfileRecord;
  visibility: VisibilityRecord | null;
  wallet?: { address: string | null } | null;
  campaignSupport?: PublicCampaignSupportRecord[];
};

type PublicCampaignSupportRecord = {
  campaignId: string;
  campaignSlug: string;
  campaignTitle: string;
  artistDisplayName: string;
  city: string;
  country: string;
  grantedAt: Date;
};

const DEFAULT_VISIBILITY_SETTINGS: CommunityVisibilitySettingsDto = {
  showTasteBadges: false,
  showOwnedItems: false,
  showCampaignSupport: false,
  showShowAttendance: false,
  showPlaylists: false,
  showWalletAddress: false,
  allowTasteMatching: false,
  allowCityScenes: false,
};

@Injectable()
export class CommunityService {
  constructor(private readonly eventBus: EventBus) {}

  async getMyProfile(userId: string) {
    const [profile, visibility] = await Promise.all([
      this.getOrCreateProfile(userId),
      this.getOrCreateVisibilitySettings(userId),
    ]);

    return {
      schemaVersion: "community-profile/v1",
      profile: profileDto(profile),
      visibility: visibilityDto(visibility),
      privacy: {
        notes: [
          "Wallet address, ownership, taste badges, playlists, campaign support, and show attendance are hidden unless explicitly enabled.",
          "Eligibility for future holder benefits can remain private even when public showcase display is disabled.",
        ],
      },
    };
  }

  async updateMyProfile(userId: string, input: {
    displayName?: unknown;
    bio?: unknown;
    avatarUrl?: unknown;
    profileVisibility?: unknown;
    visibility?: Partial<Record<keyof CommunityVisibilitySettingsDto, unknown>>;
  }) {
    await this.ensureUser(userId);
    const profileData = normalizeProfileInput(input);
    const visibilityData = normalizeVisibilityInput(input.visibility);
    const changedProfileFields = Object.keys(profileData);
    const changedVisibilityFields = Object.keys(visibilityData);

    const [profile, visibility] = await prisma.$transaction([
      prisma.communityProfile.upsert({
        where: { userId },
        update: profileData,
        create: {
          userId,
          displayName: profileData.displayName ?? defaultDisplayName(userId),
          bio: profileData.bio,
          avatarUrl: profileData.avatarUrl,
          profileVisibility: profileData.profileVisibility ?? "private",
        },
      }),
      prisma.communityVisibilitySettings.upsert({
        where: { userId },
        update: visibilityData,
        create: {
          userId,
          ...DEFAULT_VISIBILITY_SETTINGS,
          ...visibilityData,
        },
      }),
    ]);

    if (changedProfileFields.includes("profileVisibility")) {
      this.publish("community.profile_visibility_updated", userId, {
        profileVisibility: profile.profileVisibility,
      });
    }
    if (changedVisibilityFields.length > 0) {
      this.publish("community.profile_showcase_updated", userId, {
        changedFields: changedVisibilityFields,
      });
      if (changedVisibilityFields.includes("showWalletAddress") || changedVisibilityFields.includes("showOwnedItems")) {
        this.publish("community.ownership_display_updated", userId, {
          showWalletAddress: visibility.showWalletAddress,
          showOwnedItems: visibility.showOwnedItems,
        });
      }
    }

    return {
      schemaVersion: "community-profile/v1",
      profile: profileDto(profile),
      visibility: visibilityDto(visibility),
    };
  }

  async getPublicProfile(userId: string) {
    const record = await prisma.communityProfile.findUnique({
      where: { userId },
      include: {
        user: {
          include: {
            communityVisibilitySettings: true,
            wallet: { select: { address: true } },
          },
        },
      },
    });

    if (!record) {
      throw new NotFoundException("Community profile not found");
    }
    if (record.profileVisibility !== "public") {
      throw new NotFoundException("Community profile is not public");
    }
    const visibility = visibilityDto(record.user.communityVisibilitySettings);
    const campaignSupport = visibility.showCampaignSupport
      ? await this.publicCampaignSupportFromPledges(userId, record.user.wallet?.address ?? null)
      : [];

    return publicProfileDto({
      profile: record,
      visibility,
      wallet: record.user.wallet,
      campaignSupport,
    });
  }

  private async getOrCreateProfile(userId: string) {
    await this.ensureUser(userId);
    return prisma.communityProfile.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        displayName: defaultDisplayName(userId),
        profileVisibility: "private",
      },
    });
  }

  private async getOrCreateVisibilitySettings(userId: string) {
    await this.ensureUser(userId);
    return prisma.communityVisibilitySettings.upsert({
      where: { userId },
      update: {},
      create: { userId, ...DEFAULT_VISIBILITY_SETTINGS },
    });
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

  private publish(eventName: string, userId: string, payload: Record<string, unknown>) {
    this.eventBus.publish({
      eventName,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      ...payload,
    } as never);
  }

  private async publicCampaignSupportFromPledges(
    userId: string,
    walletAddress: string | null,
  ): Promise<PublicCampaignSupportRecord[]> {
    const supporterIdentities: Prisma.ShowPledgeWhereInput[] = [{ userId }];
    if (walletAddress) {
      supporterIdentities.push({
        walletAddress: { equals: walletAddress, mode: "insensitive" },
      });
    }
    const pledges = await prisma.showPledge.findMany({
      where: {
        status: { in: ACTIVE_CAMPAIGN_SUPPORT_PLEDGE_STATUSES },
        OR: supporterIdentities,
        campaign: {
          status: { in: ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES },
        },
      },
      include: {
        campaign: {
          select: {
            id: true,
            slug: true,
            title: true,
            artistDisplayName: true,
            city: true,
            country: true,
          },
        },
      },
      orderBy: [
        { confirmedAt: "desc" },
        { createdAt: "desc" },
      ],
    });

    const supportByCampaignId = new Map<string, PublicCampaignSupportRecord>();
    for (const pledge of pledges) {
      if (supportByCampaignId.has(pledge.campaignId)) continue;
      const campaign = pledge.campaign;
      supportByCampaignId.set(pledge.campaignId, {
        campaignId: campaign.id,
        campaignSlug: campaign.slug,
        campaignTitle: campaign.title,
        artistDisplayName: campaign.artistDisplayName,
        city: campaign.city,
        country: campaign.country,
        grantedAt: pledge.confirmedAt ?? pledge.createdAt,
      });
    }
    return [...supportByCampaignId.values()];
  }
}

export function normalizeCommunityProfileVisibility(input: unknown): CommunityProfileVisibility | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "string") {
    throw new BadRequestException("profileVisibility must be a string");
  }
  const normalized = input.trim().toLowerCase();
  if (!COMMUNITY_PROFILE_VISIBILITIES.includes(normalized as CommunityProfileVisibility)) {
    throw new BadRequestException("profileVisibility must be private, community, followers, or public");
  }
  return normalized as CommunityProfileVisibility;
}

export function publicProfileDto(record: PublicProfileRecord) {
  const visibility = visibilityDto(record.visibility);
  const redactions: string[] = [];
  const hiddenFlags: Partial<Record<keyof CommunityVisibilitySettingsDto, string>> = {
    showTasteBadges: "taste_badges_hidden",
    showOwnedItems: "owned_items_hidden",
    showCampaignSupport: "campaign_support_hidden",
    showShowAttendance: "show_attendance_hidden",
    showPlaylists: "playlists_hidden",
    showWalletAddress: "wallet_address_hidden",
  };

  for (const [field, reason] of Object.entries(hiddenFlags)) {
    if (!visibility[field as keyof CommunityVisibilitySettingsDto]) {
      redactions.push(reason);
    }
  }

  return {
    schemaVersion: "community-public-profile/v1",
    profile: {
      userId: record.profile.userId,
      displayName: record.profile.displayName,
      bio: record.profile.bio,
      avatarUrl: record.profile.avatarUrl,
      profileVisibility: "public" as const,
    },
    showcase: {
      tasteBadgesVisible: visibility.showTasteBadges,
      ownedItemsVisible: visibility.showOwnedItems,
      campaignSupportVisible: visibility.showCampaignSupport,
      campaignSupport: visibility.showCampaignSupport
        ? (record.campaignSupport ?? []).map((support) => ({
          campaignId: support.campaignId,
          campaignSlug: support.campaignSlug,
          campaignTitle: support.campaignTitle,
          artistDisplayName: support.artistDisplayName,
          city: support.city,
          country: support.country,
          grantedAt: support.grantedAt.toISOString(),
        }))
        : [],
      showAttendanceVisible: visibility.showShowAttendance,
      playlistsVisible: visibility.showPlaylists,
      walletAddress: visibility.showWalletAddress ? record.wallet?.address ?? null : null,
    },
    redactions,
  };
}

function normalizeProfileInput(input: {
  displayName?: unknown;
  bio?: unknown;
  avatarUrl?: unknown;
  profileVisibility?: unknown;
}) {
  const data: {
    displayName?: string;
    bio?: string | null;
    avatarUrl?: string | null;
    profileVisibility?: CommunityProfileVisibility;
  } = {};
  if (input.displayName !== undefined) {
    data.displayName = normalizeRequiredString(input.displayName, "displayName", 80);
  }
  if (input.bio !== undefined) {
    data.bio = normalizeOptionalString(input.bio, "bio", 280);
  }
  if (input.avatarUrl !== undefined) {
    data.avatarUrl = normalizeOptionalString(input.avatarUrl, "avatarUrl", 500);
  }
  const profileVisibility = normalizeCommunityProfileVisibility(input.profileVisibility);
  if (profileVisibility) {
    data.profileVisibility = profileVisibility;
  }
  return data;
}

function normalizeVisibilityInput(input?: Partial<Record<keyof CommunityVisibilitySettingsDto, unknown>>) {
  const data: Partial<CommunityVisibilitySettingsDto> = {};
  if (!input) return data;
  for (const key of Object.keys(DEFAULT_VISIBILITY_SETTINGS) as (keyof CommunityVisibilitySettingsDto)[]) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean") {
        throw new BadRequestException(`${key} must be a boolean`);
      }
      data[key] = input[key] as boolean;
    }
  }
  return data;
}

function normalizeRequiredString(input: unknown, field: string, maxLength: number) {
  if (typeof input !== "string") {
    throw new BadRequestException(`${field} must be a string`);
  }
  const value = input.trim();
  if (!value) {
    throw new BadRequestException(`${field} is required`);
  }
  if (value.length > maxLength) {
    throw new BadRequestException(`${field} is too long`);
  }
  return value;
}

function normalizeOptionalString(input: unknown, field: string, maxLength: number) {
  if (input === null) return null;
  if (typeof input !== "string") {
    throw new BadRequestException(`${field} must be a string`);
  }
  const value = input.trim();
  if (!value) return null;
  if (value.length > maxLength) {
    throw new BadRequestException(`${field} is too long`);
  }
  return value;
}

function profileDto(profile: ProfileRecord): CommunityProfileDto {
  return {
    id: profile.id,
    userId: profile.userId,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    profileVisibility: normalizeProfileVisibilityForDto(profile.profileVisibility),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function visibilityDto(visibility?: VisibilityRecord | null): CommunityVisibilitySettingsDto {
  return {
    ...DEFAULT_VISIBILITY_SETTINGS,
    ...(visibility ?? {}),
  };
}

function normalizeProfileVisibilityForDto(input: string): CommunityProfileVisibility {
  return COMMUNITY_PROFILE_VISIBILITIES.includes(input as CommunityProfileVisibility)
    ? input as CommunityProfileVisibility
    : "private";
}

function defaultDisplayName(userId: string) {
  if (userId.startsWith("0x") && userId.length > 10) {
    return `${userId.slice(0, 6)}...${userId.slice(-4)}`;
  }
  return userId.slice(0, 80);
}
