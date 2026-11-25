import { ForbiddenException } from "@nestjs/common";
import { prisma } from "../../db/prisma";

/**
 * Upload limits for accounts that are not yet verified (#2659).
 *
 * The Content Protection deposit used to slow abuse by new accounts. Where no
 * deposit is taken, these limits do that job: a number of releases and tracks
 * per day (rolling 24 hours) and in total. Verified artists, and accounts an
 * operator has lifted the limits for, are not limited.
 *
 * Each limit reads its variable; an empty value keeps the default and
 * `unlimited` (or `0`) turns that limit off.
 */
export const UPLOAD_LIMIT_KEYS = ["releasesPerDay", "tracksPerDay", "releasesTotal", "tracksTotal"] as const;
export type UploadLimitKey = (typeof UPLOAD_LIMIT_KEYS)[number];

export const UPLOAD_LIMIT_ENV: Record<UploadLimitKey, string> = {
  releasesPerDay: "UPLOAD_LIMIT_RELEASES_PER_DAY",
  tracksPerDay: "UPLOAD_LIMIT_TRACKS_PER_DAY",
  releasesTotal: "UPLOAD_LIMIT_RELEASES_TOTAL",
  tracksTotal: "UPLOAD_LIMIT_TRACKS_TOTAL",
};

export const DEFAULT_UPLOAD_LIMITS: Record<UploadLimitKey, number> = {
  releasesPerDay: 5,
  tracksPerDay: 50,
  releasesTotal: 50,
  tracksTotal: 500,
};

export const UPLOAD_LIMIT_REACHED_CODE = "upload_limit_reached";

export type UploadLimits = Record<UploadLimitKey, number | null>;

export type UploadAllowance = {
  /** False for verified artists and accounts whose limits were lifted. */
  limited: boolean;
  liftedAt: string | null;
  limits: UploadLimits;
  used: Record<UploadLimitKey, number>;
  /** Remaining per limit; null where the limit is off or the account is not limited. */
  remaining: Record<UploadLimitKey, number | null>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveUploadLimits(env: NodeJS.ProcessEnv = process.env): UploadLimits {
  return Object.fromEntries(
    UPLOAD_LIMIT_KEYS.map((key) => {
      const raw = env[UPLOAD_LIMIT_ENV[key]]?.trim().toLowerCase();
      if (!raw) return [key, DEFAULT_UPLOAD_LIMITS[key]];
      if (raw === "unlimited" || raw === "off" || raw === "0") return [key, null];
      const value = Number(raw);
      return [key, Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_UPLOAD_LIMITS[key]];
    }),
  ) as UploadLimits;
}

export async function getUploadAllowance(
  artistId: string,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<UploadAllowance> {
  const since = new Date(now.getTime() - DAY_MS);
  const [trust, releasesTotal, releasesPerDay, tracksTotal, tracksPerDay] = await Promise.all([
    prisma.creatorTrust.findUnique({
      where: { artistId },
      select: { tier: true, uploadLimitsLiftedAt: true },
    }),
    prisma.release.count({ where: { artistId } }),
    prisma.release.count({ where: { artistId, createdAt: { gte: since } } }),
    prisma.track.count({ where: { release: { artistId } } }),
    prisma.track.count({ where: { release: { artistId }, createdAt: { gte: since } } }),
  ]);
  const limited = trust?.tier !== "verified" && !trust?.uploadLimitsLiftedAt;
  const limits = resolveUploadLimits(env);
  const used = { releasesPerDay, tracksPerDay, releasesTotal, tracksTotal };
  const remaining = Object.fromEntries(
    UPLOAD_LIMIT_KEYS.map((key) => {
      const limit = limits[key];
      return [key, !limited || limit === null ? null : Math.max(0, limit - used[key])];
    }),
  ) as UploadAllowance["remaining"];
  return {
    limited,
    liftedAt: trust?.uploadLimitsLiftedAt?.toISOString() ?? null,
    limits,
    used,
    remaining,
  };
}

const LIMIT_MESSAGES: Record<UploadLimitKey, (max: number) => string> = {
  releasesPerDay: (max) => `New accounts can publish ${max} releases a day. Try again tomorrow, or ask us to lift the limit.`,
  tracksPerDay: (max) => `New accounts can upload ${max} tracks a day. Try again tomorrow, or ask us to lift the limit.`,
  releasesTotal: (max) => `New accounts can publish ${max} releases in total until they are verified. Ask us to lift the limit.`,
  tracksTotal: (max) => `New accounts can upload ${max} tracks in total until they are verified. Ask us to lift the limit.`,
};

/** The typed refusal (HTTP 403) when an upload would go over a limit. */
export class UploadLimitReachedException extends ForbiddenException {
  constructor(readonly limit: UploadLimitKey, max: number, used: number) {
    super({
      statusCode: 403,
      error: "Forbidden",
      code: UPLOAD_LIMIT_REACHED_CODE,
      limit,
      max,
      used,
      message: LIMIT_MESSAGES[limit](max),
    });
  }
}

/**
 * Refuses an upload of one release with `trackCount` tracks when it would go
 * over a limit. Call before any file is stored.
 */
export async function assertWithinUploadLimits(
  artistId: string,
  trackCount: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const allowance = await getUploadAllowance(artistId, env);
  if (!allowance.limited) return;
  const adding: Record<UploadLimitKey, number> = {
    releasesPerDay: 1,
    releasesTotal: 1,
    tracksPerDay: Math.max(1, trackCount),
    tracksTotal: Math.max(1, trackCount),
  };
  for (const key of UPLOAD_LIMIT_KEYS) {
    const limit = allowance.limits[key];
    if (limit !== null && allowance.used[key] + adding[key] > limit) {
      // #2670: counted for the preview measures; a failed write never changes the answer.
      await prisma.uploadLimitRefusal.create({ data: { artistId, limitKey: key } }).catch(() => undefined);
      throw new UploadLimitReachedException(key, limit, allowance.used[key]);
    }
  }
}

/** Lift or restore the limits for one artist (operator action, audited by the route). */
export async function setUploadLimitsLifted(
  artistId: string,
  lifted: boolean,
  operatorUserId: string,
): Promise<{ artistId: string; liftedAt: string | null }> {
  const artist = await prisma.artist.findUnique({ where: { id: artistId }, select: { id: true } });
  if (!artist) return { artistId, liftedAt: null };
  const data = lifted
    ? { uploadLimitsLiftedAt: new Date(), uploadLimitsLiftedBy: operatorUserId }
    : { uploadLimitsLiftedAt: null, uploadLimitsLiftedBy: null };
  const row = await prisma.creatorTrust.upsert({
    where: { artistId },
    create: { artistId, ...data },
    update: data,
    select: { uploadLimitsLiftedAt: true },
  });
  return { artistId, liftedAt: row.uploadLimitsLiftedAt?.toISOString() ?? null };
}
