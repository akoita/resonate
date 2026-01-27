"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const viem_1 = require("viem");
const chains_1 = require("viem/chains");
const jwt_1 = require("@nestjs/jwt");
const passport_1 = require("@nestjs/passport");
const audit_module_1 = require("../audit/audit.module");
const auth_controller_1 = require("./auth.controller");
const auth_nonce_service_1 = require("./auth_nonce.service");
const auth_service_1 = require("./auth.service");
const jwt_strategy_1 = require("./jwt.strategy");
/**
 * Get chain config based on RPC URL
 * - Local (localhost:8545): Use foundry chain (31337)
 * - Otherwise: Use Sepolia
 */
function getChainFromRpc(rpcUrl) {
    if (rpcUrl?.includes("localhost:8545") || rpcUrl?.includes("127.0.0.1:8545")) {
        return {
            chain: chains_1.foundry,
            transport: (0, viem_1.http)(rpcUrl),
        };
    }
    return {
        chain: chains_1.sepolia,
        transport: rpcUrl ? (0, viem_1.http)(rpcUrl) : (0, viem_1.http)(),
    };
}
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [
            passport_1.PassportModule.register({ defaultStrategy: "jwt" }),
            audit_module_1.AuditModule,
            jwt_1.JwtModule.registerAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: (config) => {
                    const secret = config.get("JWT_SECRET") || "dev-secret";
                    console.log(`[Auth] Registering JwtModule with secret starting with: ${secret.substring(0, 3)}...`);
                    return {
                        secret,
                        signOptions: { expiresIn: "7d" },
                    };
                },
            }),
        ],
        controllers: [auth_controller_1.AuthController],
        providers: [
            auth_service_1.AuthService,
            auth_nonce_service_1.AuthNonceService,
            jwt_strategy_1.JwtStrategy,
            {
                provide: "PUBLIC_CLIENT",
                inject: [config_1.ConfigService],
                useFactory: (config) => {
                    const rpcUrl = config.get("RPC_URL");
                    const { chain, transport } = getChainFromRpc(rpcUrl);
                    console.log(`[Auth] PUBLIC_CLIENT chain: ${chain.name} (${chain.id}), RPC: ${rpcUrl || 'default'}`);
                    return (0, viem_1.createPublicClient)({
                        chain,
                        transport,
                    });
                },
            },
        ],
        exports: [auth_service_1.AuthService, "PUBLIC_CLIENT", passport_1.PassportModule, jwt_strategy_1.JwtStrategy],
    })
], AuthModule);
