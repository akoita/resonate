import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";

@Injectable()
export class WalletService {
  async fundWallet(input: { userId: string; amountUsd: number }) {
    const wallet = await this.getOrCreate(input.userId);
    return prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceUsd: wallet.balanceUsd + input.amountUsd },
    });
  }

  async setBudget(input: { userId: string; monthlyCapUsd: number }) {
    const wallet = await this.getOrCreate(input.userId);
    return prisma.wallet.update({
      where: { id: wallet.id },
      data: { monthlyCapUsd: input.monthlyCapUsd },
    });
  }

  async getWallet(userId: string) {
    return this.getOrCreate(userId);
  }

  async spend(userId: string, amountUsd: number) {
    const wallet = await this.getOrCreate(userId);
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
