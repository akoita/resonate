import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { Erc4337Client, UserOperation } from "./erc4337/erc4337_client";
import { WalletProviderRegistry } from "./wallet_provider_registry";

type WalletProviderName = "local" | "erc4337";

@Injectable()
export class WalletService {
  constructor(
    private readonly eventBus: EventBus,
    private readonly providerRegistry: WalletProviderRegistry,
    private readonly erc4337Client: Erc4337Client
  ) {}

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

  async deploySmartAccount(input: { userId: string }) {
    const wallet = (await this.getOrCreate(input.userId, "erc4337")) as any;
    if (wallet.deploymentTxHash) {
      return wallet;
    }
    const userOp: UserOperation = {
      sender: wallet.address,
      nonce: "0x0",
      initCode: wallet.factory ? wallet.factory : "0x",
      callData: "0x",
      callGasLimit: "0x5208",
      verificationGasLimit: "0x100000",
      preVerificationGas: "0x5208",
      maxFeePerGas: "0x3b9aca00",
      maxPriorityFeePerGas: "0x3b9aca00",
      paymasterAndData: wallet.paymaster ?? "0x",
      signature: "0x",
    };
    const userOpHash = await this.erc4337Client.sendUserOperation(userOp);
    return prisma.wallet.update({
      where: { id: wallet.id },
      data: { deploymentTxHash: userOpHash } as any,
    });
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

  private async getOrCreate(userId: string, provider?: WalletProviderName) {
    const existing = await prisma.wallet.findFirst({ where: { userId } });
    if (existing) {
      return existing;
    }
    const selected =
      provider ??
      ((process.env.WALLET_PROVIDER ?? "local") as WalletProviderName);
    const account = this.providerRegistry.getProvider(selected).getAccount(userId);
    return prisma.wallet.create({
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
  }
}
