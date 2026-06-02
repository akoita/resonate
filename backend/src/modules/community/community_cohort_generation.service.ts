import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { prisma } from "../../db/prisma";

const DEFAULT_MINIMUM_SIZE = 5;
const ACTIVE_CAMPAIGN_SUPPORT_PLEDGE_STATUSES = ["confirmed", "released"] as const;
const ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES = [
  "active",
  "funded",
  "booking_confirmed",
  "deposit_released",
  "fulfilled",
  "released",
] as const;
const VISIBLE_MEMBERSHIP_STATUSES = ["suggested", "joined"] as const;
const STALE_MEMBERSHIP_STATUS = "stale";
const UNSAFE_SIGNAL_PATTERNS = [
  /0x[a-f0-9]{40}/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(wallet|address|transaction|txhash|private key|secret|user id)\b/i,
];

export type CommunityCohortGenerationRequest = {
  minimumSize?: number;
  now?: Date | string;
};

type EligibleUser = {
  userId: string;
  allowTasteMatching: boolean;
  allowCityScenes: boolean;
};

type CohortCandidate = {
  cohortType: "taste" | "artist_affinity" | "city_scene" | "collector" | "campaign";
  reasonCode: string;
  title: string;
  safeExplanation: string;
  userIds: Set<string>;
  sourceTypes: Set<string>;
};

type MaterializedCohort = {
  cohortId: string;
  cohortType: string;
  reasonCode: string;
  visibleMemberCount: number;
  minimumSize: number;
  membershipsCreated: number;
  membershipsPreserved: number;
  hiddenMembershipsPreserved: number;
  staleMembershipsMarked: number;
  staleMembershipsRestored: number;
};

@Injectable()
export class CommunityCohortGenerationService {
  async generateCohorts(request: CommunityCohortGenerationRequest = {}) {
    const minimumSize = normalizeMinimumSize(request.minimumSize);
    const generatedAt = normalizeRunDate(request.now);
    const eligibleUsers = await this.loadEligibleUsers();
    const candidates = await this.buildCandidates(eligibleUsers);
    const materialized: MaterializedCohort[] = [];

    for (const candidate of candidates) {
      materialized.push(await this.materializeCandidate(candidate, minimumSize, generatedAt));
    }

    return {
      schemaVersion: "community-cohort-generation/v1",
      generatedAt: generatedAt.toISOString(),
      summary: {
        candidateCohorts: candidates.length,
        cohortsMaterialized: materialized.length,
        visibleCohorts: materialized.filter((cohort) => cohort.visibleMemberCount >= cohort.minimumSize).length,
        membershipsCreated: materialized.reduce((total, cohort) => total + cohort.membershipsCreated, 0),
        membershipsPreserved: materialized.reduce((total, cohort) => total + cohort.membershipsPreserved, 0),
        hiddenMembershipsPreserved: materialized.reduce((total, cohort) => total + cohort.hiddenMembershipsPreserved, 0),
        staleMembershipsMarked: materialized.reduce((total, cohort) => total + cohort.staleMembershipsMarked, 0),
        staleMembershipsRestored: materialized.reduce((total, cohort) => total + cohort.staleMembershipsRestored, 0),
      },
      cohorts: materialized,
      privacy: {
        minimumSizeEnforced: true,
        consentGated: true,
        aggregateCountsOnly: true,
        otherListenerIdentities: "redacted",
      },
    };
  }

  private async loadEligibleUsers() {
    const visibilityRows = await prisma.communityVisibilitySettings.findMany({
      where: {
        OR: [
          { allowTasteMatching: true },
          { allowCityScenes: true },
        ],
      },
      select: {
        userId: true,
        allowTasteMatching: true,
        allowCityScenes: true,
      },
    });

    return new Map<string, EligibleUser>(
      visibilityRows.map((row) => [row.userId, row]),
    );
  }

  private async buildCandidates(eligibleUsers: Map<string, EligibleUser>) {
    const candidates = new Map<string, CohortCandidate>();
    await this.addLibraryGenreCandidates(candidates, eligibleUsers);
    await this.addAgentSignalCandidates(candidates, eligibleUsers);
    await this.addLibraryArtistAffinityCandidates(candidates, eligibleUsers);
    await this.addCampaignCandidates(candidates, eligibleUsers);
    await this.addCitySceneCandidates(candidates, eligibleUsers);
    await this.addCollectorCandidates(candidates, eligibleUsers);
    return [...candidates.values()].filter((candidate) => candidate.userIds.size > 0);
  }

