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
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [
            passport_1.PassportModule,
            audit_module_1.AuditModule,
            jwt_1.JwtModule.registerAsync({
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    secret: config.get("JWT_SECRET") || "dev-secret",
                    signOptions: { expiresIn: "15m" },
                }),
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
                    const rpcUrl = config.get("AA_BUNDLER") || "http://localhost:4337";
                    return (0, viem_1.createPublicClient)({
                        chain: chains_1.sepolia,
                        transport: rpcUrl.startsWith("http") ? (0, viem_1.http)(rpcUrl) : (0, viem_1.http)(),
                    });
                },
            },
        ],
        exports: [auth_service_1.AuthService, "PUBLIC_CLIENT"],
    })
], AuthModule);
