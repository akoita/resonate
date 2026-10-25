import { Module } from "@nestjs/common";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { PurchaseConsentModule } from "../purchase_consent/purchase_consent.module";
import { BillingConfig } from "./billing_config";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { STRIPE_GATEWAY, createStripeGateway } from "./stripe_gateway";
import { StripeWebhookController } from "./stripe_webhook.controller";
import { StripeWebhookService } from "./stripe_webhook.service";

/**
 * Artist Pro subscriptions through Stripe (#2407, test mode). The Stripe SDK is
 * only built when billing is configured (`BillingConfig`); otherwise the
 * gateway is null and the routes answer 503 `billing_unavailable`.
 */
@Module({
  imports: [EntitlementsModule, PurchaseConsentModule],
  controllers: [BillingController, StripeWebhookController],
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
  ],
})
export class BillingModule {}
