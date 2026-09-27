/**
 * Remix Studio entitlement seam (#1903 S6a).
 *
 * Pro mode (per-stem EQ and pan today; more engineer tools in later S6
 * slices) is FREE for everyone: the policy below allows every signed-in
 * user and there is no price. The seam exists so a later paid tier can
 * decide `remix.pro` from a subscription or an x402 / stablecoin receipt
 * without changing any caller: callers await {@link RemixEntitlementsService.pro}
 * and the project DTO exposes the result, so the client never hard-codes it.
 *
 * Business model: this seam is ready for ADR-BM-6 revenue line (2) (artist /
 * creator tools), but it carries no price. Any price, tier or rule change
 * must land in `docs/rfc/business-model.md` FIRST, then bump
 * {@link REMIX_PRO_POLICY}'s version here.
 *
 * Enforcement (remix-project.service.ts): a PATCH `effects` that SETS a Pro
 * field (a new or changed value) is refused with 403 `pro_required` when the
 * entitlement is not allowed. Saved Pro fields always render and can always
 * be removed: an entitlement never silently changes stored audio.
 */

import { Injectable } from "@nestjs/common";

/** The entitlement key for Remix Studio Pro mode. */
export const REMIX_PRO_FEATURE = "remix.pro" as const;

/** The current Pro policy: free for everyone, no price. */
export const REMIX_PRO_POLICY = Object.freeze({
  version: "remix-pro-policy/v1",
  rule: "everyone",
} as const);

export type RemixEntitlementReason = "free_for_everyone";

export type RemixEntitlementDecision = {
  allowed: boolean;
  /** Why; a denied decision from a future policy carries its own reason. */
  reason: RemixEntitlementReason | string;
  policyVersion: string;
};

/** Entitlements exposed on the project DTO. */
export type RemixProjectEntitlements = {
  pro: RemixEntitlementDecision;
};

@Injectable()
export class RemixEntitlementsService {
  /**
   * Whether `userId` may use Remix Studio Pro mode (`remix.pro`). Async so a
   * future policy can look up a subscription or a payment receipt; today's
   * policy ignores `userId`.
   */
  async pro(userId: string): Promise<RemixEntitlementDecision> {
    return {
      allowed: true,
      reason: "free_for_everyone",
      policyVersion: REMIX_PRO_POLICY.version,
    };
  }

  /** Every Remix Studio entitlement, as the project DTO exposes them. */
  async forProject(userId: string): Promise<RemixProjectEntitlements> {
    return { pro: await this.pro(userId) };
  }
}
