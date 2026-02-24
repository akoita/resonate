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
    const wallet = await this.getOrCreate(userId);
    return wallet;
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

  async deploySmartAccount(input: { userId: string }) {
    const wallet = (await this.getOrCreate(input.userId, "erc4337")) as any;
    if (wallet.deploymentTxHash) {
      return wallet;
    }

    try {
      this.logger.log(`Deploying smart account for user ${input.userId}`);

      // Use KernelAccountService — it handles:
      //   - Deterministic signer creation from userId
      //   - Kernel account creation (counterfactual)
      //   - Account deployment via initCode if not yet on-chain
      //   - Gas estimation + bundler submission
      //   - Falls back to direct EOA send on local Anvil if bundler fails
      const { account, kernelClient } = await this.kernelAccountService.createKernelClient(input.userId);

      // Send a 0-value self-send to force deployment
      // The SDK includes initCode automatically if the account isn't deployed yet
      const txHash = await (kernelClient as any).sendTransaction({
        to: account.address,
        data: "0x" as `0x${string}`,
        value: BigInt(0),
      });

      this.logger.log(`Smart account deployed at ${account.address}, tx: ${txHash}`);

      // Update wallet record with real smart account address and deployment info
      const bundlerUrl = process.env.AA_BUNDLER || "http://localhost:4337";
      return prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          address: account.address,
          deploymentTxHash: txHash,
          accountType: "kernel",
          paymaster: bundlerUrl,
          bundler: bundlerUrl,
        } as any,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Smart account deployment failed: ${message}`);

      if (message.includes("fetch") || message.includes("ECONNREFUSED")) {
        throw new Error(
          "Bundler not reachable. Ensure the AA bundler is running at " +
          (process.env.AA_BUNDLER || "http://localhost:4337")
        );
      }
      throw new Error(`Smart account deployment failed: ${message}`);
    }
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

    // Auto-deploy smart account in the background for AA wallets
    if (selected === "erc4337" && !(wallet as any).deploymentTxHash) {
      this.deploySmartAccount({ userId }).catch((err) => {
        this.logger.warn(
          `Auto-deploy of smart account for ${userId} failed (will retry on next explicit deploy): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    return wallet;
  }
}
