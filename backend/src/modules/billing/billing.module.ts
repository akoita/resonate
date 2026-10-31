import { Module } from "@nestjs/common";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { NotificationModule } from "../notifications/notification.module";
import { PurchaseConsentModule } from "../purchase_consent/purchase_consent.module";
import { BillingReconciliationController } from "./billing_reconciliation.controller";
import { BillingReconciliationService } from "./billing_reconciliation.service";
import { BillingController } from "./billing.controller";
import { BillingCoreModule } from "./billing_core.module";
import { BillingService } from "./billing.service";
import { CreditPackConfig } from "./credit_packs";
import { CreditTopUpController } from "./credit_topup.controller";
import { CreditTopUpService } from "./credit_topup.service";
import { StripeWebhookController } from "./stripe_webhook.controller";
import { StripeWebhookService } from "./stripe_webhook.service";

/**
 * Artist Pro subscriptions through Stripe (#2407, test mode). The Stripe SDK is
 * only built when billing is configured (`BillingConfig`); otherwise the
 * gateway is null and the routes answer 503 `billing_unavailable`. Credit
 * packs (#1422) share the gateway, the customer and the webhook. The config,
 * the gateway and the account-lifecycle hooks (#2430) come from
 * `BillingCoreModule`.
 */
@Module({
  imports: [BillingCoreModule, EntitlementsModule, PurchaseConsentModule, NotificationModule],
  controllers: [BillingController, StripeWebhookController, CreditTopUpController, BillingReconciliationController],
  providers: [
    BillingService,
    StripeWebhookService,
    { provide: CreditPackConfig, useFactory: () => new CreditPackConfig() },
    CreditTopUpService,
    BillingReconciliationService,
  ],
})
export class BillingModule {}
