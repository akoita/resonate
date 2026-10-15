import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
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
    return this.accounts.getEffective(req.user.userId);
  }
}

/**
 * Operator account suspension and closure (#2147). Admin only: an operator can
 * read the platform's queues but does not hold the power to restrict a person.
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
  @HttpCode(200)
  @Post(":userId/close")
  close(@Req() req: any, @Param("userId") userId: string, @Body() body: CloseAccountDto) {
    return this.accounts.close(this.actor(req), userId, body ?? {});
  }
}
