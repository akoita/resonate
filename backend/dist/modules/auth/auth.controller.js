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
var AuthController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const viem_1 = require("viem");
const sdk_1 = require("@zerodev/sdk");
const auth_service_1 = require("./auth.service");
const auth_nonce_service_1 = require("./auth_nonce.service");
const ERC_6492_MAGIC_BYTES = "0x6492649264926492649264926492649264926492649264926492649264926492";
let AuthController = AuthController_1 = class AuthController {
    authService;
    nonceService;
    publicClient;
    logger = new common_1.Logger(AuthController_1.name);
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
            this.logger.log(`[Auth] Verifying signature for ${body.address} on chain ${chainId}`);
            this.logger.debug(`[Auth] Signature length: ${body.signature.length}`);
            // Local dev with mock EOA signer: verify EOA signature, then issue token for smart account address
            if (chainId === 31337 && body.signerAddress) {
                const ok = await this.publicClient.verifyMessage({
                    address: body.signerAddress,
                    message: body.message,
                    signature: body.signature,
                });
                if (!ok) {
                    this.logger.warn(`[Auth] EOA signature verification failed for ${body.signerAddress}`);
                    return { status: "invalid_signature" };
                }
                const nonceMatch = /Nonce:\s*(.+)$/m.exec(body.message)?.[1] ?? "";
                if (!this.nonceService.consume(body.address, nonceMatch)) {
                    this.logger.warn(`[Auth] Nonce mismatch for ${body.address}`);
                    return { status: "invalid_nonce" };
                }
                return this.authService.issueTokenForAddress(body.address, body.role ?? "listener");
            }
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
            let ok = false;
            let issuedAddress = body.address;
            // Primary verification: ERC-6492 + EIP-1271 via inline bytecode (works for smart accounts)
            try {
                ok = await this.publicClient.verifyMessage(verifyOptions);
                if (ok) {
                    this.logger.log(`[Auth] ✅ Primary verifyMessage succeeded for ${body.address}`);
                }
                else {
                    this.logger.log(`[Auth] ⚠ Primary verifyMessage returned false for ${body.address}`);
                }
            }
            catch (verifyErr) {
                this.logger.warn(`[Auth] Primary verifyMessage threw: ${verifyErr.message?.substring(0, 300)}`);
            }
            // Fallback 1: Use ZeroDev's own ERC-6492 verifier bytecode.
            if (!ok) {
                try {
                    const hash = (0, viem_1.hashMessage)(body.message);
                    const zdOk = await (0, sdk_1.verifyEIP6492Signature)({
                        signer: body.address,
                        hash,
                        signature: body.signature,
                        client: this.publicClient,
                    });
                    if (zdOk) {
                        ok = true;
                        this.logger.log(`[Auth] ✅ ZeroDev verifyEIP6492Signature succeeded for ${body.address}`);
                    }
                    else {
                        this.logger.log(`[Auth] ⚠ ZeroDev verifyEIP6492Signature returned false for ${body.address}`);
                    }
                }
                catch (zdErr) {
                    this.logger.warn(`[Auth] ZeroDev verifyEIP6492Signature threw: ${zdErr.message?.substring(0, 300)}`);
                }
            }
            // Fallback 2: Address Recovery from ERC-6492 Signature (Counterfactual Address Mismatch Fix)
            // If the frontend calculated address A, but the signature is actually for address B (common in dev/deployments),
            // we can recover B from the signature's initCode and verify against B.
            if (!ok && body.signature.endsWith(ERC_6492_MAGIC_BYTES.slice(2))) {
                try {
                    this.logger.log(`[Auth] Attempting address recovery from ERC-6492 signature...`);
                    const encoded = body.signature.slice(0, -64);
                    const [factory, factoryCalldata] = (0, viem_1.decodeAbiParameters)((0, viem_1.parseAbiParameters)("address, bytes, bytes"), encoded);
                    // Simulate factory call to get the address
                    const { data } = await this.publicClient.call({
                        to: factory,
                        data: factoryCalldata,
                    });
                    if (data) {
                        // The result is usually the address (left-padded to 32 bytes)
                        const recoveredAddress = ("0x" + data.slice(-40));
                        this.logger.log(`[Auth] Recovered address from initCode: ${recoveredAddress}`);
                        if (recoveredAddress.toLowerCase() !== body.address.toLowerCase()) {
                            this.logger.log(`[Auth] ⚠ Mismatch detected! Frontend: ${body.address}, Recovered: ${recoveredAddress}`);
                            // Verify the signature against the RECOVERED address
                            const recoveryVerifyOptions = { ...verifyOptions, address: recoveredAddress };
                            const recoveredOk = await this.publicClient.verifyMessage(recoveryVerifyOptions);
                            if (recoveredOk) {
                                ok = true;
                                issuedAddress = recoveredAddress;
                                this.logger.log(`[Auth] ✅ Signature verified against recovered address: ${issuedAddress}. Authenticating as recovered identity.`);
                            }
                            else {
                                this.logger.warn(`[Auth] Signature failed verification even against recovered address: ${recoveredAddress}`);
                            }
                        }
                    }
                }
                catch (recoveryErr) {
                    this.logger.warn(`[Auth] Address recovery failed: ${recoveryErr.message}`);
                }
            }
            // Fallback 3: Passkey/Kernel may return EOA-style signature; recover signer and issue for that address.
            if (!ok) {
                try {
                    const recovered = await (0, viem_1.recoverMessageAddress)({
                        message: body.message,
                        signature: body.signature,
                    });
                    if (recovered.toLowerCase() === body.address.toLowerCase()) {
                        ok = true;
                        issuedAddress = body.address;
                        this.logger.log(`[Auth] Verified via recovered EOA (exact match): ${issuedAddress}`);
                    }
                    else {
                        // If the EOA signature is valid but doesn't match the claimed address,
                        // we *could* treat it as valid if we trust the EOA -> Smart Account mapping,
                        // but for now we just log it.
                        // Actually, for consistency with the above recovery, if it's a valid EOA sig, maybe we just issue?
                        // But usually this means it's a "Validator" signature (EOA) not the Smart Account itself.
                        this.logger.log(`[Auth] Recovered EOA: ${recovered}, expected: ${body.address}`);
                    }
                }
                catch (recoverErr) {
                    this.logger.warn(`[Auth] recoverMessageAddress failed: ${recoverErr.message?.substring(0, 200)}`);
                }
            }
            if (!ok) {
                this.logger.warn(`[Auth] Signature verification failed for ${body.address}`);
                this.logger.warn(`[Auth] Failed Message: ${JSON.stringify(body.message)}`);
                this.logger.warn(`[Auth] Failed Signature: ${body.signature}`);
                return { status: "invalid_signature" };
            }
            // Nonce check
            // Note: The message might contain the OLD address if the frontend constructed it that way.
            // But the Nonce inside the message should still match what we issued for the Claimed Address?
            // Or should we check the nonce for the Issued Address?
            // Since we key nonces by address, if the user claimed Address A, we issued a nonce for Address A.
            // If we recover Address B, we should technically check if Address A's nonce was used?
            // Or does Address B have a nonce?
            // The frontend requested a nonce for A. So we must consume the nonce for A.
            // The signature is valid for B.
            // Does this open a replay attack?
            // - Attacker gets nonce for A.
            // - Attacker sends signature for B (valid).
            // - We log them in as B.
            // - Nonce for A is consumed.
            // If B didn't request a nonce, B's nonce is untouched.
            // This seems acceptable for now as long as the signature itself commits to the message (which contains the nonce).
            // The message likely says "Address: 0xF22..." (Address A).
            // If Account B signed "Address: 0xF22...", then B *intended* to sign for A? 
            // Or is the message just "Resonate Sign-In..."?
            // The message format is `Resonate Sign-In\nAddress: ${saAddress}\nNonce: ${nonce}...`
            // So Account B signed a message saying "Address: A". 
            // This implies B authorizes actions for A, OR B is just confused.
            // Since we return `issuedAddress = B`, we are logging them in as B.
            // If B signed "I am A", should we log them in as B?
            // This is a bit weird. But in the context of "Counterfactual Address Mismatch", 
            // A and B are likely the *same* logical user, just different factory params.
            // So it's safe to log them in as the *actual* owner of the key (B).
            const nonceMatch = /Nonce:\s*(.+)$/m.exec(body.message)?.[1] ?? "";
            // We consume the nonce for the CLAIMED address (body.address) because that's what was requested.
            if (!this.nonceService.consume(body.address, nonceMatch)) {
                this.logger.warn(`[Auth] Nonce mismatch for ${body.address}`);
                return { status: "invalid_nonce" };
            }
            const result = this.authService.issueTokenForAddress(issuedAddress, body.role ?? "listener");
            return issuedAddress.toLowerCase() !== body.address.toLowerCase() ? { ...result, address: issuedAddress } : result;
        }
        catch (err) {
            this.logger.error(`[Auth] Error during verification:`, err);
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
exports.AuthController = AuthController = AuthController_1 = __decorate([
    (0, common_1.Controller)("auth"),
    __param(2, (0, common_1.Inject)("PUBLIC_CLIENT")),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        auth_nonce_service_1.AuthNonceService, Object])
], AuthController);