  private async addLibraryGenreCandidates(candidates: Map<string, CohortCandidate>, eligibleUsers: Map<string, EligibleUser>) {
    const rows = await prisma.libraryTrack.findMany({
      where: {
        userId: { in: socialUserIds(eligibleUsers) },
        genre: { not: null },
      },
      select: { userId: true, genre: true },
    });

    for (const row of rows) {
      for (const genre of splitSignalValues(row.genre)) {
        const genreSignal = safeSignalToken(genre, "shared_taste");
        const genreLabel = safeDisplayLabel(genre, "Shared taste");
        addUser(candidates, {
          cohortType: "taste",
          signal: genreSignal,
          title: `${genreLabel} listeners`,
          safeExplanation: tasteSafeExplanation(genreLabel),
          userId: row.userId,
          sourceType: "library_genre",
        });
      }
    }
  }

  private async addAgentSignalCandidates(candidates: Map<string, CohortCandidate>, eligibleUsers: Map<string, EligibleUser>) {
    const rows = await prisma.agentSignal.findMany({
      where: { userId: { in: socialUserIds(eligibleUsers) } },
      select: {
        userId: true,
        track: {
          select: {
            release: {
              select: {
                genre: true,
                artistId: true,
                artist: { select: { displayName: true } },
              },
            },
          },
        },
      },
    });

    for (const row of rows) {
      for (const genre of splitSignalValues(row.track.release.genre)) {
        const genreSignal = safeSignalToken(genre, "shared_taste");
        const genreLabel = safeDisplayLabel(genre, "Shared taste");
        addUser(candidates, {
          cohortType: "taste",
          signal: genreSignal,
          title: `${genreLabel} listeners`,
          safeExplanation: tasteSafeExplanation(genreLabel),
          userId: row.userId,
          sourceType: "agent_signal_genre",
        });
      }
      addUser(candidates, {
        cohortType: "artist_affinity",
        signal: row.track.release.artistId,
        title: `${safeDisplayLabel(row.track.release.artist.displayName, "Shared artist")} listeners`,
        safeExplanation: "A privacy-safe group for listeners with shared artist affinity.",
        userId: row.userId,
        sourceType: "agent_signal_artist",
      });
    }
  }

  private async addLibraryArtistAffinityCandidates(candidates: Map<string, CohortCandidate>, eligibleUsers: Map<string, EligibleUser>) {
    const rows = await prisma.libraryTrack.findMany({
      where: {
        userId: { in: socialUserIds(eligibleUsers) },
        catalogTrackId: { not: null },
      },
      select: { userId: true, catalogTrackId: true },
    });
    const trackIds = [...new Set(rows.map((row) => row.catalogTrackId).filter((trackId): trackId is string => Boolean(trackId)))];
    if (trackIds.length === 0) return;

    const tracks = await prisma.track.findMany({
      where: { id: { in: trackIds } },
      select: {
        id: true,
        release: {
          select: {
            artistId: true,
            artist: { select: { displayName: true } },
          },
        },
      },
    });
    const tracksById = new Map(tracks.map((track) => [track.id, track]));

    for (const row of rows) {
      const track = row.catalogTrackId ? tracksById.get(row.catalogTrackId) : null;
      if (!track) continue;
      addUser(candidates, {
        cohortType: "artist_affinity",
        signal: track.release.artistId,
        title: `${safeDisplayLabel(track.release.artist.displayName, "Shared artist")} listeners`,
        safeExplanation: "A privacy-safe group for listeners with shared artist affinity.",
        userId: row.userId,
        sourceType: "library_artist",
      });
    }
  }

  private async addCampaignCandidates(candidates: Map<string, CohortCandidate>, eligibleUsers: Map<string, EligibleUser>) {
    const rows = await prisma.showPledge.findMany({
      where: {
        userId: { in: socialUserIds(eligibleUsers) },
        status: { in: [...ACTIVE_CAMPAIGN_SUPPORT_PLEDGE_STATUSES] },
        confirmationStatus: "confirmed",
        campaign: { status: { in: [...ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES] } },
      },
      select: {
        userId: true,
        campaign: { select: { id: true, title: true } },
      },
    });

    for (const row of rows) {
      if (!row.userId) continue;
      addUser(candidates, {
        cohortType: "campaign",
        signal: row.campaign.id,
        title: `${safeDisplayLabel(row.campaign.title, "Shows campaign")} supporters`,
        safeExplanation: "A privacy-safe group for listeners supporting the same Shows campaign.",
        userId: row.userId,
        sourceType: "show_campaign_support",
      });
    }
  }

