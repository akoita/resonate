import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { pseudonymousAnalyticsActorId } from "../analytics/analytics_identity";

/**
 * Preview measures (#2670): what the operator needs to read whether artists
 * publish, whether listeners come back and which features are used, from the
 * application database only (no warehouse).
 *
 * Small groups: any count from 1 to 4 is returned as `null` and shown as
 * "fewer than five"; a share is given only when its base is at least five.
 * Figures built on product-analytics events count consenting accounts only.
 */

export const MIN_GROUP = 5;
export const MAX_PERIOD_DAYS = 92;
export const DEFAULT_PERIOD_DAYS = 28;
export const ARTIST_PUBLISH_WINDOW_DAYS = 14;
export const RETENTION_WEEKS = 4;
const MAX_COHORT = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** A count under the small-group rule: `null` means 1 to 4. */
export type GuardedCount = number | null;

export function guard(count: number): GuardedCount {
  return count > 0 && count < MIN_GROUP ? null : count;
}

/** A share in percent, one decimal, or null when the base is under five or a part is hidden. */
export function guardedShare(part: number, base: number): number | null {
  if (base < MIN_GROUP || (part > 0 && part < MIN_GROUP)) return null;
  return Math.round((part / base) * 1000) / 10;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface MeasurePeriod {
  from: Date;
  to: Date;
}

export function resolvePeriod(fromInput?: string, toInput?: string, now = new Date()): MeasurePeriod {
  const to = toInput ? new Date(toInput) : now;
  const from = fromInput ? new Date(fromInput) : new Date(to.getTime() - DEFAULT_PERIOD_DAYS * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadRequestException("Use dates like 2026-12-01.");
  }
  if (from >= to) throw new BadRequestException("The start date must be before the end date.");
  if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
    throw new BadRequestException(`Choose a period of at most ${MAX_PERIOD_DAYS} days.`);
  }
  return { from, to };
}

/** Seven-day buckets from the start of the period; the last may be shorter. */
export function weekBuckets(period: MeasurePeriod): Array<{ start: Date; end: Date }> {
  const buckets: Array<{ start: Date; end: Date }> = [];
  for (let start = period.from.getTime(); start < period.to.getTime(); start += WEEK_MS) {
    buckets.push({ start: new Date(start), end: new Date(Math.min(start + WEEK_MS, period.to.getTime())) });
  }
  return buckets;
}

/**
 * Feature usage: distinct accounts per week, read from the feature's own
 * table. Table and column names are fixed here, never taken from input.
 */
