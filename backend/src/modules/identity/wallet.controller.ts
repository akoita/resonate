import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards, forwardRef } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { SessionKeyService } from "./session_key.service";
import { SocialRecoveryService } from "./social_recovery.service";
import { WalletService } from "./wallet.service";
import { AgentWalletService } from "../agents/agent_wallet.service";
import { AgentPurchaseService } from "../agents/agent_purchase.service";

@Controller("wallet")
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly sessionKeyService: SessionKeyService,
    private readonly recoveryService: SocialRecoveryService,
    @Inject(forwardRef(() => AgentWalletService))
    private readonly agentWalletService: AgentWalletService,
    @Inject(forwardRef(() => AgentPurchaseService))
    private readonly agentPurchaseService: AgentPurchaseService
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

  @Post("aa/enable")
  @UseGuards(AuthGuard("jwt"))
  enableSmartAccount(@Req() req: any) {
    return this.walletService.setProvider({ userId: req.user.userId, provider: "erc4337" });
  }

  @Post("aa/refresh")
  @UseGuards(AuthGuard("jwt"))
  refreshSmartAccount(@Req() req: any) {
    return this.walletService.refreshWallet({ userId: req.user.userId, provider: "erc4337" });
  }

  @Post("aa/deploy")
  @UseGuards(AuthGuard("jwt"))
  deploySmartAccountForUser(@Req() req: any) {
    return this.walletService.deploySmartAccount({ userId: req.user.userId });
  }

  @Post("paymaster")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  configurePaymaster(@Body() body: { sponsorMaxUsd: number; paymasterAddress: string }) {
    this.walletService.configurePaymaster(body);
    return { status: "ok" };
  }

  @Get("paymaster")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  getPaymasterStatus(@Req() req: any) {
    return this.walletService.getPaymasterStatus(req.query?.userId);
  }

  @Post("paymaster/reset")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  resetPaymaster(@Body() body: { userId: string }) {
    this.walletService.resetPaymaster(body.userId);
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

  // ============ Agent Wallet Endpoints ============

  @Post("agent/enable")
  @UseGuards(AuthGuard("jwt"))
  enableAgentWallet(@Req() req: any) {
    return this.agentWalletService.enable(req.user.userId);
  }

  @Delete("agent/session-key")
  @UseGuards(AuthGuard("jwt"))
  disableAgentWallet(@Req() req: any) {
    return this.agentWalletService.disable(req.user.userId);
  }

  @Get("agent/status")
  @UseGuards(AuthGuard("jwt"))
  getAgentWalletStatus(@Req() req: any) {
    return this.agentWalletService.getStatus(req.user.userId);
  }

  @Get("agent/transactions")
  @UseGuards(AuthGuard("jwt"))
  getAgentTransactions(@Req() req: any) {
    return this.agentPurchaseService.getTransactions(req.user.userId);
  }

  @Post("agent/purchase")
  @UseGuards(AuthGuard("jwt"))
  agentPurchase(@Req() req: any, @Body() body: {
    sessionId: string;
    listingId: string;
    tokenId: string;
    amount: string;
    totalPriceWei: string;
    priceUsd: number;
  }) {
    return this.agentPurchaseService.purchase({
      sessionId: body.sessionId,
      userId: req.user.userId,
      listingId: BigInt(body.listingId),
      tokenId: BigInt(body.tokenId),
      amount: BigInt(body.amount),
      totalPriceWei: body.totalPriceWei,
      priceUsd: body.priceUsd,
    });
  }
}
