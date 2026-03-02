import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { Erc4337Client } from "./erc4337/erc4337_client";
import { KernelAccountService } from "./kernel_account.service";
import { PaymasterService } from "./paymaster.service";
import { WalletProviderRegistry } from "./wallet_provider_registry";

type WalletProviderName = "local" | "erc4337";

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly providerRegistry: WalletProviderRegistry,
    private readonly erc4337Client: Erc4337Client,
    private readonly paymasterService: PaymasterService,
    private readonly kernelAccountService: KernelAccountService,
  ) { }

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

  async refreshWallet(input: { userId: string; provider?: WalletProviderName }) {
    const wallet = await this.getOrCreate(input.userId, input.provider);
    const existingProvider = (wallet as any).provider as WalletProviderName | undefined;
    const provider = this.providerRegistry.getProvider(input.provider ?? existingProvider);
    const account = provider.getAccount(input.userId);
    return prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        address: account.address,
        chainId: account.chainId,
        accountType: account.accountType,
        provider: account.provider,
        ownerAddress: account.ownerAddress,
        entryPoint: account.entryPoint,
        factory: account.factory,
        paymaster: account.paymaster,
        bundler: account.bundler,
        salt: account.salt,
      } as any,
    });
  }

  async setProvider(input: { userId: string; provider: WalletProviderName }) {
    return this.refreshWallet(input);
  }

  configurePaymaster(input: { sponsorMaxUsd: number; paymasterAddress: string }) {
    this.paymasterService.configure(input);
  }

  getPaymasterStatus(userId?: string) {
    return this.paymasterService.getStatus(userId);
  }

  resetPaymaster(userId: string) {
    this.paymasterService.resetUser(userId);
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

    // Emit budget alerts at thresholds
    if (updated.monthlyCapUsd > 0) {
      const pct = (updated.spentUsd / updated.monthlyCapUsd) * 100;
      if (pct >= 80) {
        const level = pct >= 100 ? "exhausted" : pct >= 95 ? "critical" : "warning";
        this.eventBus.publish({
          eventName: "agent.budget_alert",
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          userId,
          level,
          percentUsed: Math.round(pct),
          spentUsd: updated.spentUsd,
          monthlyCapUsd: updated.monthlyCapUsd,
          remainingUsd: Math.max(0, updated.monthlyCapUsd - updated.spentUsd),
        });
      }
    }

    return { allowed: true, remaining: updated.monthlyCapUsd - updated.spentUsd };
  }

  private async getOrCreate(userId: string, provider?: WalletProviderName) {
    const existing = await prisma.wallet.findFirst({ where: { userId } });
    if (existing) {
      return existing;
    }
    const selected =
      provider ??
      ((process.env.WALLET_PROVIDER ?? "erc4337") as WalletProviderName);
    const account = this.providerRegistry.getProvider(selected).getAccount(userId);

    // Ensure User exists before creating Wallet to avoid FK violation
    // Since this is wallet-auth, we might not have an email, so we generate a placeholder.
    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: `${userId}@wallet.placeholder`,
      },
      update: {},
    });

    const wallet = await prisma.wallet.create({
      data: {
        userId,
        address: account.address,
        chainId: account.chainId,
        balanceUsd: 0,
        monthlyCapUsd: 0,
        spentUsd: 0,
        accountType: account.accountType,
        provider: account.provider,
        ownerAddress: account.ownerAddress,
        entryPoint: account.entryPoint,
        factory: account.factory,
        paymaster: account.paymaster,
        bundler: account.bundler,
        salt: account.salt,
      } as any,
    });


    return wallet;
  }
}
