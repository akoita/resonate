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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const auth_service_1 = require("./auth.service");
const auth_nonce_service_1 = require("./auth_nonce.service");
let AuthController = class AuthController {
    authService;
    nonceService;
    publicClient;
    constructor(authService, nonceService, publicClient) {
        this.authService = authService;
        this.nonceService = nonceService;
        this.publicClient = publicClient;
    }
    login(body) {
        return this.authService.issueToken(body.userId, body.role ?? "listener");
    }
    nonce(body) {
        return { nonce: this.nonceService.issue(body.address) };
    }
    async verify(body) {
        try {
            const chainId = await this.publicClient.getChainId();
            console.log(`[Auth] Verifying signature for ${body.address} on chain ${chainId}`);
            console.log(`[Auth] Signature length: ${body.signature.length}`);
            const verifyOptions = {
                address: body.address,
                message: body.message,
                signature: body.signature,
            };
            // In local development, we must point to our deployed UniversalSigValidator
            // since the canonical ones don't exist on Anvil.
            if (chainId === 31337) {
                verifyOptions.universalSignatureValidatorAddress = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
            }
            const ok = await this.publicClient.verifyMessage(verifyOptions);
            if (!ok) {
                console.warn(`[Auth] Signature verification failed for ${body.address}`);
                return { status: "invalid_signature" };
            }
            const nonceMatch = /Nonce:\s*(.+)$/m.exec(body.message)?.[1] ?? "";
            if (!this.nonceService.consume(body.address, nonceMatch)) {
                console.warn(`[Auth] Nonce mismatch for ${body.address}`);
                return { status: "invalid_nonce" };
            }
            return this.authService.issueTokenForAddress(body.address, body.role ?? "listener");
        }
        catch (err) {
            console.error(`[Auth] Error during verification:`, err);
            return { status: "error", message: err.message };
        }
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)("login"),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60 } }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)("nonce"),
    (0, throttler_1.Throttle)({ default: { limit: 20, ttl: 60 } }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "nonce", null);
__decorate([
    (0, common_1.Post)("verify"),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60 } }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "verify", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)("auth"),
    __param(2, (0, common_1.Inject)("PUBLIC_CLIENT")),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        auth_nonce_service_1.AuthNonceService, Object])
], AuthController);
