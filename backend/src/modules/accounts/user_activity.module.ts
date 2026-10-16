import { Module } from "@nestjs/common";
import { UserActivityInterceptor } from "./user_activity.interceptor";
import { UserActivityService } from "./user_activity.service";

/**
 * Dependency-free "last active" tracking (#2166). Kept apart from
 * `AccountsModule` (which imports privacy) so that auth can stamp sign-ins
 * without an import cycle. The interceptor is registered globally by
 * `AppModule` (APP_INTERCEPTOR).
 */
@Module({
  providers: [UserActivityService, UserActivityInterceptor],
  exports: [UserActivityService, UserActivityInterceptor],
})
export class UserActivityModule {}
