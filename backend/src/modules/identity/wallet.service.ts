import { Injectable } from "@nestjs/common";

interface WalletRecord {
  userId: string;
  balanceUsd: number;
  monthlyCapUsd: number;
  spentUsd: number;
}

@Injectable()
export class WalletService {
  private wallets = new Map<string, WalletRecord>();

  fundWallet(input: { userId: string; amountUsd: number }) {
    const wallet = this.getOrCreate(input.userId);
    wallet.balanceUsd += input.amountUsd;
    return wallet;
  }

  setBudget(input: { userId: string; monthlyCapUsd: number }) {
    const wallet = this.getOrCreate(input.userId);
    wallet.monthlyCapUsd = input.monthlyCapUsd;
    return wallet;
  }

  getWallet(userId: string) {
    return this.getOrCreate(userId);
  }

  spend(userId: string, amountUsd: number) {
    const wallet = this.getOrCreate(userId);
    if (wallet.spentUsd + amountUsd > wallet.monthlyCapUsd) {
      return { allowed: false, remaining: wallet.monthlyCapUsd - wallet.spentUsd };
    }
    wallet.spentUsd += amountUsd;
    wallet.balanceUsd -= amountUsd;
    return { allowed: true, remaining: wallet.monthlyCapUsd - wallet.spentUsd };
  }

  private getOrCreate(userId: string) {
    const existing = this.wallets.get(userId);
    if (existing) {
      return existing;
    }
    const created: WalletRecord = {
      userId,
      balanceUsd: 0,
      monthlyCapUsd: 0,
      spentUsd: 0,
    };
    this.wallets.set(userId, created);
    return created;
  }
}
