/**
 * One entitlement service (#2406, `docs/rfc/artist-pro.md` §4).
 *
 * `decide(userId, feature)` is the only place a gate is decided. The Remix
 * Studio and Crate Digger seams (`remix-entitlements.ts`, `crate-entitlements.ts`)
 * and the Scene Scout demand seam (`SceneScoutEntitlementsService`) are thin
 * adapters over it, so their callers, DTOs and 403 `pro_required` answers are
 * unchanged. The policy itself is pure (`entitlements.policy.ts`).
 *
 * Plan resolution, in order:
 *   1. (#2407) an active or trialing Stripe subscription. Not built yet: it
 *      goes in {@link EntitlementsService.resolvePlan} ahead of grants.
 *   2. a valid operator or promo `EntitlementGrant`;
 *   3. otherwise `free`.
 *
 * Nothing is cached across calls, so a grant or revocation is seen by the very
 * next decision (the RFC: never cached across a plan change).
 */

import { Injectable, Optional } from "@nestjs/common";
import { EntitlementGrantsService } from "./entitlement_grants.service";
import {
  decideEntitlement,
  ENTITLEMENTS_POLICY,
  type EntitlementDecision,
  type EntitlementFeature,
  type EntitlementPolicy,
  type PlanResolution,
} from "./entitlements.policy";

@Injectable()
export class EntitlementsService {
  private readonly grants: EntitlementGrantsService;
  private readonly policy: EntitlementPolicy;

  constructor(@Optional() grants?: EntitlementGrantsService) {
    this.grants = grants ?? new EntitlementGrantsService();
    this.policy = ENTITLEMENTS_POLICY;
  }

  /** `userId`'s plan right now (`GET /usage/summary` shows it). */
  async resolvePlan(userId: string, now: Date = new Date()): Promise<PlanResolution> {
    // #2407: an active or trialing subscription is checked here first.
    return this.grants.resolvePlan(userId, now);
  }

  /** Whether `userId` may use `feature`, with the plan that decided it. */
  async decide(userId: string, feature: EntitlementFeature, now: Date = new Date()): Promise<EntitlementDecision> {
    return decideEntitlement(feature, await this.resolvePlan(userId, now), this.policy);
  }
}
