import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { BillingCoreModule } from "../billing/billing_core.module";
import { NotificationModule } from "../notifications/notification.module";
import { PrivacyModule } from "../privacy/privacy.module";
import { AccountController, AdminAccountsController } from "./accounts.controller";
import { AccountStandingModule } from "./account_standing.module";
import { AccountStatusInterceptor } from "./account_status.interceptor";
import { AccountStatusService } from "./account_status.service";

/**
 * Operator account suspension and closure (#2147). The interceptor is
 * registered globally by `AppModule` (APP_INTERCEPTOR) so every mutating route
 * is covered without per-route checks.
 */
@Module({
  imports: [AuditModule, NotificationModule, PrivacyModule, AccountStandingModule, BillingCoreModule],
  controllers: [AccountController, AdminAccountsController],
  providers: [AccountStatusService, AccountStatusInterceptor],
  exports: [AccountStatusService, AccountStatusInterceptor],
})
export class AccountsModule {}
