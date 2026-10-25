import { Module } from "@nestjs/common";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { NotificationModule } from "../notifications/notification.module";
import { PurchaseConsentModule } from "../purchase_consent/purchase_consent.module";
import { BillingConfig } from "./billing_config";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { CreditPackConfig } from "./credit_packs";
import { CreditTopUpController } from "./credit_topup.controller";
import { CreditTopUpService } from "./credit_topup.service";
import { STRIPE_GATEWAY, createStripeGateway } from "./stripe_gateway";
import { StripeWebhookController } from "./stripe_webhook.controller";
import { StripeWebhookService } from "./stripe_webhook.service";

/**
 * Artist Pro subscriptions through Stripe (#2407, test mode). The Stripe SDK is
 * only built when billing is configured (`BillingConfig`); otherwise the
 * gateway is null and the routes answer 503 `billing_unavailable`. Credit
 * packs (#1422) share the gateway, the customer and the webhook.
 */
@Module({
  imports: [EntitlementsModule, PurchaseConsentModule, NotificationModule],
  controllers: [BillingController, StripeWebhookController, CreditTopUpController],
  providers: [
    {
      provide: BillingConfig,
      useFactory: () => {
        const config = new BillingConfig();
        config.logIfUnavailable();
        return config;
      },
    },
    {
      provide: STRIPE_GATEWAY,
      inject: [BillingConfig],
      useFactory: (config: BillingConfig) => createStripeGateway(config),
    },
    BillingService,
    StripeWebhookService,
    { provide: CreditPackConfig, useFactory: () => new CreditPackConfig() },
    CreditTopUpService,
  ],
})
export class BillingModule {}
