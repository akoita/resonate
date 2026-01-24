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
exports.WalletProviderRegistry = void 0;
const common_1 = require("@nestjs/common");
const erc4337_wallet_provider_1 = require("./wallet_providers/erc4337_wallet_provider");
const local_wallet_provider_1 = require("./wallet_providers/local_wallet_provider");
let WalletProviderRegistry = class WalletProviderRegistry {
    constructor(localProvider, erc4337Provider) {
        this.localProvider = localProvider;
        this.erc4337Provider = erc4337Provider;
    }
    getProvider(name) {
        if (name === "erc4337") {
            return this.erc4337Provider;
        }
        return this.localProvider;
    }
};
exports.WalletProviderRegistry = WalletProviderRegistry;
exports.WalletProviderRegistry = WalletProviderRegistry = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [local_wallet_provider_1.LocalWalletProvider,
        erc4337_wallet_provider_1.Erc4337WalletProvider])
], WalletProviderRegistry);
