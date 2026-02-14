import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { WalletService } from "../identity/wallet.service";
import { SessionKeyService } from "../identity/session_key.service";
import {
  ZeroDevSessionKeyService,
  type SessionKeyPermissions,
} from "../identity/zerodev_session_key.service";

const AGENT_SESSION_KEY_SCOPE = "agent:purchase";
const AGENT_SESSION_KEY_TTL = 3600; // 1 hour default (mock mode only)

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
  private activeSessionKeys = new Map<string, string>(); // userId → token (mock mode)
  private readonly skipBundler: boolean;
  private readonly explorerUrl: string;

  constructor(
    private readonly walletService: WalletService,
    private readonly sessionKeyService: SessionKeyService,
    private readonly zeroDevSessionKeyService: ZeroDevSessionKeyService,
    private readonly eventBus: EventBus,
    private readonly config: ConfigService,
  ) {
    this.skipBundler =
      this.config.get<string>("AA_SKIP_BUNDLER") === "true";
    this.explorerUrl =
      this.config.get<string>("BLOCK_EXPLORER_URL") ||
      "https://sepolia.etherscan.io";
  }

  /**
   * Enable agent wallet (mock mode only).
   * In self-custodial mode, session keys are registered via registerSessionKey()
   * after the user signs the grant tx on the frontend.
   */
  async enable(userId: string): Promise<AgentWalletStatus> {
    // Ensure user has an ERC-4337 wallet
    const wallet = await this.walletService.refreshWallet({
      userId,
      provider: "erc4337",
    });

    if (this.skipBundler) {
      // Mock mode: issue in-memory session key (backward compat)
      const sessionKey = this.sessionKeyService.issue({
        userId,
        scope: AGENT_SESSION_KEY_SCOPE,
        ttlSeconds: AGENT_SESSION_KEY_TTL,
      });
      this.activeSessionKeys.set(userId, sessionKey.token);
    }
    // In self-custodial mode, the frontend calls registerSessionKey() separately

    this.eventBus.publish({
      eventName: "agent.wallet_enabled",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      walletAddress: (wallet as any).address,
    });

    return this.getStatus(userId);
  }

  /**
   * Register a session key that the user granted from the frontend.
   * Called after the user signs the session key registration tx on-chain.
   */
  async registerSessionKey(
    userId: string,
    serializedKey: string,
    permissions: SessionKeyPermissions,
    validUntil: Date,
    txHash?: string,
  ) {
    return this.zeroDevSessionKeyService.registerSessionKey(
      userId,
      serializedKey,
      permissions,
      validUntil,
      txHash,
    );
  }

  /**
   * Disable agent wallet.
   * In self-custodial mode, the frontend signs the on-chain revocation first,
   * then calls this to mark it revoked in the DB.
   */
  async disable(
    userId: string,
    revokeTxHash?: string,
  ): Promise<{ status: string }> {
    if (this.skipBundler) {
      this.activeSessionKeys.delete(userId);
    } else {
      await this.zeroDevSessionKeyService.markRevoked(userId, revokeTxHash);
    }

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

    if (this.skipBundler) {
      // Mock mode: check in-memory session key
      const token = this.activeSessionKeys.get(userId);
      if (token) {
        const validation = this.sessionKeyService.validate(
          token,
          AGENT_SESSION_KEY_SCOPE,
        );
        sessionKeyValid = validation.valid;
        if (validation.valid) {
          sessionKeyExpiresAt = Date.now() + AGENT_SESSION_KEY_TTL * 1000;
        }
      }
    } else {
      // Self-custodial: check on-chain session key from DB
      const validation =
        await this.zeroDevSessionKeyService.validateSessionKey(userId);
      if (validation && validation.valid && !validation.mock) {
        sessionKeyValid = true;
        sessionKeyExpiresAt = validation.validUntil?.getTime() ?? null;
        sessionKeyTxHash = validation.txHash ?? null;
        sessionKeyPermissions = validation.permissions ?? null;
      }
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

  validateSessionKey(userId: string): boolean | Promise<boolean> {
    if (this.skipBundler) {
      const token = this.activeSessionKeys.get(userId);
      if (!token) return false;
      const result = this.sessionKeyService.validate(
        token,
        AGENT_SESSION_KEY_SCOPE,
      );
      return result.valid;
    }

    // Self-custodial: async validation
    return this.zeroDevSessionKeyService
      .validateSessionKey(userId)
      .then((v) => v?.valid ?? false);
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
