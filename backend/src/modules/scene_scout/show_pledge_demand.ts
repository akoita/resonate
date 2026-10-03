import { Prisma } from "@prisma/client";
import { normalizeAnalyticsGeoDimension } from "../analytics/analytics_event";

export const SHOW_PLEDGE_DEMAND_RETENTION_DAYS = 28;
export const SHOW_PLEDGE_DEMAND_RETENTION_MS = SHOW_PLEDGE_DEMAND_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const SHOW_PLEDGE_DEMAND_CLEANUP_BATCH_LIMIT = 1_000;

export type ShowPledgeDemandGeo = {
  countryCode: string;
  citySlug: string;
};

/**
 * Keep only validated coarse city fields when the caller's original geo
 * envelope already identifies an explicit city declaration. Preserve the
 * canonical normalizer's source and precision checks instead of relabeling
 * campaign targets or inferred locations as user declarations.
 */
export function normalizeShowPledgeDemandGeo(input: unknown): ShowPledgeDemandGeo | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const geo = normalizeAnalyticsGeoDimension(input);
  if (
    !geo ||
    geo.source !== "user_declared" ||
    geo.precision !== "city" ||
    !geo.citySlug
  ) return null;
  return { countryCode: geo.countryCode, citySlug: geo.citySlug };
}

export function showPledgeDemandContextFields(input: {
  userId: string;
  policyVersion: string;
  geo: ShowPledgeDemandGeo;
  now: Date;
}) {
  return {
    userId: input.userId,
    countryCode: input.geo.countryCode,
    citySlug: input.geo.citySlug,
    consentPolicyVersion: input.policyVersion,
    declaredAt: input.now,
    expiresAt: new Date(input.now.getTime() + SHOW_PLEDGE_DEMAND_RETENTION_MS),
  };
}

type ExpiredContextReader = Pick<Prisma.TransactionClient, "showPledgeDemandContext">;

/** Delete one oldest-first bounded batch; callers may invoke this on reads. */
export async function deleteExpiredShowPledgeDemandContexts(
  client: ExpiredContextReader,
  now: Date,
): Promise<number> {
  const expired = await client.showPledgeDemandContext.findMany({
    where: { expiresAt: { lte: now } },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: SHOW_PLEDGE_DEMAND_CLEANUP_BATCH_LIMIT,
    select: { id: true },
  });
  if (expired.length === 0) return 0;
  const deleted = await client.showPledgeDemandContext.deleteMany({
    where: { id: { in: expired.map((row) => row.id) } },
  });
  return deleted.count;
}
