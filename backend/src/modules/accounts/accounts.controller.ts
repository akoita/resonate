import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RequireStepUp } from "../admin_step_up/require_step_up.decorator";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AccountStatusService } from "./account_status.service";
import { CloseAccountDto, SuspendAccountDto, UnsuspendAccountDto } from "./accounts.dto";

/**
 * The signed-in person's own account state, for the app-shell banner. Read
 * only: the person can always see why they are restricted.
 */
@Controller("account")
export class AccountController {
  constructor(private readonly accounts: AccountStatusService) {}

  @UseGuards(AuthGuard("jwt"))
  @Get("status")
  status(@Req() req: any) {
    return this.accounts.getOwnStatus(req.user.userId);
  }
}

/**
 * Operator account suspension and closure (#2147). Admin only: an operator can
 * read the platform's queues but does not hold the power to restrict a person.
 *
 * Suspending and closing also need a fresh step-up proof (#2173,
 * `@RequireStepUp()`): `403 { code: "step_up_required" }` without one. Lifting
 * a suspension only restores access, so it does not.
 */
@Controller("admin/accounts")
export class AdminAccountsController {
  constructor(private readonly accounts: AccountStatusService) {}

  private actor(req: any) {
    return { userId: req.user.userId as string, role: req.user.role as string | undefined };
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Get(":userId/status")
  status(@Param("userId") userId: string) {
    return this.accounts.getStatus(userId);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @RequireStepUp()
  @HttpCode(200)
  @Post(":userId/suspend")
  suspend(@Req() req: any, @Param("userId") userId: string, @Body() body: SuspendAccountDto) {
    return this.accounts.suspend(this.actor(req), userId, body ?? {});
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @HttpCode(200)
  @Post(":userId/unsuspend")
  unsuspend(@Req() req: any, @Param("userId") userId: string, @Body() body: UnsuspendAccountDto) {
    return this.accounts.unsuspend(this.actor(req), userId, body ?? {});
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @RequireStepUp()
  @HttpCode(200)
  @Post(":userId/close")
  close(@Req() req: any, @Param("userId") userId: string, @Body() body: CloseAccountDto) {
    return this.accounts.close(this.actor(req), userId, body ?? {});
  }
}
