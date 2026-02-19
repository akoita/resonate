"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var WalletService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletService = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../../db/prisma");
const event_bus_1 = require("../shared/event_bus");
const erc4337_client_1 = require("./erc4337/erc4337_client");
const kernel_account_service_1 = require("./kernel_account.service");
const paymaster_service_1 = require("./paymaster.service");
const wallet_provider_registry_1 = require("./wallet_provider_registry");
let WalletService = WalletService_1 = class WalletService {
    eventBus;
    providerRegistry;
    erc4337Client;
    paymasterService;
    kernelAccountService;
    logger = new common_1.Logger(WalletService_1.name);
    constructor(eventBus, providerRegistry, erc4337Client, paymasterService, kernelAccountService) {
        this.eventBus = eventBus;
        this.providerRegistry = providerRegistry;
        this.erc4337Client = erc4337Client;
        this.paymasterService = paymasterService;
        this.kernelAccountService = kernelAccountService;
    }
    async fundWallet(input) {
        const wallet = await this.getOrCreate(input.userId);
        const updated = await prisma_1.prisma.wallet.update({
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
    async setBudget(input) {
        const wallet = await this.getOrCreate(input.userId);
        const updated = await prisma_1.prisma.wallet.update({
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
    async getWallet(userId) {
        return this.getOrCreate(userId);
    }
    async refreshWallet(input) {
        const wallet = await this.getOrCreate(input.userId, input.provider);
        const existingProvider = wallet.provider;
        const provider = this.providerRegistry.getProvider(input.provider ?? existingProvider);
        const account = provider.getAccount(input.userId);
        return prisma_1.prisma.wallet.update({
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
            },
        });
    }
    async setProvider(input) {
        return this.refreshWallet(input);
    }
    configurePaymaster(input) {
        this.paymasterService.configure(input);
    }
    getPaymasterStatus(userId) {
        return this.paymasterService.getStatus(userId);
    }
    resetPaymaster(userId) {
        this.paymasterService.resetUser(userId);
    }
    async deploySmartAccount(input) {
        const wallet = (await this.getOrCreate(input.userId, "erc4337"));
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
            const txHash = await kernelClient.sendTransaction({
                to: account.address,
                data: "0x",
                value: BigInt(0),
            });
            this.logger.log(`Smart account deployed at ${account.address}, tx: ${txHash}`);
            // Update wallet record with real smart account address and deployment info
            return prisma_1.prisma.wallet.update({
                where: { id: wallet.id },
                data: {
                    address: account.address,
                    deploymentTxHash: txHash,
                    accountType: "kernel",
                },
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Smart account deployment failed: ${message}`);
            if (message.includes("fetch") || message.includes("ECONNREFUSED")) {
                throw new Error("Bundler not reachable. Ensure the AA bundler is running at " +
                    (process.env.AA_BUNDLER || "http://localhost:4337"));
            }
            throw new Error(`Smart account deployment failed: ${message}`);
        }
    }
    async spend(userId, amountUsd) {
        const wallet = await this.getOrCreate(userId);
        if (wallet.balanceUsd < amountUsd) {
            return { allowed: false, remaining: wallet.monthlyCapUsd - wallet.spentUsd };
        }
        if (wallet.spentUsd + amountUsd > wallet.monthlyCapUsd) {
            return { allowed: false, remaining: wallet.monthlyCapUsd - wallet.spentUsd };
        }
        const updated = await prisma_1.prisma.wallet.update({
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
    async getOrCreate(userId, provider) {
        const existing = await prisma_1.prisma.wallet.findFirst({ where: { userId } });
        if (existing) {
            return existing;
        }
        const selected = provider ??
            (process.env.WALLET_PROVIDER ?? "erc4337");
        const account = this.providerRegistry.getProvider(selected).getAccount(userId);
        // Ensure User exists before creating Wallet to avoid FK violation
        // Since this is wallet-auth, we might not have an email, so we generate a placeholder.
        await prisma_1.prisma.user.upsert({
            where: { id: userId },
            create: {
                id: userId,
                email: `${userId}@wallet.placeholder`,
            },
            update: {},
        });
        const wallet = await prisma_1.prisma.wallet.create({
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
            },
        });
        // Auto-deploy smart account in the background for AA wallets
        if (selected === "erc4337" && !wallet.deploymentTxHash) {
            this.deploySmartAccount({ userId }).catch((err) => {
                this.logger.warn(`Auto-deploy of smart account for ${userId} failed (will retry on next explicit deploy): ${err instanceof Error ? err.message : String(err)}`);
            });
        }
        return wallet;
    }
};
exports.WalletService = WalletService;
exports.WalletService = WalletService = WalletService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [event_bus_1.EventBus,
        wallet_provider_registry_1.WalletProviderRegistry,
        erc4337_client_1.Erc4337Client,
        paymaster_service_1.PaymasterService,
        kernel_account_service_1.KernelAccountService])
], WalletService);
