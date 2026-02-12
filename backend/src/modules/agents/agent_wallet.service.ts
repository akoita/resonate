import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { WalletService } from "../identity/wallet.service";
import { SessionKeyService } from "../identity/session_key.service";

const AGENT_SESSION_KEY_SCOPE = "agent:purchase";
const AGENT_SESSION_KEY_TTL = 3600; // 1 hour default

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
}

@Injectable()
export class AgentWalletService {
  private activeSessionKeys = new Map<string, string>(); // userId → token

  constructor(
    private readonly walletService: WalletService,
    private readonly sessionKeyService: SessionKeyService,
    private readonly eventBus: EventBus
  ) {}

  async enable(userId: string): Promise<AgentWalletStatus> {
    // Ensure user has an ERC-4337 wallet
    const wallet = await this.walletService.refreshWallet({
      userId,
      provider: "erc4337",
    });

    // Issue a scoped session key for agent purchases
    const sessionKey = this.sessionKeyService.issue({
      userId,
      scope: AGENT_SESSION_KEY_SCOPE,
      ttlSeconds: AGENT_SESSION_KEY_TTL,
    });
    this.activeSessionKeys.set(userId, sessionKey.token);

    this.eventBus.publish({
      eventName: "agent.wallet_enabled",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      walletAddress: (wallet as any).address,
    });

    return this.getStatus(userId);
  }

  async disable(userId: string): Promise<{ status: string }> {
    this.activeSessionKeys.delete(userId);

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
      };
    }

    const token = this.activeSessionKeys.get(userId);
    let sessionKeyValid = false;
    let sessionKeyExpiresAt: number | null = null;

    if (token) {
      const validation = this.sessionKeyService.validate(
        token,
        AGENT_SESSION_KEY_SCOPE
      );
      sessionKeyValid = validation.valid;
      // Estimate expiry — session key service doesn't expose it,
      // so we track it from the issued TTL
      if (validation.valid) {
        sessionKeyExpiresAt = Date.now() + AGENT_SESSION_KEY_TTL * 1000;
      }
    }

    // Read budget from AgentConfig (same source as the Budget card)
    const agentConfig = await prisma.agentConfig.findUnique({
      where: { userId },
    });
    const budgetCapUsd = agentConfig?.monthlyCapUsd ?? 0;

    // Compute spending from sessions (same as the Budget card)
    const sessions = await prisma.session.findMany({
      where: { userId },
      select: { spentUsd: true },
    });
    const spentUsd = sessions.reduce((sum, s) => sum + s.spentUsd, 0);

    const remaining = budgetCapUsd - spentUsd;
    const alertLevel = this.computeAlertLevel(spentUsd, budgetCapUsd);

    return {
      enabled: (wallet as any).accountType === "erc4337" && sessionKeyValid,
      walletAddress: wallet.address,
      accountType: (wallet as any).accountType ?? "local",
      sessionKeyValid,
      sessionKeyExpiresAt,
      budgetCapUsd,
      spentUsd,
      remainingUsd: Math.max(0, remaining),
      alertLevel,
    };
  }

  validateSessionKey(userId: string): boolean {
    const token = this.activeSessionKeys.get(userId);
    if (!token) return false;
    const result = this.sessionKeyService.validate(
      token,
      AGENT_SESSION_KEY_SCOPE
    );
    return result.valid;
  }

  computeAlertLevel(
    spentUsd: number,
    monthlyCapUsd: number
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
    monthlyCapUsd: number
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