const FEATURES = [
  { key: "aiDj", label: "AI DJ sessions started", table: "Session", user: "userId", at: "startedAt", where: "" },
  { key: "remix", label: "Remix Studio projects created", table: "RemixProject", user: "creatorUserId", at: "createdAt", where: "" },
  { key: "crates", label: "Crates created", table: "Crate", user: "userId", at: "createdAt", where: "" },
  { key: "drops", label: "Drops collected", table: "PunchlineCollectible", user: "collectorUserId", at: "createdAt", where: "" },
  { key: "showsInterest", label: "Shows \"I would come\"", table: "ShowInterest", user: "userId", at: "createdAt", where: "" },
  { key: "localLibrary", label: "Local files added to the library", table: "LibraryTrack", user: "userId", at: "createdAt", where: `AND "source" = 'local'` },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"] | "stemPreviews";

@Injectable()
export class PreviewMeasuresService {
  async measures(fromInput?: string, toInput?: string, now = new Date()) {
    const period = resolvePeriod(fromInput, toInput, now);
    const [artists, listeners, features, support, safety] = await Promise.all([
      this.artistActivation(period, now),
      this.listenerRetention(period, now),
      this.featureUse(period),
      this.supportFigures(period),
      this.safetyFigures(period),
    ]);
    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      generatedAt: now.toISOString(),
      minimumGroup: MIN_GROUP,
      artists,
      listeners,
      features,
      support,
      safety,
    };
  }

  /** Founding artists who joined with an artist invitation, and who published within 14 days. */
  async artistActivation(period: MeasurePeriod, now: Date) {
    const redemptions = await prisma.invitationRedemption.findMany({
      where: { role: "artist", redeemedAt: { gte: period.from, lt: period.to } },
      select: { userId: true, redeemedAt: true },
      take: MAX_COHORT,
    });
    const artists = redemptions.length
      ? await prisma.artist.findMany({
          where: { userId: { in: redemptions.map((r) => r.userId) } },
          select: {
            userId: true,
            releases: {
              where: { status: { in: ["ready", "published"] } },
              select: { createdAt: true },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
          },
        })
      : [];
    const firstRelease = new Map(artists.map((artist) => [artist.userId, artist.releases[0]?.createdAt ?? null]));

    let published = 0;
    let pending = 0;
    for (const redemption of redemptions) {
      const deadline = redemption.redeemedAt.getTime() + ARTIST_PUBLISH_WINDOW_DAYS * DAY_MS;
      const first = firstRelease.get(redemption.userId);
      if (first && first.getTime() <= deadline) published += 1;
      else if (deadline > now.getTime()) pending += 1;
    }
    const decided = redemptions.length - pending;
    return {
      invited: guard(redemptions.length),
      publishedWithin14Days: guard(published),
      stillWithin14Days: guard(pending),
      share: guardedShare(published, decided),
    };
  }

  /**
   * Listeners who joined in the period (accounts without an artist profile),
   * and the share active in each of their first four weeks. Activity is any
   * product-analytics event, so only accounts that allowed product analytics
   * are counted.
   */
  async listenerRetention(period: MeasurePeriod, now: Date) {
    const where: Prisma.UserWhereInput = {
      createdAt: { gte: period.from, lt: period.to },
      closedAt: null,
      erasedAt: null,
      artist: { is: null },
    };
    const [joined, consenting] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where: { ...where, analyticsConsent: { is: { productAnalytics: true } } },
        select: { id: true, createdAt: true },
        take: MAX_COHORT,
      }),
    ]);

    // The analytics pseudonym needs its salt; without one, the weekly figures are left out.
    let analyticsAvailable = true;
    let actors: Array<{ actor: string; joined: Date }> = [];
    try {
      actors = consenting
        .map((user) => ({ actor: pseudonymousAnalyticsActorId(user.id), joined: user.createdAt }))
        .filter((row): row is { actor: string; joined: Date } => Boolean(row.actor));
    } catch {
      analyticsAvailable = false;
    }

    const activeWeeks = new Map<string, Set<number>>();
    if (actors.length) {
      const rows = await prisma.$queryRaw<Array<{ actor: string; week: number }>>`
        SELECT c.actor, FLOOR(EXTRACT(EPOCH FROM (e."occurredAt" - c.joined)) / 604800)::int AS week
        FROM unnest(${actors.map((a) => a.actor)}::text[], ${actors.map((a) => a.joined.toISOString())}::timestamp[]) AS c(actor, joined)
        JOIN "AnalyticsEvent" e
          ON e."actorId" = c.actor
         AND e."occurredAt" >= c.joined
         AND e."occurredAt" < c.joined + interval '28 days'
        GROUP BY 1, 2
      `;
      for (const row of rows) {
        const weeks = activeWeeks.get(row.actor) ?? new Set<number>();
        weeks.add(row.week);
        activeWeeks.set(row.actor, weeks);
      }
    }

    const weeks = Array.from({ length: RETENTION_WEEKS }, (_, index) => {
      // A week counts once it has fully passed for that listener.
      const eligible = actors.filter((a) => a.joined.getTime() + (index + 1) * WEEK_MS <= now.getTime());
      const active = eligible.filter((a) => activeWeeks.get(a.actor)?.has(index)).length;
      return {
        week: index + 1,
        eligible: guard(eligible.length),
        active: guard(active),
        share: guardedShare(active, eligible.length),
      };
    });

    return {
      joined: guard(joined),
      consenting: analyticsAvailable ? guard(actors.length) : null,
      analyticsAvailable,
      weeks,
    };
  }

  async featureUse(period: MeasurePeriod) {
    const buckets = weekBuckets(period);
    const rows = await Promise.all(
      FEATURES.map(async (feature) => {
        const counts = await prisma.$queryRaw<Array<{ bucket: number; users: number }>>(Prisma.sql`
          SELECT FLOOR(EXTRACT(EPOCH FROM (${Prisma.raw(`"${feature.at}"`)} - ${period.from}::timestamp)) / 604800)::int AS bucket,
                 COUNT(DISTINCT ${Prisma.raw(`"${feature.user}"`)})::int AS users
          FROM ${Prisma.raw(`"${feature.table}"`)}
          WHERE ${Prisma.raw(`"${feature.at}"`)} >= ${period.from} AND ${Prisma.raw(`"${feature.at}"`)} < ${period.to}
          ${Prisma.raw(feature.where)}
          GROUP BY 1
        `);
        const byBucket = new Map(counts.map((row) => [row.bucket, row.users]));
        return {
          key: feature.key as FeatureKey,
          label: feature.label as string,
          recorded: true,
          weekly: buckets.map((_, index) => guard(byBucket.get(index) ?? 0)),
        };
      }),
    );
    rows.splice(3, 0, {
      key: "stemPreviews",
      label: "Stem previews",
      recorded: false,
      weekly: buckets.map(() => 0),
    });
    return {
      weeks: buckets.map((bucket) => ({ start: bucket.start.toISOString(), end: bucket.end.toISOString() })),
      rows,
    };
  }

  /**
   * Support requests opened in the period, and the median time to an answer.
   * The time is to the request's last status change (answered or closed),
   * which is the first answer for a request handled once.
   */
  async supportFigures(period: MeasurePeriod) {
    const requests = await prisma.supportRequest.findMany({
      where: { createdAt: { gte: period.from, lt: period.to } },
      select: { createdAt: true, status: true, statusChangedAt: true },
    });
    const answered = requests.filter(
      (request) => request.status !== "new" && request.statusChangedAt && request.statusChangedAt >= request.createdAt,
    );
    const hours = answered.map(
      (request) => ((request.statusChangedAt as Date).getTime() - request.createdAt.getTime()) / (60 * 60 * 1000),
    );
    const mid = median(hours);
    return {
      opened: guard(requests.length),
      answered: guard(answered.length),
      medianHoursToAnswer: answered.length >= MIN_GROUP && mid !== null ? Math.round(mid * 10) / 10 : null,
    };
  }

  async safetyFigures(period: MeasurePeriod) {
    const window = { gte: period.from, lt: period.to };
    const [refused, takedowns, roomReports] = await Promise.all([
      prisma.uploadLimitRefusal.count({ where: { createdAt: window } }),
      prisma.dmcaReport.count({ where: { createdAt: window } }),
      prisma.communityModerationReport.count({ where: { createdAt: window } }),
    ]);
    return {
      uploadsRefusedByLimit: guard(refused),
      takedownReports: guard(takedowns),
      communityReports: guard(roomReports),
    };
  }
}