  private async addCitySceneCandidates(candidates: Map<string, CohortCandidate>, eligibleUsers: Map<string, EligibleUser>) {
    const rows = await prisma.showPledge.findMany({
      where: {
        userId: { in: citySceneUserIds(eligibleUsers) },
        status: { in: [...ACTIVE_CAMPAIGN_SUPPORT_PLEDGE_STATUSES] },
        confirmationStatus: "confirmed",
        campaign: { status: { in: [...ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES] } },
      },
      select: {
        userId: true,
        campaign: { select: { city: true, country: true } },
      },
    });

    for (const row of rows) {
      if (!row.userId) continue;
      const location = compactLabel([row.campaign.city, row.campaign.country]);
      if (!location) continue;
      const locationSignal = safeSignalToken(location, "local_scene");
      const cityLabel = safeDisplayLabel(row.campaign.city, "Local scene");
      addUser(candidates, {
        cohortType: "city_scene",
        signal: locationSignal,
        title: `${cityLabel} scene listeners`,
        safeExplanation: "A privacy-safe group for listeners around the same coarse show city or scene.",
        userId: row.userId,
        sourceType: "show_city_scene",
      });
    }
  }

  private async addCollectorCandidates(candidates: Map<string, CohortCandidate>, eligibleUsers: Map<string, EligibleUser>) {
    const wallets = await prisma.wallet.findMany({
      where: { userId: { in: socialUserIds(eligibleUsers) } },
      select: { userId: true, address: true },
    });
    const usersByWallet = new Map(wallets.map((wallet) => [wallet.address.toLowerCase(), wallet.userId]));
    if (usersByWallet.size === 0) return;

    const walletAddresses = wallets.flatMap((wallet) => [wallet.address, wallet.address.toLowerCase()]);
    const rows = await prisma.stemPurchase.findMany({
      where: { buyerAddress: { in: [...new Set(walletAddresses)] } },
      select: {
        buyerAddress: true,
        listing: {
          select: {
            stem: {
              select: {
                track: {
                  select: {
                    release: {
                      select: {
                        artistId: true,
                        artist: { select: { displayName: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    for (const row of rows) {
      const userId = usersByWallet.get(row.buyerAddress.toLowerCase());
      const release = row.listing.stem?.track.release;
      if (!userId || !release) continue;
      addUser(candidates, {
        cohortType: "collector",
        signal: release.artistId,
        title: `${safeDisplayLabel(release.artist.displayName, "Shared artist")} collectors`,
        safeExplanation: "A privacy-safe group for listeners collecting stems from a shared artist community.",
        userId,
        sourceType: "stem_purchase_artist",
      });
    }
  }

  private async materializeCandidate(candidate: CohortCandidate, minimumSize: number, generatedAt: Date): Promise<MaterializedCohort> {
    const cohortId = cohortIdFor(candidate.reasonCode);
    await prisma.communityCohort.upsert({
      where: { id: cohortId },
      create: {
        id: cohortId,
        cohortType: candidate.cohortType,
        reasonCode: candidate.reasonCode,
        title: candidate.title,
        safeExplanation: candidate.safeExplanation,
        minimumSize,
        visibleMemberCount: 0,
        status: "suggested",
        metadata: safeMetadata(candidate, generatedAt),
      },
      update: {
        cohortType: candidate.cohortType,
        reasonCode: candidate.reasonCode,
        title: candidate.title,
        safeExplanation: candidate.safeExplanation,
        minimumSize,
        status: "suggested",
        metadata: safeMetadata(candidate, generatedAt),
      },
    });

    let membershipsCreated = 0;
    let membershipsPreserved = 0;
    let hiddenMembershipsPreserved = 0;
    let staleMembershipsMarked = 0;
    let staleMembershipsRestored = 0;
    const currentUserIds = new Set(candidate.userIds);
    const existingMemberships = await prisma.communityCohortMembership.findMany({
      where: { cohortId },
      select: { id: true, userId: true, status: true },
    });
    const existingMembershipsByUserId = new Map(existingMemberships.map((membership) => [membership.userId, membership]));

    for (const userId of [...currentUserIds].sort()) {
      const existing = existingMembershipsByUserId.get(userId);
      if (existing) {
        if (existing.status === STALE_MEMBERSHIP_STATUS) {
          await prisma.communityCohortMembership.update({
            where: { id: existing.id },
            data: {
              status: "suggested",
              suggestedAt: generatedAt,
              suggestedEventAt: null,
            },
          });
          staleMembershipsRestored += 1;
          continue;
        }
        membershipsPreserved += 1;
        if (existing.status === "hidden") hiddenMembershipsPreserved += 1;
        continue;
      }
      await prisma.communityCohortMembership.create({
        data: {
          cohortId,
          userId,
          status: "suggested",
          suggestedAt: generatedAt,
        },
      });
      membershipsCreated += 1;
    }

    const staleVisibleMembershipIds = existingMemberships
      .filter((membership) => !currentUserIds.has(membership.userId))
      .filter((membership) => VISIBLE_MEMBERSHIP_STATUSES.includes(membership.status as (typeof VISIBLE_MEMBERSHIP_STATUSES)[number]))
      .map((membership) => membership.id);
    if (staleVisibleMembershipIds.length > 0) {
      const marked = await prisma.communityCohortMembership.updateMany({
        where: { id: { in: staleVisibleMembershipIds } },
        data: { status: STALE_MEMBERSHIP_STATUS },
      });
      staleMembershipsMarked = marked.count;
    }

    const visibleMemberCount = await prisma.communityCohortMembership.count({
      where: {
        cohortId,
        status: { in: [...VISIBLE_MEMBERSHIP_STATUSES] },
      },
    });
    await prisma.communityCohort.update({
      where: { id: cohortId },
      data: { visibleMemberCount },
    });

    return {
      cohortId,
      cohortType: candidate.cohortType,
      reasonCode: candidate.reasonCode,
      visibleMemberCount,
      minimumSize,
      membershipsCreated,
      membershipsPreserved,
      hiddenMembershipsPreserved,
      staleMembershipsMarked,
      staleMembershipsRestored,
    };
  }
}

function socialUserIds(eligibleUsers: Map<string, EligibleUser>) {
  return [...eligibleUsers.values()]
    .filter((user) => user.allowTasteMatching)
    .map((user) => user.userId);
}

function citySceneUserIds(eligibleUsers: Map<string, EligibleUser>) {
  return [...eligibleUsers.values()]
    .filter((user) => user.allowCityScenes)
    .map((user) => user.userId);
}

function addUser(candidates: Map<string, CohortCandidate>, input: {
  cohortType: CohortCandidate["cohortType"];
  signal: string;
  title: string;
  safeExplanation: string;
  userId: string;
  sourceType: string;
}) {
  const normalizedSignal = normalizeSignal(input.signal);
  if (!normalizedSignal) return;
  const reasonCode = `${input.cohortType}:${slug(normalizedSignal)}`;
  const key = `${input.cohortType}:${reasonCode}`;
  const candidate = candidates.get(key) ?? {
    cohortType: input.cohortType,
    reasonCode,
    title: input.title,
    safeExplanation: input.safeExplanation,
    userIds: new Set<string>(),
    sourceTypes: new Set<string>(),
  };
  candidate.userIds.add(input.userId);
  candidate.sourceTypes.add(input.sourceType);
  candidates.set(key, candidate);
}

function splitSignalValues(value?: string | null) {
  return (value ?? "")
    .split(/[;,/]/)
    .map((part) => normalizeSignal(part))
    .filter((part): part is string => Boolean(part));
}

function normalizeSignal(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function safeSignalToken(value: string | null | undefined, fallback: string) {
  const normalized = normalizeSignal(value ?? "");
  if (!normalized || UNSAFE_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return fallback;
  }
  return normalized;
}

function safeDisplayLabel(value: string | null | undefined, fallback: string) {
  return titleCase(safeSignalToken(value, fallback));
}

function tasteSafeExplanation(label: string) {
  const signalDescription = label.toLowerCase() === "shared taste" ? "shared taste" : `shared ${label}`;
  return `A privacy-safe group for listeners with a ${signalDescription} listening signal.`;
}

function slug(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.slice(0, 48) || "community";
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}` : "")
    .join(" ");
}

function compactLabel(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

function cohortIdFor(reasonCode: string) {
  return `cohort_${createHash("sha256").update(reasonCode).digest("hex").slice(0, 24)}`;
}

function safeMetadata(candidate: CohortCandidate, generatedAt: Date) {
  return {
    schemaVersion: "community-cohort-generation/v1",
    generatedAt: generatedAt.toISOString(),
    sourceTypes: [...candidate.sourceTypes].sort(),
    signalKey: candidate.reasonCode,
  };
}

function normalizeMinimumSize(value?: number) {
  if (!Number.isFinite(value) || !value) return DEFAULT_MINIMUM_SIZE;
  return Math.max(2, Math.min(100, Math.floor(value)));
}

function normalizeRunDate(value?: Date | string) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}
