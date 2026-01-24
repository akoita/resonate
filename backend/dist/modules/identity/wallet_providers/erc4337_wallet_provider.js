"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Erc4337WalletProvider = void 0;
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
let Erc4337WalletProvider = class Erc4337WalletProvider {
    constructor() {
        this.chainId = Number(process.env.AA_CHAIN_ID ?? 8453);
        this.entryPoint = process.env.AA_ENTRY_POINT ?? "0xEntryPoint";
        this.factory = process.env.AA_FACTORY ?? "0xFactory";
        this.paymaster = process.env.AA_PAYMASTER ?? undefined;
        this.bundler = process.env.AA_BUNDLER ?? undefined;
    }
    getAccount(userId) {
        const salt = process.env.AA_SALT ?? "resonate";
        const seed = `${userId}:${this.factory}:${this.entryPoint}:${salt}`;
        const address = `0x${(0, crypto_1.createHash)("sha256").update(seed).digest("hex").slice(0, 40)}`;
        return {
            address,
            chainId: this.chainId,
            accountType: "erc4337",
            provider: "erc4337",
            ownerAddress: userId,
            entryPoint: this.entryPoint,
            factory: this.factory,
            paymaster: this.paymaster,
            bundler: this.bundler,
            salt,
        };
    }
};
exports.Erc4337WalletProvider = Erc4337WalletProvider;
exports.Erc4337WalletProvider = Erc4337WalletProvider = __decorate([
    (0, common_1.Injectable)()
], Erc4337WalletProvider);
