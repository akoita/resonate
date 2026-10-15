import { Module } from "@nestjs/common";
import { AccountStandingService } from "./account_standing.service";

/**
 * The dependency-free, cached account-state read (#2167). Kept apart from
 * `AccountsModule` (which imports privacy, and through it analytics) so that
 * analytics can ask whether a person is restricted without an import cycle.
 */
@Module({
  providers: [AccountStandingService],
  exports: [AccountStandingService],
})
export class AccountStandingModule {}
