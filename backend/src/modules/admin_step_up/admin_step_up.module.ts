import { Global, Module } from "@nestjs/common";
import { AdminStepUpController } from "./admin_step_up.controller";
import { AdminStepUpService } from "./admin_step_up.service";
import { AdminStepUpTokenService } from "./admin_step_up_token.service";

/**
 * Admin step-up confirmation (#2173). Global because the `AdminStepUpGuard` (an `APP_GUARD`
 * in `AppModule`) needs the token service; `AuthModule` (global)
 * supplies `AuthService` and `PUBLIC_CLIENT`.
 */
@Global()
@Module({
  controllers: [AdminStepUpController],
  providers: [AdminStepUpService, AdminStepUpTokenService],
  exports: [AdminStepUpTokenService],
})
export class AdminStepUpModule {}
