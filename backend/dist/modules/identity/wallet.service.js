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
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletService = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../../db/prisma");
const event_bus_1 = require("../shared/event_bus");
const erc4337_client_1 = require("./erc4337/erc4337_client");
const paymaster_service_1 = require("./paymaster.service");
const wallet_provider_registry_1 = require("./wallet_provider_registry");
let WalletService = class WalletService {
    eventBus;
    providerRegistry;
    erc4337Client;
    paymasterService;
    constructor(eventBus, providerRegistry, erc4337Client, paymasterService) {
        this.eventBus = eventBus;
        this.providerRegistry = providerRegistry;
        this.erc4337Client = erc4337Client;
        this.paymasterService = paymasterService;
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
        const userOp = {
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
        userOp.paymasterAndData = this.paymasterService.buildPaymasterData(userOp, 0, input.userId);
        const userOpHash = await this.erc4337Client.sendUserOperation(userOp);
        await this.erc4337Client.waitForReceipt(userOpHash);
        return prisma_1.prisma.wallet.update({
            where: { id: wallet.id },
            data: { deploymentTxHash: userOpHash },
        });
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
        return { allowed: true, remaining: updated.monthlyCapUsd - updated.spentUsd };
    }
    async getOrCreate(userId, provider) {
        const existing = await prisma_1.prisma.wallet.findFirst({ where: { userId } });
        if (existing) {
            return existing;
        }
        const selected = provider ??
            (process.env.WALLET_PROVIDER ?? "local");
        const account = this.providerRegistry.getProvider(selected).getAccount(userId);
        return prisma_1.prisma.wallet.create({
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
    }
};
exports.WalletService = WalletService;
exports.WalletService = WalletService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [event_bus_1.EventBus,
        wallet_provider_registry_1.WalletProviderRegistry,
        erc4337_client_1.Erc4337Client,
        paymaster_service_1.PaymasterService])
], WalletService);
