import { Injectable } from "@nestjs/common";
import { WalletService } from "../identity/wallet.service";
import { prisma } from "../../db/prisma";

@Injectable()
export class SessionsService {
  constructor(private readonly walletService: WalletService) {}

  async startSession(input: { userId: string; budgetCapUsd: number }) {
    await this.walletService.setBudget({
      userId: input.userId,
      monthlyCapUsd: input.budgetCapUsd,
    });
    return prisma.session.create({
      data: {
        userId: input.userId,
        budgetCapUsd: input.budgetCapUsd,
        spentUsd: 0,
      },
    });
  }

  async stopSession(sessionId: string) {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      return { sessionId, status: "not_found" };
    }
    await prisma.session.update({
      where: { id: sessionId },
      data: { endedAt: new Date() },
    });
    return { sessionId, status: "stopped", spentUsd: session.spentUsd };
  }

  async playTrack(input: { sessionId: string; trackId: string; priceUsd: number }) {
    const session = await prisma.session.findUnique({ where: { id: input.sessionId } });
    if (!session || session.endedAt) {
      return { allowed: false, reason: "session_inactive" };
    }
    const spend = await this.walletService.spend(session.userId, input.priceUsd);
    if (!spend.allowed) {
      return { allowed: false, reason: "budget_exceeded", remaining: spend.remaining };
    }
    const updated = await prisma.session.update({
      where: { id: input.sessionId },
      data: { spentUsd: session.spentUsd + input.priceUsd },
    });
    return {
      allowed: true,
      trackId: input.trackId,
      spentUsd: updated.spentUsd,
      remaining: spend.remaining,
    };
  }
}
