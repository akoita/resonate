import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
  forwardRef,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { SessionKeyService } from "./session_key.service";
import { SocialRecoveryService } from "./social_recovery.service";
import { normalizeUserId } from "./user_id";
import {
  ActivateAgentSessionKeyDto,
  AgentPurchaseDto,
  ApproveRecoveryDto,
  ConfigurePaymasterDto,
  CreateSessionKeyDto,
  DisableAgentWalletDto,
  EnableAgentWalletDto,
  FundWalletDto,
  RefreshWalletDto,
  RequestRecoveryDto,
  ResetPaymasterDto,
  RotateAgentKeyDto,
  SetGuardiansDto,
  SetWalletBudgetDto,
  SetWalletProviderDto,
  ValidateSessionKeyDto,
} from "./wallet.dto";
import { WalletService } from "./wallet.service";
import { AgentWalletService } from "../agents/agent_wallet.service";
import { AgentPurchaseService } from "../agents/agent_purchase.service";
import { AdminAudit, auditBody, auditCount, auditNumber, auditRef } from "../admin_audit/admin_audit.interceptor";
import { RequireStepUp } from "../admin_step_up/require_step_up.decorator";

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

  /**
   * Wallet writes that take a target user id act on the caller's own wallet;
   * admins may name any user. Ids are compared in their canonical form (#2180).
   */
  private assertOwnWalletOrAdmin(req: any, userId: string) {
    if (req?.user?.role === "admin") return;
    if (
      typeof userId !== "string" ||
      normalizeUserId(userId) !== normalizeUserId(req?.user?.userId)
    ) {
      throw new ForbiddenException("You can only change your own wallet");
    }
  }

  @Post("fund")
  @UseGuards(AuthGuard("jwt"))
  fund(@Req() req: any, @Body() body: FundWalletDto) {
    this.assertOwnWalletOrAdmin(req, body?.userId);
    return this.walletService.fundWallet(body);
  }

  @Post("budget")
  @UseGuards(AuthGuard("jwt"))
  setBudget(
    @Req() req: any,
    @Body() body: SetWalletBudgetDto,
  ) {
    this.assertOwnWalletOrAdmin(req, body?.userId);
    return this.walletService.setBudget(body);
  }

  @Post("provider")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @AdminAudit("wallet.provider_set", (c) => ({ targetUserId: auditRef(auditBody(c).userId) ?? null, detail: { provider: auditRef(auditBody(c).provider) } }))
  setProvider(@Body() body: SetWalletProviderDto) {
    return this.walletService.setProvider(body);
  }

  @Post("refresh")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @AdminAudit("wallet.refreshed", (c) => ({ targetUserId: auditRef(auditBody(c).userId) ?? null }))
  refresh(@Body() body: RefreshWalletDto) {
    return this.walletService.refreshWallet(body);
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


  @Post("paymaster")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @AdminAudit("wallet.paymaster_configured", (c) => ({ detail: { sponsorMaxUsd: auditNumber(auditBody(c).sponsorMaxUsd), paymasterAddress: auditRef(auditBody(c).paymasterAddress) } }))
  configurePaymaster(@Body() body: ConfigurePaymasterDto) {
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
  @AdminAudit("wallet.paymaster_reset", (c) => ({ targetUserId: auditRef(auditBody(c).userId) ?? null }))
  resetPaymaster(@Body() body: ResetPaymasterDto) {
    this.walletService.resetPaymaster(body.userId);
    return { status: "ok" };
  }

  @Get(":userId")
  @UseGuards(AuthGuard("jwt"))
  get(@Req() req: any, @Param("userId") userId: string) {
    // Wallet reads return the caller's own wallet; admins may read any
    // existing wallet. The id may be the user id or the wallet address.
    return this.walletService.getWalletForCaller(req.user, userId);
  }

  @Post("session-key")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @AdminAudit("wallet.session_key_issued", (c) => ({ targetUserId: auditRef(auditBody(c).userId) ?? null, detail: { scope: auditRef(auditBody(c).scope), ttlSeconds: auditNumber(auditBody(c).ttlSeconds) } }))
  createSessionKey(
    @Body() body: CreateSessionKeyDto
  ) {
    return this.sessionKeyService.issue(body);
  }

  @Post("session-key/validate")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  validateSessionKey(@Body() body: ValidateSessionKeyDto) {
    return this.sessionKeyService.validate(body.token, body.scope);
  }

  @Post("guardians")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @RequireStepUp()
  @AdminAudit("wallet.guardians_set", (c) => ({ targetUserId: auditRef(auditBody(c).userId) ?? null, detail: { guardianCount: auditCount(auditBody(c).guardians), required: auditNumber(auditBody(c).required) } }))
  setGuardians(@Body() body: SetGuardiansDto) {
    return this.recoveryService.setGuardians(body.userId, body.guardians, body.required);
  }

  @Post("recovery/request")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @RequireStepUp()
  @AdminAudit("wallet.recovery_requested", (c) => ({ targetUserId: auditRef(auditBody(c).userId) ?? null, detail: { newOwner: auditRef(auditBody(c).newOwner), required: auditNumber(auditBody(c).required) } }))
  requestRecovery(@Body() body: RequestRecoveryDto) {
    return this.recoveryService.requestRecovery(body);
  }

  @Post("recovery/approve")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @RequireStepUp()
  @AdminAudit("wallet.recovery_approved", (c) => ({ detail: { requestId: auditRef(auditBody(c).requestId) } }))
  approveRecovery(@Body() body: ApproveRecoveryDto) {
    return this.recoveryService.approveRecovery(body);
  }

  // ============ Agent Wallet Endpoints ============

  /**
   * Enable agent wallet — generates the agent's keypair server-side
   * and returns the agent's public address for the frontend to build
   * the permission validator around.
   */
  @Post("agent/enable")
  @UseGuards(AuthGuard("jwt"))
  enableAgentWallet(
    @Req() req: any,
    @Body() body?: EnableAgentWalletDto,
  ) {
    const defaultPermissions = {
      target: process.env.MARKETPLACE_ADDRESS ?? "",
      function: "buy(uint256,uint256)",
      totalCapWei: "50000000000000000000",
      perTxCapWei: "5000000000000000000",
      rateLimit: 10,
    };
    return this.agentWalletService.enable(
      req.user.userId,
      body?.permissions ?? defaultPermissions,
      body?.validityHours ?? 24,
    );
  }

  /**
   * Activate the session key after the user signs the approval.
   * The frontend sends the approval data (NOT the private key).
   */
  @Post("agent/session-key/activate")
  @UseGuards(AuthGuard("jwt"))
  activateSessionKey(
    @Req() req: any,
    @Body() body: ActivateAgentSessionKeyDto,
  ) {
    return this.agentWalletService.activateSessionKey(
      req.user.userId,
      body.approvalData,
      body.txHash,
    );
  }

  @Delete("agent/session-key")
  @UseGuards(AuthGuard("jwt"))
  disableAgentWallet(
    @Req() req: any,
    @Body() body?: DisableAgentWalletDto,
  ) {
    return this.agentWalletService.disable(
      req.user.userId,
      body?.revokeTxHash,
    );
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

  /**
   * Rotate the agent's key — generates a new keypair, revokes old.
   * Returns the new agent address; frontend must re-approve permissions.
   */
  @Post("agent/rotate")
  @UseGuards(AuthGuard("jwt"))
  rotateAgentKey(
    @Req() req: any,
    @Body() body?: RotateAgentKeyDto,
  ) {
    const defaultPermissions = {
      target: process.env.MARKETPLACE_ADDRESS || "",
      function: "buy(uint256,uint256)",
      totalCapWei: "50000000000000000000",
      perTxCapWei: "5000000000000000000",
      rateLimit: 10,
    };

    return this.agentWalletService.rotateKey(
      req.user.userId,
      body?.permissions || defaultPermissions,
      body?.validityHours || 24,
    );
  }

  @Post("agent/purchase")
  @UseGuards(AuthGuard("jwt"))
  agentPurchase(@Req() req: any, @Body() body: AgentPurchaseDto) {
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
