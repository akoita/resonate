import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CommunityCohort, CommunityCohortMembership } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";

const COHORT_TYPES = ["taste", "artist_affinity", "city_scene", "collector", "campaign"] as const;
const SOCIAL_TASTE_COHORT_TYPES = ["taste", "artist_affinity", "collector", "campaign"] as const;
const SUGGESTABLE_COHORT_STATUSES = ["suggested", "active"] as const;
const SUGGESTABLE_MEMBERSHIP_STATUSES = ["suggested", "joined"] as const;
const JOINABLE_MEMBERSHIP_STATUSES = ["suggested", "left"] as const;
const DETAIL_MEMBERSHIP_STATUSES = ["suggested", "joined"] as const;
const COHORT_MEMBER_PREVIEW_STATUSES = ["joined"] as const;
const COHORT_MEMBER_PROFILE_VISIBILITIES = ["public", "community"] as const;
const COHORT_MEMBER_PREVIEW_LIMIT = 6;
const UNSAFE_EXPLANATION_PATTERNS = [
  /0x[a-f0-9]{40}/i,
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  /\b(user(id)?|wallet|address|transaction|txhash|private)\b/i,
] as const;
const GENERIC_EXPLANATION = "This group is based on shared, privacy-safe community signals.";
const DISCOVERY_CONTEXT_LIMIT = 5;
const DISCOVERY_HINT_LIMIT = 4;

type CohortWithMembership = CommunityCohort & { memberships: CommunityCohortMembership[] };

type CommunityCohortVisibleMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  profileVisibility: string;
  cohortMembershipStatus: string;
  profileHref: string | null;
};

type CommunityCohortMemberVisibility = {
  visibilityScope: string;
  memberListLabel: string;
  anonymousMemberLabel: string;
  visibleMemberLimit: number;
  visibleMembers: CommunityCohortVisibleMember[];
  currentViewer: {
    canAppear: boolean;
    profileVisibility: string;
    cohortMembershipStatus: string;
    matchingConsentEnabled: boolean;
    reason: string;
  };
};

export interface CommunityCohortDiscoveryContext {
  cohortId: string;
  cohortType: string;
  reasonCode: string;
  title: string;
  explanation: string;
  queryHints: string[];
  analytics: {
    cohortId: string;
    cohortType: string;
    reasonCode: string;
  };
}

@Injectable()
export class CommunityCohortService {
  constructor(private readonly eventBus: EventBus) {}

