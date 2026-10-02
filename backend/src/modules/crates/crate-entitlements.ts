/**
 * Crate Digger entitlement seam (#1966).
 *
 * Crate Digger is FREE for everyone today: the policy below allows every
 * signed-in user and there is no price. The seam exists so a later paid tier
 * can decide `crate.pro` from a subscription or an x402 / stablecoin receipt
 * without changing any caller: callers await
 * {@link CrateEntitlementsService.pro} and the crate DTOs expose the result, so
 * the client never hard-codes it. It mirrors the Remix Studio seam
 * (`remix-entitlements.ts`, #1903).
 *
 * Business model: this seam is ready for ADR-BM-6 revenue line (2) (artist /
 * creator tools; DJ tooling), but it carries no price. Any price, tier or rule
 * change must land in `docs/rfc/business-model.md` FIRST, then bump
 * {@link CRATE_PRO_POLICY}'s version here.
 *
 * Exporting a crate to rekordbox or Serato (#1965) is decided through the same
 * seam by {@link CrateEntitlementsService.export}: free for everyone today. A
 * future policy that denies it makes the export routes answer 403
 * `pro_required`; it never changes what the DJ owns or may already download.
 *
 * Enforcement (planned, in the crate service): creating a crate beyond
 * {@link CRATE_FREE_SAVED_CRATES} is refused with 403 `pro_required` when the
 * entitlement is not allowed (see {@link canCreateCrate}). Today the policy
 * never denies, so nothing is refused. An entitlement never deletes or hides
 * data a user already created: existing crates always stay readable and
 * removable, whatever the policy says.
 */

import { Injectable } from "@nestjs/common";

/** The entitlement key for Crate Digger Pro. */
export const CRATE_PRO_FEATURE = "crate.pro" as const;

/** The current Pro policy: free for everyone, no price. */
export const CRATE_PRO_POLICY = Object.freeze({
  version: "crate-pro-policy/v1",
  rule: "everyone",
} as const);

/**
 * How many saved crates a user may keep without `crate.pro`. Only enforced once
 * a policy can deny: today every user is granted `crate.pro`.
 */
export const CRATE_FREE_SAVED_CRATES = 3;

export type CrateEntitlementReason = "free_for_everyone";

export type CrateEntitlementDecision = {
  allowed: boolean;
  /** Why; a denied decision from a future policy carries its own reason. */
  reason: CrateEntitlementReason | string;
  policyVersion: string;
};

/** Entitlements exposed on the crate DTOs. */
export type CrateEntitlements = {
  pro: CrateEntitlementDecision;
};

/**
 * Whether a user may create one more crate. Pure, so the future limit is
 * testable today. Never used to remove or hide an existing crate.
 */
export function canCreateCrate(input: {
  existingCrates: number;
  pro: CrateEntitlementDecision;
}): { allowed: true } | { allowed: false; reason: "pro_required" } {
  if (input.pro.allowed || input.existingCrates < CRATE_FREE_SAVED_CRATES) {
    return { allowed: true };
  }
  return { allowed: false, reason: "pro_required" };
}

@Injectable()
export class CrateEntitlementsService {
  /**
   * Whether `userId` may use Crate Digger Pro (`crate.pro`). Async so a future
   * policy can look up a subscription or a payment receipt; today's policy
   * ignores `userId`.
   */
  async pro(userId: string): Promise<CrateEntitlementDecision> {
    return {
      allowed: true,
      reason: "free_for_everyone",
      policyVersion: CRATE_PRO_POLICY.version,
    };
  }

  /**
   * Whether `userId` may export a crate to rekordbox or Serato (#1965). Part of
   * `crate.pro`: today's policy allows everyone. Export never grants rights, it
   * only lists stems the user already owns.
   */
  async export(userId: string): Promise<CrateEntitlementDecision> {
    return this.pro(userId);
  }

  /** Every Crate Digger entitlement, as the crate DTOs expose them. */
  async forCrate(userId: string): Promise<CrateEntitlements> {
    return { pro: await this.pro(userId) };
  }
}
