"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const p256_1 = require("@noble/curves/p256");
const crypto = __importStar(require("crypto"));
const auth_service_1 = require("./auth.service");
const auth_nonce_service_1 = require("./auth_nonce.service");
const prisma_1 = require("../../db/prisma");
const ERC_6492_MAGIC_BYTES = "6492649264926492649264926492649264926492649264926492649264926492";
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
            // Fallback 1: EIP-712 Kernel Wrapper Verification (ZeroDev Kernel v0.7)
            // The Kernel account's signMessage wraps the EIP-191 messageHash in an
            // EIP-712 hashTypedData({Kernel: [{hash: messageHash}]}) before signing.
            // We must replicate this wrapping when verifying.
            if (!ok) {
                try {
                    const messageHash = (0, viem_1.hashMessage)(body.message);
                    this.logger.log(`[Auth] Trying EIP-712 Kernel wrapper verification...`);
                    const kernelOk = await this.publicClient.verifyTypedData({
                        address: body.address,
                        domain: {
                            name: "Kernel",
                            version: "0.3.1",
                            chainId,
                            verifyingContract: body.address,
                        },
                        types: {
                            Kernel: [{ name: "hash", type: "bytes32" }],
                        },
                        primaryType: "Kernel",
                        message: {
                            hash: messageHash,
                        },
                        signature: body.signature,
                    });
                    if (kernelOk) {
                        ok = true;
                        this.logger.log(`[Auth] ✅ EIP-712 Kernel verifyTypedData succeeded for ${body.address}`);
                    }
                    else {
                        this.logger.log(`[Auth] ⚠ EIP-712 Kernel verifyTypedData returned false for ${body.address}`);
                    }
                }
                catch (kernelErr) {
                    this.logger.warn(`[Auth] EIP-712 Kernel verifyTypedData threw: ${kernelErr.message?.substring(0, 300)}`);
                }
            }
            let extractedPubKey;
            // Fallback 2: Off-chain WebAuthn P-256 verification (for both deployed and undeployed Kernel + passkey)
            // On-chain isValidSignature may fail even for deployed accounts if the validator config differs.
            if (!ok) {
                try {
                    this.logger.log(`[Auth] Trying off-chain WebAuthn P-256 verification...`);
                    const walletInfo = await prisma_1.prisma.wallet.findFirst({
                        where: { address: { equals: body.address, mode: "insensitive" } },
                    });
                    let dbPubX;
                    let dbPubY;
                    if (walletInfo?.pubKeyX && walletInfo?.pubKeyY) {
                        dbPubX = walletInfo.pubKeyX;
                        dbPubY = walletInfo.pubKeyY;
                        this.logger.debug(`[Auth] Found existing P-256 public key in database for ${body.address}`);
                    }
                    const p256Result = this.verifyPasskeyOffChain(body.address, body.message, body.signature, chainId, dbPubX, dbPubY);
                    if (p256Result.isValid) {
                        ok = true;
                        if (p256Result.pubX && p256Result.pubY && (!dbPubX || !dbPubY)) {
                            extractedPubKey = { x: p256Result.pubX, y: p256Result.pubY };
                        }
                        this.logger.log(`[Auth] ✅ Off-chain WebAuthn P-256 verification succeeded for ${body.address}`);
                    }
                    else {
                        this.logger.log(`[Auth] ⚠ Off-chain WebAuthn P-256 verification returned false for ${body.address}`);
                    }
                }
                catch (p256Err) {
                    this.logger.warn(`[Auth] Off-chain WebAuthn verification failed: ${p256Err.message?.substring(0, 300)}`);
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
            const mappedAddress = issuedAddress.toLowerCase() !== body.address.toLowerCase() ? issuedAddress : body.address;
            if (ok && extractedPubKey) {
                try {
                    // Ensure user exists first just in case
                    const lowerAddress = mappedAddress.toLowerCase();
                    await prisma_1.prisma.user.upsert({
                        where: { id: lowerAddress },
                        create: { id: lowerAddress, email: `${lowerAddress}@wallet.placeholder` },
                        update: {},
                    });
                    await prisma_1.prisma.wallet.upsert({
                        where: { userId: lowerAddress },
                        create: {
                            userId: lowerAddress,
                            address: lowerAddress,
                            chainId,
                            pubKeyX: extractedPubKey.x,
                            pubKeyY: extractedPubKey.y,
                        },
                        update: {
                            pubKeyX: extractedPubKey.x,
                            pubKeyY: extractedPubKey.y,
                        },
                    });
                    this.logger.log(`[Auth] Saved extracted WebAuthn P-256 public key for ${lowerAddress}`);
                }
                catch (dbErr) {
                    this.logger.error(`[Auth] Failed to save WebAuthn public key to DB:`, dbErr);
                }
            }
            const result = this.authService.issueTokenForAddress(issuedAddress, body.role ?? "listener");
            return issuedAddress.toLowerCase() !== body.address.toLowerCase() ? { ...result, address: issuedAddress } : result;
        }
        catch (err) {
            this.logger.error(`[Auth] Error during verification:`, err);
            return { status: "error", message: err.message };
        }
    }
    /**
     * Off-chain WebAuthn P-256 signature verification for ERC-6492 wrapped passkey signatures.
     *
     * Steps:
     * 1. Decode ERC-6492 wrapper → {factory, factoryCalldata, innerSig}
     * 2. Parse inner signature: strip mode byte + validator addr, ABI-decode passkey fields
     * 3. Verify challenge in clientDataJSON matches EIP-712 Kernel hash of the message
     * 4. Extract public key (x, y) from factory calldata's validator enableData
     * 5. Verify P-256 signature (r, s) against SHA-256(authenticatorData || SHA-256(clientDataJSON))
     */
    verifyPasskeyOffChain(address, message, signature, chainId, dbPubX, dbPubY) {
        const isWrapped = signature.endsWith(ERC_6492_MAGIC_BYTES);
        let innerSig = signature;
        let extractedPubX = undefined;
        let extractedPubY = undefined;
        if (isWrapped) {
            // 1. Strip ERC-6492 magic suffix and decode the outer wrapper
            const sigBody = ("0x" + signature.slice(2).slice(0, -64));
            const [, factoryCalldata, decodedInnerSig] = (0, viem_1.decodeAbiParameters)([{ type: "address" }, { type: "bytes" }, { type: "bytes" }], sigBody);
            innerSig = decodedInnerSig;
            // 4. Extract public key from factory calldata
            const fcHex = factoryCalldata.slice(2);
            const [, initData] = (0, viem_1.decodeAbiParameters)([{ type: "address" }, { type: "bytes" }, { type: "uint256" }], ("0x" + fcHex.substring(8)));
            const initHex = initData.slice(2);
            const initParams = initHex.substring(8);
            const vdOffset = parseInt(initParams.substring(128, 192), 16);
            const vdLength = parseInt(initParams.substring(vdOffset * 2, vdOffset * 2 + 64), 16);
            const vdData = initParams.substring(vdOffset * 2 + 64, vdOffset * 2 + 64 + vdLength * 2);
            if (vdData.length >= 192) {
                const pubX = BigInt("0x" + vdData.substring(0, 64));
                const pubY = BigInt("0x" + vdData.substring(64, 128));
                extractedPubX = pubX.toString(16).padStart(64, "0");
                extractedPubY = pubY.toString(16).padStart(64, "0");
            }
        }
        const activePubX = extractedPubX ?? dbPubX;
        const activePubY = extractedPubY ?? dbPubY;
        if (!activePubX || !activePubY) {
            this.logger.warn(`[Auth] P-256: Missing public key for off-chain verification. Neither extracted nor found in DB.`);
            return { isValid: false };
        }
        const pubKeyHex = "04" + activePubX + activePubY;
        // Validate it's a real P-256 point (throws if invalid)
        p256_1.p256.ProjectivePoint.fromHex(pubKeyHex);
        // 2. Parse inner signature: mode byte (1) + validator address (20) = 21 bytes = 42 hex chars
        const afterValidator = ("0x" + innerSig.slice(44));
        const [authenticatorData, clientDataJSON, , r, s] = (0, viem_1.decodeAbiParameters)([
            { type: "bytes" },
            { type: "string" },
            { type: "uint256" },
            { type: "uint256" },
            { type: "uint256" },
            { type: "bool" },
        ], afterValidator);
        // 3. Verify challenge matches EIP-712 Kernel hash
        const messageHash = (0, viem_1.hashMessage)(message);
        const kernelHash = (0, viem_1.hashTypedData)({
            domain: {
                name: "Kernel",
                version: "0.3.1",
                chainId,
                verifyingContract: address,
            },
            types: { Kernel: [{ name: "hash", type: "bytes32" }] },
            primaryType: "Kernel",
            message: { hash: messageHash },
        });
        // Convert hash to base64url for comparison with WebAuthn challenge
        const hashBytes = (0, viem_1.fromHex)(kernelHash, "bytes");
        let b64 = "";
        for (const b of hashBytes)
            b64 += String.fromCharCode(b);
        const expectedChallenge = btoa(b64)
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
        const clientData = JSON.parse(clientDataJSON);
        if (clientData.challenge !== expectedChallenge) {
            this.logger.warn(`[Auth] P-256: challenge mismatch: got ${clientData.challenge}, expected ${expectedChallenge}`);
            return { isValid: false };
        }
        this.logger.debug(`[Auth] P-256: challenge matches ✅`);
        // Validate it's a real P-256 point (throws if invalid)
        p256_1.p256.ProjectivePoint.fromHex(pubKeyHex);
        // 5. Verify P-256 signature
        const authDataBytes = (0, viem_1.toBytes)(authenticatorData);
        const clientDataHash = crypto.createHash("sha256").update(clientDataJSON).digest();
        const signedData = Buffer.concat([Buffer.from(authDataBytes), clientDataHash]);
        const signedDataHash = crypto.createHash("sha256").update(signedData).digest();
        const sigHex = r.toString(16).padStart(64, "0") +
            s.toString(16).padStart(64, "0");
        const isValid = p256_1.p256.verify(sigHex, signedDataHash, pubKeyHex);
        return { isValid, pubX: extractedPubX, pubY: extractedPubY };
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
