import "reflect-metadata";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { AccountStatusService } from "../modules/accounts/account_status.service";
import { AccountsModule } from "../modules/accounts/accounts.module";
import { BillingCoreModule } from "../modules/billing/billing_core.module";
import { SubscriptionLifecycleService } from "../modules/billing/subscription_lifecycle.service";
import { ContactEmailService } from "../modules/email/contact_email.service";
import { EmailModule } from "../modules/email/email.module";
import { MaintenanceModule } from "../modules/maintenance/maintenance.module";
import { MaintenanceService } from "../modules/maintenance/maintenance.service";
import { PrivacyController } from "../modules/privacy/privacy.controller";
import { PrivacyModule } from "../modules/privacy/privacy.module";

/**
 * #2492: the #2430 account-lifecycle hooks (pause on suspension, cancel on
 * closure and erasure, billing-email sync, StripeEvent retention) were never
 * injected: their `SubscriptionLifecycleService | null = null` parameters
 * serialized as `Object`, so `@Optional()` gave them undefined in every
 * deployment. Nest resolves a parameter by its `design:paramtypes` entry, so
 * each consumer must name the service there, and its module must import
 * `BillingCoreModule`, which provides it.
 */
const consumers = [
  { consumer: AccountStatusService, module: AccountsModule },
  { consumer: ContactEmailService, module: EmailModule },
  { consumer: MaintenanceService, module: MaintenanceModule },
  { consumer: PrivacyController, module: PrivacyModule },
];

describe("SubscriptionLifecycleService wiring (#2492)", () => {
  it.each(consumers)("$consumer.name receives the lifecycle service from $module.name", ({ consumer, module }) => {
    const paramTypes: unknown[] = Reflect.getMetadata("design:paramtypes", consumer) ?? [];
    expect(paramTypes).toContain(SubscriptionLifecycleService);
    const imports: unknown[] = Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) ?? [];
    expect(imports).toContain(BillingCoreModule);
  });
});