  async listSuggestions(userId: string) {
    await this.ensureUser(userId);
    const visibility = await prisma.communityVisibilitySettings.findUnique({ where: { userId } });
    const now = new Date();
    const candidates = await prisma.communityCohort.findMany({
      where: {
        status: { in: [...SUGGESTABLE_COHORT_STATUSES] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        visibleMemberCount: { gte: 1 },
        memberships: {
          some: {
            userId,
            status: { in: [...SUGGESTABLE_MEMBERSHIP_STATUSES] },
          },
        },
      },
      include: {
        memberships: {
          where: { userId },
          take: 1,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    const cohorts: ReturnType<typeof cohortDto>[] = [];
    for (const cohort of candidates) {
      if (!hasCohortConsent(cohort.cohortType, visibility)) continue;
      if (!meetsMinimumSize(cohort)) continue;
      const membership = cohort.memberships[0];
      if (!membership || membership.status === "hidden") continue;
      cohorts.push(cohortDto(cohort, membership));
      if (membership.status === "suggested" && !membership.suggestedEventAt) {
        const marked = await prisma.communityCohortMembership.updateMany({
          where: { id: membership.id, suggestedEventAt: null },
          data: { suggestedEventAt: now },
        });
        if (marked.count === 1) {
          this.publish("community.cohort_suggested", userId, cohort, membership);
        }
      }
    }

    return {
      schemaVersion: "community-cohort-suggestions/v1",
      cohorts,
      privacy: {
        minimumSizeEnforced: true,
        explanationScope: "cohort_level",
        otherListenerIdentities: "redacted",
      },
    };
  }

  async joinCohort(userId: string, cohortId: string) {
    const { cohort, membership } = await this.requireActionableMembership(userId, cohortId, JOINABLE_MEMBERSHIP_STATUSES);
    const now = new Date();
    const updated = await prisma.communityCohortMembership.update({
      where: { id: membership.id },
      data: {
        status: "joined",
        joinedAt: now,
        leftAt: null,
        hiddenAt: null,
      },
    });
    this.publish("community.cohort_joined", userId, cohort, updated);
    return cohortMembershipResponse(cohort, updated);
  }

  async getCohortDetail(userId: string, cohortId: string) {
    const { cohort, membership } = await this.requireActionableMembership(userId, cohortId, DETAIL_MEMBERSHIP_STATUSES);
    const memberVisibility = await this.getMemberVisibility(userId, cohort, membership);
    return cohortDetailResponse(cohort, membership, memberVisibility);
  }

  async leaveCohort(userId: string, cohortId: string) {
    const { cohort, membership } = await this.requireActionableMembership(userId, cohortId, ["joined"]);
    const updated = await prisma.communityCohortMembership.update({
      where: { id: membership.id },
      data: {
        status: "left",
        leftAt: new Date(),
      },
    });
    this.publish("community.cohort_left", userId, cohort, updated);
    return cohortMembershipResponse(cohort, updated);
  }

  async hideCohort(userId: string, cohortId: string) {
    const { cohort, membership } = await this.requireActionableMembership(userId, cohortId, ["suggested", "left"]);
    const updated = await prisma.communityCohortMembership.update({
      where: { id: membership.id },
      data: {
        status: "hidden",
        hiddenAt: new Date(),
      },
    });
    this.publish("community.cohort_hidden", userId, cohort, updated);
    return cohortMembershipResponse(cohort, updated);
  }

  async getDiscoveryContextForUser(userId: string): Promise<CommunityCohortDiscoveryContext[]> {
    await this.ensureUser(userId);
    const visibility = await prisma.communityVisibilitySettings.findUnique({ where: { userId } });
    const now = new Date();
    const cohorts = await prisma.communityCohort.findMany({
      where: {
        status: { in: [...SUGGESTABLE_COHORT_STATUSES] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        visibleMemberCount: { gte: 1 },
        memberships: {
          some: {
            userId,
            status: "joined",
          },
        },
      },
      include: {
        memberships: {
          where: { userId, status: "joined" },
          take: 1,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: DISCOVERY_CONTEXT_LIMIT * 2,
    });

    return cohorts
      .filter((cohort) => cohort.memberships.length > 0)
      .filter((cohort) => hasCohortConsent(cohort.cohortType, visibility))
      .filter((cohort) => meetsMinimumSize(cohort))
      .slice(0, DISCOVERY_CONTEXT_LIMIT)
      .map(discoveryContextDto);
  }

  private async requireActionableMembership(
    userId: string,
    cohortId: string,
    statuses: readonly string[],
  ): Promise<{ cohort: CommunityCohort; membership: CommunityCohortMembership }> {
    await this.ensureUser(userId);
    const cohort = await prisma.communityCohort.findUnique({
      where: { id: cohortId },
      include: {
        memberships: {
          where: { userId },
          take: 1,
        },
      },
    });
    if (!cohort) throw new NotFoundException("Community cohort not found");
    if (!isCohortVisible(cohort) || !meetsMinimumSize(cohort)) {
      throw new NotFoundException("Community cohort not found");
    }

    const visibility = await prisma.communityVisibilitySettings.findUnique({ where: { userId } });
    if (!hasCohortConsent(cohort.cohortType, visibility)) {
      throw new ForbiddenException("Community cohort matching is disabled for this listener");
    }

    const membership = cohort.memberships[0];
    if (!membership || !statuses.includes(membership.status)) {
      throw new NotFoundException("Community cohort membership not found");
    }
    return { cohort, membership };
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

  private async getMemberVisibility(
    viewerId: string,
    cohort: CommunityCohort,
    viewerMembership: CommunityCohortMembership,
  ): Promise<CommunityCohortMemberVisibility> {
    const memberConsentWhere = cohort.cohortType === "city_scene"
      ? { allowCityScenes: true }
      : { allowTasteMatching: true };
    const [members, viewer] = await Promise.all([
      prisma.communityCohortMembership.findMany({
        where: {
          cohortId: cohort.id,
          status: { in: [...COHORT_MEMBER_PREVIEW_STATUSES] },
          user: {
            communityProfile: {
              is: {
                profileVisibility: { in: [...COHORT_MEMBER_PROFILE_VISIBILITIES] },
              },
            },
            communityVisibilitySettings: {
              is: memberConsentWhere,
            },
          },
        },
        include: {
          user: {
            select: {
              id: true,
              communityProfile: {
                select: {
                  displayName: true,
                  avatarUrl: true,
                  profileVisibility: true,
                  updatedAt: true,
                },
              },
            },
          },
        },
        orderBy: [{ id: "asc" }],
        take: COHORT_MEMBER_PREVIEW_LIMIT,
      }),
      prisma.user.findUnique({
        where: { id: viewerId },
        select: {
          communityProfile: {
            select: {
              profileVisibility: true,
            },
          },
          communityVisibilitySettings: true,
        },
      }),
    ]);

    const matchingConsentEnabled = hasCohortConsent(cohort.cohortType, viewer?.communityVisibilitySettings ?? null);
    const profileVisibility = normalizeProfileVisibility(viewer?.communityProfile?.profileVisibility ?? "private");
    const canAppear = viewerMembership.status === "joined" &&
      matchingConsentEnabled &&
      COHORT_MEMBER_PROFILE_VISIBILITIES.includes(profileVisibility as (typeof COHORT_MEMBER_PROFILE_VISIBILITIES)[number]);

    return {
      visibilityScope: "joined_public_or_community_profiles",
      memberListLabel: members.length > 0 ? "Opted-in cohort members" : "No visible members yet",
      anonymousMemberLabel: "Private and non-joined members stay anonymous.",
      visibleMemberLimit: COHORT_MEMBER_PREVIEW_LIMIT,
      visibleMembers: members
        .map((member) => visibleMemberDto(member))
        .filter((member): member is NonNullable<typeof member> => member !== null),
      currentViewer: {
        canAppear,
        profileVisibility,
        cohortMembershipStatus: viewerMembership.status,
        matchingConsentEnabled,
        reason: currentViewerVisibilityReason(viewerMembership.status, profileVisibility, matchingConsentEnabled),
      },
    };
  }

  private publish(
    eventName: "community.cohort_suggested" | "community.cohort_joined" | "community.cohort_left" | "community.cohort_hidden",
    userId: string,
    cohort: CommunityCohort,
    membership: CommunityCohortMembership,
  ) {
    this.eventBus.publish({
      eventName,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      cohortId: cohort.id,
      cohortType: cohort.cohortType,
      reasonCode: cohort.reasonCode,
      membershipStatus: membership.status,
      minimumSize: cohort.minimumSize,
      visibleMemberCount: cohort.visibleMemberCount,
    } as never);
  }
}

function cohortDto(cohort: CommunityCohort, membership: CommunityCohortMembership) {
  return {
    id: cohort.id,
    cohortType: normalizeCohortType(cohort.cohortType),
    reasonCode: safeReasonCode(cohort.reasonCode),
    title: cohort.title,
    safeExplanation: safeExplanation(cohort.safeExplanation),
    minimumSize: cohort.minimumSize,
    visibleMemberCount: cohort.visibleMemberCount,
    memberCountLabel: `${cohort.visibleMemberCount}+ listeners`,
    status: cohort.status,
    membership: membershipDto(membership),
    expiresAt: cohort.expiresAt?.toISOString() ?? null,
    createdAt: cohort.createdAt.toISOString(),
    updatedAt: cohort.updatedAt.toISOString(),
  };
}

function cohortMembershipResponse(cohort: CommunityCohort, membership: CommunityCohortMembership) {
  return {
    schemaVersion: "community-cohort-membership/v1",
    cohort: cohortDto(cohort, membership),
    membership: membershipDto(membership),
    privacy: {
      onChain: false,
      deletable: true,
      otherListenerIdentities: "redacted",
    },
  };
}

function cohortDetailResponse(
  cohort: CommunityCohort,
  membership: CommunityCohortMembership,
  memberVisibility: CommunityCohortMemberVisibility,
) {
  return {
    schemaVersion: "community-cohort-detail/v1",
    cohort: cohortDetailDto(cohort, membership),
    context: {
      signalLabel: signalLabelForType(cohort.cohortType),
      reasonCode: safeReasonCode(cohort.reasonCode),
      memberCountLabel: bucketedMemberCountLabel(cohort.visibleMemberCount),
      visibility: "suggested_or_joined_members_only",
      status: cohort.status,
    },
    actions: [
      {
        id: "browse_marketplace",
        label: "Browse marketplace",
        description: "Explore stems and releases while this cohort context is fresh.",
        href: "/marketplace",
        status: "available",
      },
      {
        id: "open_ai_dj",
        label: "Open AI DJ",
        description: "Start a listening session and let future cohort-aware discovery build from here.",
        href: "/agent",
        status: "available",
      },
    ],
    redactions: [
      "Only opted-in public or community profile summaries can appear.",
      "Private, hidden, left, and non-joined members stay anonymous.",
      "Wallet addresses and exact private membership details are not exposed.",
      "Raw listening history is never shown on cohort detail.",
    ],
    memberVisibility,
    privacy: {
      minimumSizeEnforced: true,
      memberCountsAreBucketed: true,
      otherListenerIdentities: "opted_in_profile_summaries_only",
      walletAddresses: "redacted",
      rawListeningHistory: "redacted",
      visibilityScope: "authenticated_visible_membership",
    },
  };
}

function cohortDetailDto(cohort: CommunityCohort, membership: CommunityCohortMembership) {
  return {
    id: cohort.id,
    cohortType: normalizeCohortType(cohort.cohortType),
    reasonCode: safeReasonCode(cohort.reasonCode),
    title: cohort.title,
    safeExplanation: safeExplanation(cohort.safeExplanation),
    memberCountLabel: bucketedMemberCountLabel(cohort.visibleMemberCount),
    status: cohort.status,
    membership: membershipDto(membership),
    expiresAt: cohort.expiresAt?.toISOString() ?? null,
    createdAt: cohort.createdAt.toISOString(),
    updatedAt: cohort.updatedAt.toISOString(),
  };
}

function membershipDto(membership: CommunityCohortMembership) {
  return {
    status: membership.status,
    suggestedAt: membership.suggestedAt.toISOString(),
    joinedAt: membership.joinedAt?.toISOString() ?? null,
    leftAt: membership.leftAt?.toISOString() ?? null,
    hiddenAt: membership.hiddenAt?.toISOString() ?? null,
  };
}

function hasCohortConsent(
  cohortType: string,
  visibility: { allowTasteMatching: boolean; allowCityScenes: boolean } | null,
) {
  if (cohortType === "city_scene") return visibility?.allowCityScenes === true;
  if (SOCIAL_TASTE_COHORT_TYPES.includes(cohortType as (typeof SOCIAL_TASTE_COHORT_TYPES)[number])) {
    return visibility?.allowTasteMatching === true;
  }
  return false;
}

function isCohortVisible(cohort: { status: string; expiresAt: Date | null }) {
  return SUGGESTABLE_COHORT_STATUSES.includes(cohort.status as (typeof SUGGESTABLE_COHORT_STATUSES)[number]) &&
    (!cohort.expiresAt || cohort.expiresAt.getTime() > Date.now());
}

function meetsMinimumSize(cohort: { minimumSize: number; visibleMemberCount: number }) {
  return cohort.minimumSize > 0 && cohort.visibleMemberCount >= cohort.minimumSize;
}

function normalizeCohortType(cohortType: string) {
  return COHORT_TYPES.includes(cohortType as (typeof COHORT_TYPES)[number]) ? cohortType : "taste";
}

function safeReasonCode(reasonCode: string) {
  return /^[a-z0-9_.:-]{1,64}$/i.test(reasonCode) ? reasonCode : "community_match";
}

function safeExplanation(explanation: string) {
  const trimmed = explanation.trim();
  if (!trimmed || trimmed.length > 240) return GENERIC_EXPLANATION;
  return UNSAFE_EXPLANATION_PATTERNS.some((pattern) => pattern.test(trimmed))
    ? GENERIC_EXPLANATION
    : trimmed;
}

function signalLabelForType(cohortType: string) {
  const labels: Record<string, string> = {
    taste: "Shared listening signal",
    artist_affinity: "Artist affinity signal",
    city_scene: "Scene discovery signal",
    collector: "Collector signal",
    campaign: "Campaign community signal",
  };
  return labels[normalizeCohortType(cohortType)] ?? "Community signal";
}

function bucketedMemberCountLabel(visibleMemberCount: number) {
  const buckets = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
  const eligibleBuckets = buckets.filter((bucket) => bucket <= visibleMemberCount);
  const bucket = eligibleBuckets[eligibleBuckets.length - 1];
  if (!bucket) return "Small listener group";
  return `${bucket.toLocaleString("en-US")}+ listeners`;
}

function visibleMemberDto(member: {
  userId: string;
  status: string;
  joinedAt: Date | null;
  user: {
    id: string;
    communityProfile: {
      displayName: string;
      avatarUrl: string | null;
      profileVisibility: string;
      updatedAt: Date;
    } | null;
  };
}) {
  const profile = member.user.communityProfile;
  if (!profile) return null;
  const profileVisibility = normalizeProfileVisibility(profile.profileVisibility);
  if (!COHORT_MEMBER_PROFILE_VISIBILITIES.includes(profileVisibility as (typeof COHORT_MEMBER_PROFILE_VISIBILITIES)[number])) {
    return null;
  }

  return {
    userId: member.user.id,
    displayName: safeDisplayText(profile.displayName, "Community member"),
    avatarUrl: safeAvatarUrl(profile.avatarUrl),
    profileVisibility,
    cohortMembershipStatus: member.status,
    profileHref: profileVisibility === "public"
      ? `/community/profile/${encodeURIComponent(member.user.id)}`
      : null,
  };
}

function normalizeProfileVisibility(visibility: string) {
  return ["private", "community", "followers", "public"].includes(visibility) ? visibility : "private";
}

function safeAvatarUrl(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 500) return null;
  try {
    const url = new URL(trimmed);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function currentViewerVisibilityReason(
  membershipStatus: string,
  profileVisibility: string,
  matchingConsentEnabled: boolean,
) {
  if (membershipStatus !== "joined") {
    return "Join this cohort before your community profile can appear here.";
  }
  if (!matchingConsentEnabled) {
    return "Community matching is off, so your profile is hidden from cohort member previews.";
  }
  if (profileVisibility === "public" || profileVisibility === "community") {
    return "Your profile can appear in joined cohort previews.";
  }
  if (profileVisibility === "followers") {
    return "Follower-scoped profiles stay hidden from cohort member previews.";
  }
  return "Your profile is private, so it stays hidden from cohort member previews.";
}

function discoveryContextDto(cohort: CommunityCohort): CommunityCohortDiscoveryContext {
  const cohortType = normalizeCohortType(cohort.cohortType);
  const reasonCode = safeReasonCode(cohort.reasonCode);
  const title = safeDisplayText(cohort.title, "Listener cohort");
  return {
    cohortId: cohort.id,
    cohortType,
    reasonCode,
    title,
    explanation: `From your ${title} cohort`,
    queryHints: discoveryQueryHints(cohort, reasonCode, title),
    analytics: {
      cohortId: cohort.id,
      cohortType,
      reasonCode,
    },
  };
}

function discoveryQueryHints(cohort: CommunityCohort, reasonCode: string, title: string) {
  const rawHints = [
    signalFromReasonCode(reasonCode),
    title
      .replace(/\b(listeners|supporters|collectors|cohort|community)\b/gi, " ")
      .trim(),
    signalFromMetadata(cohort.metadata),
  ];
  const hints: string[] = [];
  for (const raw of rawHints) {
    const hint = safeDiscoveryHint(raw);
    if (hint && !hints.some((existing) => existing.toLowerCase() === hint.toLowerCase())) {
      hints.push(hint);
    }
    if (hints.length >= DISCOVERY_HINT_LIMIT) break;
  }
  return hints;
}

function signalFromReasonCode(reasonCode: string) {
  const [, signal] = reasonCode.split(":", 2);
  return signal?.replace(/[_-]+/g, " ");
}

function signalFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return undefined;
  const signalKey = (metadata as { signalKey?: unknown }).signalKey;
  if (typeof signalKey !== "string") return undefined;
  return signalFromReasonCode(signalKey);
}

function safeDisplayText(value: string, fallback: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 80) return fallback;
  return UNSAFE_EXPLANATION_PATTERNS.some((pattern) => pattern.test(trimmed)) ? fallback : trimmed;
}

function safeDiscoveryHint(value: string | undefined) {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 48) return undefined;
  if (!/^[a-z0-9][a-z0-9 '&./-]*$/i.test(trimmed)) return undefined;
  if (UNSAFE_EXPLANATION_PATTERNS.some((pattern) => pattern.test(trimmed))) return undefined;
  return trimmed;
}
