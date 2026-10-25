import { Module } from "@nestjs/common";
import { AdminEntitlementGrantsController } from "./admin_entitlement_grants.controller";
import { EntitlementGrantsService } from "./entitlement_grants.service";
import { EntitlementsService } from "./entitlements.service";
import { SubscriptionPlanService } from "./subscription_plan";

/**
 * One entitlement service and the admin grant routes (#2406), reading Stripe
 * subscriptions (#2407) before grants. A leaf: it
 * imports nothing, so the feature modules that adapt it (Remix, Crates, Scene
 * Scout) and Usage can import it without a cycle.
 */
@Module({
  controllers: [AdminEntitlementGrantsController],
  providers: [EntitlementGrantsService, SubscriptionPlanService, EntitlementsService],
  exports: [EntitlementGrantsService, SubscriptionPlanService, EntitlementsService],
})
export class EntitlementsModule {}
