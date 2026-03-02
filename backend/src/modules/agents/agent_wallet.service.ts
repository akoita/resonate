import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { WalletService } from "../identity/wallet.service";
import {
  ZeroDevSessionKeyService,
  type SessionKeyPermissions,
} from "../identity/zerodev_session_key.service";

export interface AgentWalletStatus {
  enabled: boolean;
  walletAddress: string | null;
  accountType: string;
  sessionKeyValid: boolean;
  sessionKeyExpiresAt: number | null;
  budgetCapUsd: number;
  spentUsd: number;
  remainingUsd: number;
  alertLevel: "none" | "warning" | "critical" | "exhausted";
  // On-chain session key fields (self-custodial)
  sessionKeyTxHash: string | null;
  sessionKeyExplorerUrl: string | null;
  sessionKeyPermissions: SessionKeyPermissions | null;
}

@Injectable()
export class AgentWalletService {
  private readonly logger = new Logger(AgentWalletService.name);
  private readonly explorerUrl: string;

  constructor(
    private readonly walletService: WalletService,
    private readonly zeroDevSessionKeyService: ZeroDevSessionKeyService,
    private readonly eventBus: EventBus,
  ) {
    this.explorerUrl =
      process.env.BLOCK_EXPLORER_URL ?? "https://sepolia.etherscan.io";
  }

  /**
   * Enable agent wallet and generate the agent's keypair.
   * Returns the agent's public address so the frontend can build
   * the permission validator around it.
   */
  async enable(
    userId: string,
    permissions: SessionKeyPermissions,
    validityHours: number = 24,
  ): Promise<{ agentAddress: string; status: AgentWalletStatus }> {
    // Ensure user has an ERC-4337 wallet
    const wallet = await this.walletService.refreshWallet({
      userId,
      provider: "erc4337",
    });

    // Generate the agent's keypair and create a pending session
    const validUntil = new Date(Date.now() + validityHours * 60 * 60 * 1000);
    const { agentAddress } = await this.zeroDevSessionKeyService.createPendingSession(
      userId,
      permissions,
      validUntil,
    );

    this.eventBus.publish({
      eventName: "agent.wallet_enabled",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      walletAddress: (wallet as any).address,
      agentAddress,
    });

    const status = await this.getStatus(userId);
    return { agentAddress, status };
  }

  /**
   * Activate the session key after the user signs the approval on-chain.
   * The frontend sends the approval data (NOT the private key).
   */
  async activateSessionKey(
    userId: string,
    approvalData: string,
    txHash?: string,
  ) {
    return this.zeroDevSessionKeyService.activateSessionKey(
      userId,
      approvalData,
      txHash,
    );
  }

  /**
   * Disable agent wallet.
   * The frontend signs the on-chain revocation first,
   * then calls this to mark it revoked in the DB.
   */
  async disable(
    userId: string,
    revokeTxHash?: string,
  ): Promise<{ status: string }> {
    await this.zeroDevSessionKeyService.markRevoked(userId, revokeTxHash);

    this.eventBus.publish({
      eventName: "agent.wallet_disabled",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
    });

    return { status: "disabled" };
  }

  async getStatus(userId: string): Promise<AgentWalletStatus> {
    const wallet = await this.walletService.getWallet(userId);
    if (!wallet) {
      return {
        enabled: false,
        walletAddress: null,
        accountType: "none",
        sessionKeyValid: false,
        sessionKeyExpiresAt: null,
        budgetCapUsd: 0,
        spentUsd: 0,
        remainingUsd: 0,
        alertLevel: "none",
        sessionKeyTxHash: null,
        sessionKeyExplorerUrl: null,
        sessionKeyPermissions: null,
      };
    }

    let sessionKeyValid = false;
    let sessionKeyExpiresAt: number | null = null;
    let sessionKeyTxHash: string | null = null;
    let sessionKeyPermissions: SessionKeyPermissions | null = null;

    // Validate on-chain session key from DB
    const validation =
      await this.zeroDevSessionKeyService.validateSessionKey(userId);
    if (validation && validation.valid) {
      sessionKeyValid = true;
      sessionKeyExpiresAt = validation.validUntil?.getTime() ?? null;
      sessionKeyTxHash = validation.txHash ?? null;
      sessionKeyPermissions = validation.permissions ?? null;
    }

    // Read budget from AgentConfig
    const agentConfig = await prisma.agentConfig.findUnique({
      where: { userId },
    });
    const budgetCapUsd = agentConfig?.monthlyCapUsd ?? 0;

    // Compute spending
    const sessions = await prisma.session.findMany({
      where: { userId },
      select: { spentUsd: true },
    });
    const spentUsd = sessions.reduce((sum, s) => sum + s.spentUsd, 0);

    const remaining = budgetCapUsd - spentUsd;
    const alertLevel = this.computeAlertLevel(spentUsd, budgetCapUsd);

    const sessionKeyExplorerUrl = sessionKeyTxHash
      ? `${this.explorerUrl}/tx/${sessionKeyTxHash}`
      : null;

    return {
      enabled:
        (wallet as any).accountType === "erc4337" && sessionKeyValid,
      walletAddress: wallet.address,
      accountType: (wallet as any).accountType ?? "local",
      sessionKeyValid,
      sessionKeyExpiresAt,
      budgetCapUsd,
      spentUsd,
      remainingUsd: Math.max(0, remaining),
      alertLevel,
      sessionKeyTxHash,
      sessionKeyExplorerUrl,
      sessionKeyPermissions,
    };
  }

  /**
   * Validate the session key for a user.
   */
  async validateSessionKey(userId: string): Promise<boolean> {
    const validation = await this.zeroDevSessionKeyService.validateSessionKey(userId);
    return validation?.valid ?? false;
  }

  /**
   * Get the agent's key data for sending session-key-scoped transactions.
   * Used by AgentPurchaseService.
   */
  async getAgentKeyData(userId: string) {
    return this.zeroDevSessionKeyService.getAgentKeyData(userId);
  }

  /**
   * Rotate the agent's key — generates a new keypair, revokes old.
   * Returns the new agent address; frontend must re-approve permissions.
   */
  async rotateKey(
    userId: string,
    permissions: SessionKeyPermissions,
    validityHours: number = 24,
  ): Promise<{ agentAddress: string; oldAgentAddress: string | null }> {
    const result = await this.zeroDevSessionKeyService.rotateAgentKey(
      userId,
      permissions,
      validityHours,
    );

    return result;
  }

  computeAlertLevel(
    spentUsd: number,
    monthlyCapUsd: number,
  ): "none" | "warning" | "critical" | "exhausted" {
    if (monthlyCapUsd <= 0) return "none";
    const pct = (spentUsd / monthlyCapUsd) * 100;
    if (pct >= 100) return "exhausted";
    if (pct >= 95) return "critical";
    if (pct >= 80) return "warning";
    return "none";
  }

  checkAndEmitBudgetAlert(
    userId: string,
    spentUsd: number,
    monthlyCapUsd: number,
  ): void {
    const level = this.computeAlertLevel(spentUsd, monthlyCapUsd);
    if (level !== "none") {
      const pct = Math.round((spentUsd / monthlyCapUsd) * 100);
      this.eventBus.publish({
        eventName: "agent.budget_alert",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        userId,
        level,
        percentUsed: pct,
        spentUsd,
        monthlyCapUsd,
        remainingUsd: Math.max(0, monthlyCapUsd - spentUsd),
      });
    }
  }
}
