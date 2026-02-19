"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentityModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const erc4337_client_1 = require("./erc4337/erc4337_client");
const kernel_account_service_1 = require("./kernel_account.service");
const session_key_service_1 = require("./session_key.service");
const zerodev_session_key_service_1 = require("./zerodev_session_key.service");
const social_recovery_service_1 = require("./social_recovery.service");
const paymaster_service_1 = require("./paymaster.service");
const wallet_controller_1 = require("./wallet.controller");
const wallet_service_1 = require("./wallet.service");
const erc4337_wallet_provider_1 = require("./wallet_providers/erc4337_wallet_provider");
const local_wallet_provider_1 = require("./wallet_providers/local_wallet_provider");
const wallet_provider_registry_1 = require("./wallet_provider_registry");
const shared_module_1 = require("../shared/shared.module");
const agents_module_1 = require("../agents/agents.module");
let IdentityModule = class IdentityModule {
};
exports.IdentityModule = IdentityModule;
exports.IdentityModule = IdentityModule = __decorate([
    (0, common_1.Module)({
        imports: [shared_module_1.SharedModule, (0, common_1.forwardRef)(() => agents_module_1.AgentsModule)],
        controllers: [wallet_controller_1.WalletController],
        providers: [
            wallet_service_1.WalletService,
            session_key_service_1.SessionKeyService,
            zerodev_session_key_service_1.ZeroDevSessionKeyService,
            social_recovery_service_1.SocialRecoveryService,
            local_wallet_provider_1.LocalWalletProvider,
            erc4337_wallet_provider_1.Erc4337WalletProvider,
            wallet_provider_registry_1.WalletProviderRegistry,
            paymaster_service_1.PaymasterService,
            kernel_account_service_1.KernelAccountService,
            {
                provide: erc4337_client_1.Erc4337Client,
                inject: [config_1.ConfigService],
                useFactory: (config) => {
                    const bundler = config.get("AA_BUNDLER") || "http://localhost:4337";
                    // ERC-4337 v0.6 canonical entry point
                    const entryPoint = config.get("AA_ENTRY_POINT") || "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
                    return new erc4337_client_1.Erc4337Client(bundler, entryPoint);
                },
            },
        ],
        exports: [
            wallet_service_1.WalletService,
            session_key_service_1.SessionKeyService,
            zerodev_session_key_service_1.ZeroDevSessionKeyService,
            wallet_provider_registry_1.WalletProviderRegistry,
            paymaster_service_1.PaymasterService,
            erc4337_client_1.Erc4337Client,
            kernel_account_service_1.KernelAccountService,
        ],
    })
], IdentityModule);
