import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";

const SCHEMA_VERSION = "community-cohort-quality/v1";
const GENERATED_COHORT_SCHEMA_VERSION = "community-cohort-generation/v1";
const SOCIAL_TASTE_COHORT_TYPES = ["taste", "artist_affinity", "collector", "campaign"] as const;
const ACTION_EVENT_NAMES = [
  "community.cohort_suggested",
  "community.cohort_joined",
  "community.cohort_left",
  "community.cohort_hidden",
] as const;
const VISIBLE_COHORT_STATUSES = ["suggested", "active"] as const;
const VISIBLE_MEMBERSHIP_STATUSES = ["suggested", "joined"] as const;
const STALE_MEMBERSHIP_STATUSES = ["stale", "stale_joined"] as const;
const DEFAULT_REASON_CODE_LIMIT = 12;

type CountRow = { key: string; count: number };

@Injectable()
export class CommunityCohortQualityService {
  async getQualityReport() {
    const generatedAt = new Date();
    const now = generatedAt;

    const [
      cohortStatusGroups,
      cohortTypeGroups,
      membershipStatusGroups,
      actionEventGroups,
      cohorts,
      visibleMemberships,
    ] = await Promise.all([
      prisma.communityCohort.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.communityCohort.groupBy({
        by: ["cohortType"],
        _count: { _all: true },
      }),
      prisma.communityCohortMembership.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.analyticsEvent.groupBy({
        by: ["eventName"],
        where: { eventName: { in: [...ACTION_EVENT_NAMES] } },
        _count: { _all: true },
      }),
      prisma.communityCohort.findMany({
        select: {
          cohortType: true,
          reasonCode: true,
          status: true,
          minimumSize: true,
          visibleMemberCount: true,
          expiresAt: true,
          metadata: true,
          updatedAt: true,
        },
      }),
      prisma.communityCohortMembership.findMany({
        where: {
          status: { in: [...VISIBLE_MEMBERSHIP_STATUSES] },
          cohort: {
            status: { in: [...VISIBLE_COHORT_STATUSES] },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
        select: {
          cohort: {
            select: {
              cohortType: true,
              minimumSize: true,
              visibleMemberCount: true,
            },
          },
          user: {
            select: {
              communityVisibilitySettings: {
                select: {
                  allowTasteMatching: true,
                  allowCityScenes: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const cohortStatusCounts = countRows(cohortStatusGroups, "status");
    const cohortTypeCounts = countRows(cohortTypeGroups, "cohortType");
    const membershipStatusCounts = countRows(membershipStatusGroups, "status");
    const actionCounts = actionCountRows(actionEventGroups);
    const disabledConsent = disabledConsentSummary(visibleMemberships);
    const allReasonCodeSummaries = reasonSummaries(cohorts);
    const reasonCodeSummaries = allReasonCodeSummaries.slice(0, DEFAULT_REASON_CODE_LIMIT);
    const generatedCohorts = cohorts.filter((cohort) => isGeneratedCohortMetadata(cohort.metadata));
    const belowThresholdCount = cohorts.filter((cohort) => cohort.visibleMemberCount < cohort.minimumSize).length;
    const visibleNowCount = visibleCohortCount(cohorts, now);

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: generatedAt.toISOString(),
      cohorts: {
        total: cohorts.length,
        visibleNow: visibleNowCount,
        belowThreshold: belowThresholdCount,
        byStatus: cohortStatusCounts,
        byType: cohortTypeCounts,
        generated: {
          total: generatedCohorts.length,
          visibleNow: visibleCohortCount(generatedCohorts, now),
          belowThreshold: generatedCohorts.filter((cohort) => cohort.visibleMemberCount < cohort.minimumSize).length,
          byStatus: countBy(generatedCohorts, "status"),
          byType: countBy(generatedCohorts, "cohortType"),
        },
      },
      memberships: {
        total: Object.values(membershipStatusCounts).reduce((total, count) => total + count, 0),
        stale: STALE_MEMBERSHIP_STATUSES.reduce((total, status) => total + (membershipStatusCounts[status] ?? 0), 0),
        byStatus: membershipStatusCounts,
        disabledConsent,
      },
      actions: {
        total: actionCounts.reduce((total, row) => total + row.count, 0),
        byEvent: actionCounts,
        source: "analytics_event_ledger",
      },
      reasonCodes: {
        limit: DEFAULT_REASON_CODE_LIMIT,
        total: allReasonCodeSummaries.length,
        summaries: reasonCodeSummaries,
      },
      privacy: {
        aggregateOnly: true,
        noListenerIdentifiers: true,
        noWalletAddresses: true,
        noRawListeningHistory: true,
        noFineLocation: true,
        reasonCodesAreBounded: true,
        memberCountsAreBucketed: true,
      },
    };
  }
}

function countRows<T extends string>(groups: Array<Record<T, string> & { _count: { _all: number } }>, key: T) {
  return groups.reduce<Record<string, number>>((counts, group) => {
    counts[group[key]] = group._count._all;
    return counts;
  }, {});
}

function countBy<T extends string>(rows: Array<Record<T, string>>, key: T) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row[key]] = (counts[row[key]] ?? 0) + 1;
    return counts;
  }, {});
}

function visibleCohortCount(cohorts: Array<{
  status: string;
  minimumSize: number;
  visibleMemberCount: number;
  expiresAt: Date | null;
}>, now: Date) {
  return cohorts.filter((cohort) => (
    VISIBLE_COHORT_STATUSES.includes(cohort.status as (typeof VISIBLE_COHORT_STATUSES)[number]) &&
    (!cohort.expiresAt || cohort.expiresAt.getTime() > now.getTime()) &&
    cohort.visibleMemberCount >= cohort.minimumSize
  )).length;
}

function actionCountRows(groups: Array<{ eventName: string; _count: { _all: number } }>): CountRow[] {
  const counts = new Map(groups.map((group) => [group.eventName, group._count._all]));
  return ACTION_EVENT_NAMES.map((eventName) => ({
    key: eventName,
    count: counts.get(eventName) ?? 0,
  }));
}

function disabledConsentSummary(memberships: Array<{
  cohort: { cohortType: string; minimumSize: number; visibleMemberCount: number };
  user: { communityVisibilitySettings: { allowTasteMatching: boolean; allowCityScenes: boolean } | null };
}>) {
  const byType: Record<string, number> = {};
  let total = 0;

  for (const membership of memberships) {
    if (membership.cohort.visibleMemberCount < membership.cohort.minimumSize) continue;
    if (hasConsentForType(membership.cohort.cohortType, membership.user.communityVisibilitySettings)) continue;
    byType[membership.cohort.cohortType] = (byType[membership.cohort.cohortType] ?? 0) + 1;
    total += 1;
  }

  return { total, byType };
}

function hasConsentForType(
  cohortType: string,
  visibility: { allowTasteMatching: boolean; allowCityScenes: boolean } | null,
) {
  if (cohortType === "city_scene") return visibility?.allowCityScenes === true;
  if (SOCIAL_TASTE_COHORT_TYPES.includes(cohortType as (typeof SOCIAL_TASTE_COHORT_TYPES)[number])) {
    return visibility?.allowTasteMatching === true;
  }
  return false;
}

function reasonSummaries(cohorts: Array<{
  cohortType: string;
  reasonCode: string;
  status: string;
  minimumSize: number;
  visibleMemberCount: number;
  metadata: unknown;
  updatedAt: Date;
}>) {
  const summaries = new Map<string, {
    cohortType: string;
    reasonCode: string;
    cohortCount: number;
    activeCount: number;
    archivedCount: number;
    expiredCount: number;
    belowThresholdCount: number;
    maxVisibleMemberCount: number;
    updatedAt: Date;
  }>();

  for (const cohort of cohorts) {
    const key = `${cohort.cohortType}:${cohort.reasonCode}`;
    const summary = summaries.get(key) ?? {
      cohortType: cohort.cohortType,
      reasonCode: safeReasonCode(cohort.reasonCode),
      cohortCount: 0,
      activeCount: 0,
      archivedCount: 0,
      expiredCount: 0,
      belowThresholdCount: 0,
      maxVisibleMemberCount: 0,
      updatedAt: cohort.updatedAt,
    };
    summary.cohortCount += 1;
    if (cohort.status === "active") summary.activeCount += 1;
    if (cohort.status === "archived") summary.archivedCount += 1;
    if (cohort.status === "expired") summary.expiredCount += 1;
    if (cohort.visibleMemberCount < cohort.minimumSize) summary.belowThresholdCount += 1;
    summary.maxVisibleMemberCount = Math.max(summary.maxVisibleMemberCount, cohort.visibleMemberCount);
    if (cohort.updatedAt > summary.updatedAt) summary.updatedAt = cohort.updatedAt;
    summaries.set(key, summary);
  }

  return [...summaries.values()]
    .sort((left, right) => {
      const belowThresholdDelta = right.belowThresholdCount - left.belowThresholdCount;
      if (belowThresholdDelta !== 0) return belowThresholdDelta;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })
    .map(({ maxVisibleMemberCount, updatedAt: _updatedAt, ...summary }) => ({
      ...summary,
      visibleMemberBucket: bucketMemberCount(maxVisibleMemberCount),
    }));
}

function safeReasonCode(reasonCode: string) {
  return /^[a-z0-9_.:-]{1,64}$/i.test(reasonCode) ? reasonCode : "community_match";
}

function isGeneratedCohortMetadata(metadata: unknown) {
  return Boolean(
    metadata &&
    typeof metadata === "object" &&
    "schemaVersion" in metadata &&
    (metadata as { schemaVersion?: unknown }).schemaVersion === GENERATED_COHORT_SCHEMA_VERSION,
  );
}

function bucketMemberCount(count: number) {
  if (count <= 0) return "0";
  if (count < 5) return "1-4";
  if (count < 10) return "5-9";
  if (count < 25) return "10-24";
  return "25+";
}
