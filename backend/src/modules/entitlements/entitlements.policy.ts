/**
 * The one entitlement policy (#2406, `docs/rfc/artist-pro.md` §4).
 *
 * Pure: no database, no clock. {@link decideEntitlement} turns a person's plan
 * (resolved by `EntitlementsService`) and a feature into a decision. Every gate
 * in the product reads this decision: Remix Studio Pro mode, Crate Digger Pro
 * and the cockpit demand cards through their adapters, and `GET /usage/summary`
 * for the plan. An agent or MCP surface that ever checks a gate for a person
 * must read that person's decision, never one of its own.
 *
 * Policy `entitlements/v1` is `everyone`: every feature is allowed for every
 * signed-in person with the reason `free_for_everyone`, exactly as the two
 * seams it replaces decided before. A plan is still resolved and recorded in
 * the decision, so `plan: "pro"` is truthful for a person an admin granted Pro.
 *
 * Business model: ADR-BM-6 revenue line 2 (Artist Pro), Phase 2. This file
 * carries no price. Switching to plan-based decisions (`rule: "plan"`) is one
 * policy version bump, reconciled in `docs/rfc/business-model.md` (Layer 2b)
 * FIRST, and it needs the §8 gates of the RFC (#2409).
 */

/** Every feature a gate decides. `credits.allowance` arrives with #2408. */
export const ENTITLEMENT_FEATURES = ["remix.pro", "crate.pro", "cockpit.demand"] as const;
export type EntitlementFeature = (typeof ENTITLEMENT_FEATURES)[number];

export const ENTITLEMENT_PLANS = ["free", "pro"] as const;
export type EntitlementPlan = (typeof ENTITLEMENT_PLANS)[number];

/**
 * Where a `pro` plan comes from: a Stripe subscription (#2407), or an operator
 * or promo grant (#2406).
 */
export const ENTITLEMENT_SOURCES = ["stripe_subscription", "operator_grant", "promo"] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

/** The sources an admin can grant by hand (`EntitlementGrant.source`). */
export const ENTITLEMENT_GRANT_SOURCES = ["operator_grant", "promo"] as const;
export type EntitlementGrantSource = (typeof ENTITLEMENT_GRANT_SOURCES)[number];

/** The plans an admin can grant (`EntitlementGrant.plan`). */
export const ENTITLEMENT_GRANT_PLANS = ["pro"] as const;
export type EntitlementGrantPlan = (typeof ENTITLEMENT_GRANT_PLANS)[number];

/**
 * `everyone`: every feature is allowed whatever the plan (today).
 * `plan`: a feature is allowed on `pro` only (the later gates-on slice, #2409).
 */
export type EntitlementRule = "everyone" | "plan";

export type EntitlementPolicy = Readonly<{ version: string; rule: EntitlementRule }>;

/** The policy in force: free for everyone, no price. */
export const ENTITLEMENTS_POLICY: EntitlementPolicy = Object.freeze({
  version: "entitlements/v1",
  rule: "everyone",
} as const);

export type EntitlementReason = "free_for_everyone" | "plan" | "grant" | "pro_required";

/** A person's plan, as the service resolved it. */
export type PlanResolution = {
  plan: EntitlementPlan;
  /** Set when `plan` is `pro`: what gives it. */
  source?: EntitlementSource;
  /** ISO end of the period or grant; absent when open-ended or `free`. */
  validUntil?: string;
};

export type EntitlementDecision = {
  allowed: boolean;
  reason: EntitlementReason;
  plan: EntitlementPlan;
  source?: EntitlementSource;
  validUntil?: string;
  policyVersion: string;
};

export const FREE_PLAN: PlanResolution = Object.freeze({ plan: "free" as const });

export function isEntitlementFeature(value: unknown): value is EntitlementFeature {
  return typeof value === "string" && (ENTITLEMENT_FEATURES as readonly string[]).includes(value);
}

/**
 * The decision for one feature. The plan is always carried through, so a
 * caller (or the client) can show the plan without a second lookup.
 */
export function decideEntitlement(
  feature: EntitlementFeature,
  resolution: PlanResolution,
  policy: EntitlementPolicy = ENTITLEMENTS_POLICY,
): EntitlementDecision {
  if (!isEntitlementFeature(feature)) {
    // A typo in a caller must never fail open under a future plan policy.
    throw new Error(`Unknown entitlement feature: ${String(feature)}`);
  }
  const isPro = resolution.plan === "pro";
  const plan: Pick<EntitlementDecision, "plan" | "source" | "validUntil"> = {
    plan: isPro ? "pro" : "free",
    ...(isPro && resolution.source ? { source: resolution.source } : {}),
    ...(isPro && resolution.validUntil ? { validUntil: resolution.validUntil } : {}),
  };
  if (policy.rule === "everyone") {
    return { allowed: true, reason: "free_for_everyone", ...plan, policyVersion: policy.version };
  }
  if (isPro) {
    const reason: EntitlementReason = resolution.source === "stripe_subscription" ? "plan" : "grant";
    return { allowed: true, reason, ...plan, policyVersion: policy.version };
  }
  return { allowed: false, reason: "pro_required", ...plan, policyVersion: policy.version };
}
