import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";

@Injectable()
export class WalletService {
  constructor(private readonly eventBus: EventBus) {}

  async fundWallet(input: { userId: string; amountUsd: number }) {
    const wallet = await this.getOrCreate(input.userId);
    const updated = await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceUsd: wallet.balanceUsd + input.amountUsd },
    });
    this.eventBus.publish({
      eventName: "wallet.funded",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId: input.userId,
      amountUsd: input.amountUsd,
      balanceUsd: updated.balanceUsd,
    });
    return updated;
  }

  async setBudget(input: {
    userId: string;
    monthlyCapUsd: number;
    resetSpent?: boolean;
  }) {
    const wallet = await this.getOrCreate(input.userId);
    const updated = await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        monthlyCapUsd: input.monthlyCapUsd,
        ...(input.resetSpent ? { spentUsd: 0 } : {}),
      },
    });
    this.eventBus.publish({
      eventName: "wallet.budget_set",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId: input.userId,
      monthlyCapUsd: updated.monthlyCapUsd,
    });
    return updated;
  }

  async getWallet(userId: string) {
    return this.getOrCreate(userId);
  }

  async spend(userId: string, amountUsd: number) {
    const wallet = await this.getOrCreate(userId);
    if (wallet.balanceUsd < amountUsd) {
      return { allowed: false, remaining: wallet.monthlyCapUsd - wallet.spentUsd };
    }
    if (wallet.spentUsd + amountUsd > wallet.monthlyCapUsd) {
      return { allowed: false, remaining: wallet.monthlyCapUsd - wallet.spentUsd };
    }
    const updated = await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        spentUsd: wallet.spentUsd + amountUsd,
        balanceUsd: wallet.balanceUsd - amountUsd,
      },
    });
    this.eventBus.publish({
      eventName: "wallet.spent",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      amountUsd,
      spentUsd: updated.spentUsd,
      balanceUsd: updated.balanceUsd,
    });
    return { allowed: true, remaining: updated.monthlyCapUsd - updated.spentUsd };
  }

  private async getOrCreate(userId: string) {
    const existing = await prisma.wallet.findFirst({ where: { userId } });
    if (existing) {
      return existing;
    }
    return prisma.wallet.create({
      data: {
        userId,
        address: `wallet_${userId}`,
        chainId: 0,
        balanceUsd: 0,
        monthlyCapUsd: 0,
        spentUsd: 0,
      },
    });
  }
}
