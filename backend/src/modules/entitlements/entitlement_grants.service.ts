/**
 * Operator and promo grants of the `pro` plan (#2406, `docs/rfc/artist-pro.md`
 * §4). Used for founders, partners and support. Admins create and revoke them
 * (`AdminEntitlementGrantsController`, step-up and audit); the entitlement
 * service reads the active one to resolve a person's plan.
 *
 * Revoking never deletes: the row keeps who granted it, when, and who revoked
 * it. The `reason` is the admin's internal note about the person: personal
 * data. Admins see it here and the person gets it in their data export; it is
 * never written into the admin audit log, and it is scrubbed when the person's
 * account is erased.
 */

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { EntitlementGrant } from "@prisma/client";
import { prisma } from "../../db/prisma";
import type {
  EntitlementGrantPlan,
  EntitlementGrantSource,
  PlanResolution,
} from "./entitlements.policy";
import { FREE_PLAN } from "./entitlements.policy";

export const ENTITLEMENT_GRANT_ERROR_CODES = {
  userNotFound: "user_not_found",
  invalidValidity: "invalid_validity",
  grantNotFound: "grant_not_found",
  alreadyRevoked: "already_revoked",
} as const;

export type EntitlementGrantStatus = "active" | "scheduled" | "expired" | "revoked";

/** What an admin sees for one grant. */
export type EntitlementGrantDto = {
  id: string;
  userId: string;
  plan: EntitlementGrantPlan;
  source: EntitlementGrantSource;
  validFrom: string;
  validUntil: string | null;
  reason: string | null;
  createdByUserId: string;
  createdAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
  status: EntitlementGrantStatus;
};

export type CreateEntitlementGrantInput = {
  userId: string;
  plan?: EntitlementGrantPlan;
  source?: EntitlementGrantSource;
  /** ISO timestamp; defaults to now. */
  validFrom?: string;
  /** ISO timestamp, or absent for an open-ended grant. */
  validUntil?: string | null;
  reason: string;
};

/** How many grants the admin list returns for one person, newest first. */
export const ENTITLEMENT_GRANT_LIST_LIMIT = 50;

export function grantStatus(
  grant: Pick<EntitlementGrant, "validFrom" | "validUntil" | "revokedAt">,
  now: Date,
): EntitlementGrantStatus {
  if (grant.revokedAt) return "revoked";
  if (grant.validFrom.getTime() > now.getTime()) return "scheduled";
  if (grant.validUntil && grant.validUntil.getTime() <= now.getTime()) return "expired";
  return "active";
}

export function toEntitlementGrantDto(grant: EntitlementGrant, now: Date = new Date()): EntitlementGrantDto {
  return {
    id: grant.id,
    userId: grant.userId,
    plan: grant.plan,
    source: grant.source,
    validFrom: grant.validFrom.toISOString(),
    validUntil: grant.validUntil ? grant.validUntil.toISOString() : null,
    reason: grant.reason,
    createdByUserId: grant.createdByUserId,
    createdAt: grant.createdAt.toISOString(),
    revokedAt: grant.revokedAt ? grant.revokedAt.toISOString() : null,
    revokedByUserId: grant.revokedByUserId,
    status: grantStatus(grant, now),
  };
}

/**
 * The plan the active grants give, or `free`. With several active grants an
 * open-ended one wins, then the one that ends last, so the `validUntil` the
 * client shows is the real end of Pro.
 */
export function planFromGrants(
  grants: ReadonlyArray<Pick<EntitlementGrant, "source" | "validFrom" | "validUntil" | "revokedAt">>,
  now: Date,
): PlanResolution {
  const active = grants.filter((grant) => grantStatus(grant, now) === "active");
  if (active.length === 0) return FREE_PLAN;
  const best = active.reduce((winner, grant) => {
    if (!winner.validUntil) return winner;
    if (!grant.validUntil) return grant;
    return grant.validUntil.getTime() > winner.validUntil.getTime() ? grant : winner;
  });
  return {
    plan: "pro",
    source: best.source,
    ...(best.validUntil ? { validUntil: best.validUntil.toISOString() } : {}),
  };
}

function parseInstant(value: string | null | undefined, field: string): Date | null {
  if (value === undefined || value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException({
      code: ENTITLEMENT_GRANT_ERROR_CODES.invalidValidity,
      message: `${field} must be an ISO 8601 date`,
    });
  }
  return parsed;
}

@Injectable()
export class EntitlementGrantsService {
  /**
   * The plan `userId`'s grants give at `now`. One indexed read on
   * `(userId, revokedAt)`; an unknown or empty user id is `free` without one.
   */
  async resolvePlan(userId: string, now: Date = new Date()): Promise<PlanResolution> {
    if (!userId) return FREE_PLAN;
    const grants = await prisma.entitlementGrant.findMany({
      where: {
        userId,
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      select: { source: true, validFrom: true, validUntil: true, revokedAt: true },
      take: ENTITLEMENT_GRANT_LIST_LIMIT,
    });
    return planFromGrants(grants, now);
  }

  async create(
    actorUserId: string,
    input: CreateEntitlementGrantInput,
    now: Date = new Date(),
  ): Promise<EntitlementGrantDto> {
    const validFrom = parseInstant(input.validFrom, "validFrom") ?? now;
    const validUntil = parseInstant(input.validUntil, "validUntil");
    if (validUntil && validUntil.getTime() <= Math.max(validFrom.getTime(), now.getTime())) {
      throw new BadRequestException({
        code: ENTITLEMENT_GRANT_ERROR_CODES.invalidValidity,
        message: "validUntil must be in the future and after validFrom",
      });
    }
    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestException({
        code: ENTITLEMENT_GRANT_ERROR_CODES.invalidValidity,
        message: "reason is required",
      });
    }
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, erasedAt: true } });
    if (!user || user.erasedAt) {
      throw new NotFoundException({ code: ENTITLEMENT_GRANT_ERROR_CODES.userNotFound, message: "User not found" });
    }
    const grant = await prisma.entitlementGrant.create({
      data: {
        userId: user.id,
        plan: input.plan ?? "pro",
        source: input.source ?? "operator_grant",
        validFrom,
        validUntil,
        reason,
        createdByUserId: actorUserId,
      },
    });
    return toEntitlementGrantDto(grant, now);
  }

  async revoke(actorUserId: string, grantId: string, now: Date = new Date()): Promise<EntitlementGrantDto> {
    // Conditional update: two admins revoking at once leave one revocation.
    const { count } = await prisma.entitlementGrant.updateMany({
      where: { id: grantId, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: actorUserId },
    });
    const grant = await prisma.entitlementGrant.findUnique({ where: { id: grantId } });
    if (!grant) {
      throw new NotFoundException({ code: ENTITLEMENT_GRANT_ERROR_CODES.grantNotFound, message: "Grant not found" });
    }
    if (count === 0) {
      throw new ConflictException({
        code: ENTITLEMENT_GRANT_ERROR_CODES.alreadyRevoked,
        message: "This grant is already revoked",
      });
    }
    return toEntitlementGrantDto(grant, now);
  }

  /** A person's grants, newest first (all states). */
  async listForUser(userId: string, now: Date = new Date()): Promise<EntitlementGrantDto[]> {
    const grants = await prisma.entitlementGrant.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ENTITLEMENT_GRANT_LIST_LIMIT,
    });
    return grants.map((grant) => toEntitlementGrantDto(grant, now));
  }
}
