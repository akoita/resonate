import { Module } from "@nestjs/common";
import { BillingConfig } from "./billing_config";
import { STRIPE_GATEWAY, createStripeGateway } from "./stripe_gateway";
import { SubscriptionLifecycleService } from "./subscription_lifecycle.service";

/**
 * The Stripe configuration, the gateway and the account-lifecycle hooks
 * (#2430), with no routes. Privacy (erasure, closure requests), Accounts
 * (suspension, operator closure), Email (the billing email) and Maintenance
 * (the retention job) import this rather than `BillingModule`, so they do not
 * pull in the billing controllers or form an import cycle.
 */
@Module({
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
    SubscriptionLifecycleService,
  ],
  exports: [BillingConfig, STRIPE_GATEWAY, SubscriptionLifecycleService],
})
export class BillingCoreModule {}
