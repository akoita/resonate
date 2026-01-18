import { Injectable } from "@nestjs/common";
import { WalletService } from "../identity/wallet.service";

interface SessionRecord {
  id: string;
  userId: string;
  budgetCapUsd: number;
  spentUsd: number;
  active: boolean;
}

@Injectable()
export class SessionsService {
  private sessions = new Map<string, SessionRecord>();

  constructor(private readonly walletService: WalletService) {}

  startSession(input: { userId: string; budgetCapUsd: number }) {
    this.walletService.setBudget({
      userId: input.userId,
      monthlyCapUsd: input.budgetCapUsd,
    });
    const session: SessionRecord = {
      id: this.generateId("ses"),
      userId: input.userId,
      budgetCapUsd: input.budgetCapUsd,
      spentUsd: 0,
      active: true,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  stopSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { sessionId, status: "not_found" };
    }
    session.active = false;
    return { sessionId, status: "stopped", spentUsd: session.spentUsd };
  }

  playTrack(input: { sessionId: string; trackId: string; priceUsd: number }) {
    const session = this.sessions.get(input.sessionId);
    if (!session || !session.active) {
      return { allowed: false, reason: "session_inactive" };
    }
    const spend = this.walletService.spend(session.userId, input.priceUsd);
    if (!spend.allowed) {
      return { allowed: false, reason: "budget_exceeded", remaining: spend.remaining };
    }
    session.spentUsd += input.priceUsd;
    return {
      allowed: true,
      trackId: input.trackId,
      spentUsd: session.spentUsd,
      remaining: spend.remaining,
    };
  }

  private generateId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }
}
