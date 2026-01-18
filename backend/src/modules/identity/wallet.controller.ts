import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { SessionKeyService } from "./session_key.service";
import { SocialRecoveryService } from "./social_recovery.service";
import { WalletService } from "./wallet.service";

@Controller("wallet")
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly sessionKeyService: SessionKeyService,
    private readonly recoveryService: SocialRecoveryService
  ) {}

  @Post("fund")
  @UseGuards(AuthGuard("jwt"))
  fund(@Body() body: { userId: string; amountUsd: number }) {
    return this.walletService.fundWallet(body);
  }

  @Post("budget")
  @UseGuards(AuthGuard("jwt"))
  setBudget(
    @Body() body: { userId: string; monthlyCapUsd: number; resetSpent?: boolean },
  ) {
    return this.walletService.setBudget(body);
  }

  @Post("provider")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  setProvider(@Body() body: { userId: string; provider: "local" | "erc4337" }) {
    return this.walletService.setProvider(body);
  }

  @Post("refresh")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  refresh(@Body() body: { userId: string; provider?: "local" | "erc4337" }) {
    return this.walletService.refreshWallet(body);
  }

  @Post("deploy")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  deploy(@Body() body: { userId: string }) {
    return this.walletService.deploySmartAccount(body);
  }

  @Post("paymaster")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  configurePaymaster(@Body() body: { sponsorMaxUsd: number; paymasterAddress: string }) {
    this.walletService.configurePaymaster(body);
    return { status: "ok" };
  }

  @Get(":userId")
  @UseGuards(AuthGuard("jwt"))
  get(@Param("userId") userId: string) {
    return this.walletService.getWallet(userId);
  }

  @Post("session-key")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  createSessionKey(
    @Body() body: { userId: string; scope: string; ttlSeconds: number }
  ) {
    return this.sessionKeyService.issue(body);
  }

  @Post("session-key/validate")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  validateSessionKey(@Body() body: { token: string; scope: string }) {
    return this.sessionKeyService.validate(body.token, body.scope);
  }

  @Post("guardians")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  setGuardians(@Body() body: { userId: string; guardians: string[]; required: number }) {
    return this.recoveryService.setGuardians(body.userId, body.guardians, body.required);
  }

  @Post("recovery/request")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  requestRecovery(@Body() body: { userId: string; newOwner: string; required: number }) {
    return this.recoveryService.requestRecovery(body);
  }

  @Post("recovery/approve")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  approveRecovery(@Body() body: { requestId: string; guardian: string }) {
    return this.recoveryService.approveRecovery(body);
  }
}
