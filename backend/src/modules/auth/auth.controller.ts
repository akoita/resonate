import { Body, Controller, Inject, Post, Logger } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { recoverMessageAddress, hashMessage, hashTypedData, decodeAbiParameters, toBytes, fromHex, type Hex, type PublicClient } from "viem";
import { p256 } from "@noble/curves/p256";
import * as crypto from "crypto";
import { AuthService } from "./auth.service";
import { AuthNonceService } from "./auth_nonce.service";
import { AbiCoder } from "ethers";
import { prisma } from "../../db/prisma";

const ERC_6492_MAGIC_BYTES = "6492649264926492649264926492649264926492649264926492649264926492";



@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly nonceService: AuthNonceService,
    @Inject("PUBLIC_CLIENT") private readonly publicClient: PublicClient
  ) { }

  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60 } })
  login(@Body() body: { userId: string; role?: string }) {
    return this.authService.issueToken(body.userId, body.role ?? "listener");
  }

  @Post("nonce")
  @Throttle({ default: { limit: 20, ttl: 60 } })
  nonce(@Body() body: { address: string }) {
    return { nonce: this.nonceService.issue(body.address) };
  }

  @Post("verify")
  @Throttle({ default: { limit: 10, ttl: 60 } })
  async verify(
    @Body()
    body: {
      address: string;
      message: string;
      signature: `0x${string}`;
      role?: string;
      /** Local dev (31337): EOA that signed; we verify this and issue token for address (smart account) */
      signerAddress?: string;
      /** P-256 WebAuthn public key X coordinate (hex, no 0x prefix) — sent by frontend for cross-device persistence */
      pubKeyX?: string;
      /** P-256 WebAuthn public key Y coordinate (hex, no 0x prefix) */
      pubKeyY?: string;
    }
  ) {
    try {
      const chainId = await this.publicClient.getChainId();
      this.logger.log(`[Auth] Verifying signature for ${body.address} on chain ${chainId}`);
      this.logger.debug(`[Auth] Signature length: ${body.signature.length}`);

      // Local dev with mock EOA signer: verify EOA signature, then issue token for smart account address
      if (chainId === 31337 && body.signerAddress) {
        const ok = await this.publicClient.verifyMessage({
          address: body.signerAddress as `0x${string}`,
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

      const verifyOptions: any = {
        address: body.address as `0x${string}`,
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
      let extractedPubKey: { x: string; y: string } | undefined;

      // If the frontend sent the P-256 public key, use it as a source
      if (body.pubKeyX && body.pubKeyY) {
        this.logger.log(`[Auth] Frontend sent P-256 public key — will persist if verification succeeds`);
      }

      // Load existing public key from DB for all verification paths
      const walletInfo = await prisma.wallet.findFirst({
        where: { address: { equals: body.address, mode: "insensitive" } },
      });
      const dbPubX = walletInfo?.pubKeyX ?? undefined;
      const dbPubY = walletInfo?.pubKeyY ?? undefined;
      if (dbPubX && dbPubY) {
        this.logger.debug(`[Auth] Found existing P-256 public key in DB for ${body.address}`);
      }

      // Primary verification: ERC-6492 + EIP-1271 via inline bytecode (works for smart accounts)
      try {
        ok = await this.publicClient.verifyMessage(verifyOptions);
        if (ok) {
          this.logger.log(`[Auth] ✅ Primary verifyMessage succeeded for ${body.address}`);
        } else {
          this.logger.log(`[Auth] ⚠ Primary verifyMessage returned false for ${body.address}`);
        }
      } catch (verifyErr) {
        this.logger.warn(`[Auth] Primary verifyMessage threw: ${(verifyErr as Error).message?.substring(0, 300)}`);
      }

      // Fallback 1: EIP-712 Kernel Wrapper Verification (ZeroDev Kernel v0.7)
      if (!ok) {
        try {
          const messageHash = hashMessage(body.message);
          this.logger.log(`[Auth] Trying EIP-712 Kernel wrapper verification...`);
          const kernelOk = await this.publicClient.verifyTypedData({
            address: body.address as `0x${string}`,
            domain: {
              name: "Kernel",
              version: "0.3.1",
              chainId,
              verifyingContract: body.address as `0x${string}`,
            },
            types: {
              Kernel: [{ name: "hash", type: "bytes32" }],
            },
            primaryType: "Kernel" as const,
            message: {
              hash: messageHash,
            },
            signature: body.signature,
          });
          if (kernelOk) {
            ok = true;
            this.logger.log(`[Auth] ✅ EIP-712 Kernel verifyTypedData succeeded for ${body.address}`);
          } else {
            this.logger.log(`[Auth] ⚠ EIP-712 Kernel verifyTypedData returned false for ${body.address}`);
          }
        } catch (kernelErr) {
          this.logger.warn(`[Auth] EIP-712 Kernel verifyTypedData threw: ${(kernelErr as Error).message?.substring(0, 300)}`);
        }
      }

      // Fallback 2: Off-chain WebAuthn P-256 verification
      // Works for both deployed (raw sig) and undeployed (ERC-6492 wrapped) accounts
      if (!ok) {
        try {
          this.logger.log(`[Auth] Trying off-chain WebAuthn P-256 verification...`);
          // Use frontend-provided key as fallback when DB key is missing (cross-device scenario)
          const effectivePubX = dbPubX ?? body.pubKeyX;
          const effectivePubY = dbPubY ?? body.pubKeyY;
          const p256Result = this.verifyPasskeyOffChain(body.address, body.message, body.signature, chainId, effectivePubX, effectivePubY);
          
          if (p256Result.isValid) {
            ok = true;
            if (p256Result.pubX && p256Result.pubY && (!dbPubX || !dbPubY)) {
              extractedPubKey = { x: p256Result.pubX, y: p256Result.pubY };
            }
            this.logger.log(`[Auth] ✅ Off-chain WebAuthn P-256 verification succeeded for ${body.address}`);
          } else {
            this.logger.log(`[Auth] ⚠ Off-chain WebAuthn P-256 verification returned false for ${body.address}`);
          }
        } catch (p256Err) {
          this.logger.warn(`[Auth] Off-chain WebAuthn verification failed: ${(p256Err as Error).message?.substring(0, 300)}`);
        }
      }

      // Fallback 3: EOA recovery
      if (!ok) {
        try {
          const recovered = await recoverMessageAddress({
            message: body.message,
            signature: body.signature,
          });
          if (recovered.toLowerCase() === body.address.toLowerCase()) {
            ok = true;
            issuedAddress = body.address;
            this.logger.log(`[Auth] Verified via recovered EOA (exact match): ${issuedAddress}`);
          } else {
            this.logger.log(`[Auth] Recovered EOA: ${recovered}, expected: ${body.address}`);
          }
        } catch (recoverErr) {
          this.logger.warn(`[Auth] recoverMessageAddress failed: ${(recoverErr as Error).message?.substring(0, 200)}`);
        }
      }

      // Even if verification succeeded via on-chain path, persist the P-256
      // public key for future cross-device off-chain verification.
      // Sources (in priority order): signature extraction, frontend-provided, DB
      if (ok && !extractedPubKey && !dbPubX) {
        // Try extracting from ERC-6492 wrapped signature
        try {
          const keyResult = this.extractPubKeyFromSignature(body.signature);
          if (keyResult) {
            extractedPubKey = keyResult;
            this.logger.log(`[Auth] Extracted P-256 public key from ERC-6492 signature`);
          }
        } catch {
          // Best-effort
        }

        // Use frontend-provided key if nothing else worked
        if (!extractedPubKey && body.pubKeyX && body.pubKeyY) {
          try {
            // Validate it's a real P-256 point before trusting the frontend
            const testKey = "04" + body.pubKeyX + body.pubKeyY;
            p256.ProjectivePoint.fromHex(testKey);
            extractedPubKey = { x: body.pubKeyX, y: body.pubKeyY };
            this.logger.log(`[Auth] Using frontend-provided P-256 public key`);
          } catch {
            this.logger.warn(`[Auth] Frontend-provided P-256 key is invalid, ignoring`);
          }
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
          await prisma.user.upsert({
            where: { id: lowerAddress },
            create: { id: lowerAddress, email: `${lowerAddress}@wallet.placeholder` },
            update: {},
          });
          await prisma.wallet.upsert({
            where: { userId: lowerAddress },
            create: {
              userId: lowerAddress,
              address: lowerAddress,
              chainId,
              pubKeyX: extractedPubKey.x,
              pubKeyY: extractedPubKey.y,
            } as any,
            update: {
              pubKeyX: extractedPubKey.x,
              pubKeyY: extractedPubKey.y,
            },
          });
          this.logger.log(`[Auth] Saved extracted WebAuthn P-256 public key for ${lowerAddress}`);
        } catch (dbErr) {
          this.logger.error(`[Auth] Failed to save WebAuthn public key to DB:`, dbErr);
        }
      }
      
      const result = this.authService.issueTokenForAddress(issuedAddress, body.role ?? "listener");
      return issuedAddress.toLowerCase() !== body.address.toLowerCase() ? { ...result, address: issuedAddress } : result;
    } catch (err) {
      this.logger.error(`[Auth] Error during verification:`, err);
      return { status: "error", message: (err as Error).message };
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
  private verifyPasskeyOffChain(
    address: string,
    message: string,
    signature: `0x${string}`,
    chainId: number,
    dbPubX?: string,
    dbPubY?: string,
  ): { isValid: boolean; pubX?: string; pubY?: string } {
    const isWrapped = signature.endsWith(ERC_6492_MAGIC_BYTES);
    let innerSig: string = signature;
    let extractedPubX: string | undefined = undefined;
    let extractedPubY: string | undefined = undefined;

    if (isWrapped) {
      // 1. Strip ERC-6492 magic suffix and decode the outer wrapper
      const sigBody = ("0x" + signature.slice(2).slice(0, -64)) as Hex;
      const [, factoryCalldata, decodedInnerSig] = decodeAbiParameters(
        [{ type: "address" }, { type: "bytes" }, { type: "bytes" }],
        sigBody,
      );
      innerSig = decodedInnerSig as string;

      // 4. Extract public key from factory calldata
      const fcHex = (factoryCalldata as Hex).slice(2);
      const [, initData] = decodeAbiParameters(
        [{ type: "address" }, { type: "bytes" }, { type: "uint256" }],
        ("0x" + fcHex.substring(8)) as Hex,
      );

      const initHex = (initData as Hex).slice(2);
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
    p256.ProjectivePoint.fromHex(pubKeyHex);

    // 2. Parse inner signature: mode byte (1) + validator address (20) = 21 bytes = 42 hex chars
    const afterValidator = ("0x" + innerSig.slice(44)) as Hex;

    const coder = new AbiCoder();
    const ethersDecoded = coder.decode(
      ["bytes", "string", "uint256", "uint256", "uint256", "bool"],
      afterValidator,
    );

    const authenticatorData = ethersDecoded[0] as string;
    const clientDataJSON = ethersDecoded[1] as string;
    const r = ethersDecoded[3] as bigint;
    const s = ethersDecoded[4] as bigint;

    // 3. Verify challenge matches EIP-712 Kernel hash
    const messageHash = hashMessage(message);
    const kernelHash = hashTypedData({
      domain: {
        name: "Kernel",
        version: "0.3.1",
        chainId,
        verifyingContract: address as `0x${string}`,
      },
      types: { Kernel: [{ name: "hash", type: "bytes32" }] },
      primaryType: "Kernel",
      message: { hash: messageHash },
    });

    // Convert hash to base64url for comparison with WebAuthn challenge
    const hashBytes = fromHex(kernelHash, "bytes");
    let b64 = "";
    for (const b of hashBytes) b64 += String.fromCharCode(b);
    const expectedChallenge = btoa(b64)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const clientData = JSON.parse(clientDataJSON as string);
    if (clientData.challenge !== expectedChallenge) {
      this.logger.warn(`[Auth] P-256: challenge mismatch: got ${clientData.challenge}, expected ${expectedChallenge}`);
      return { isValid: false };
    }
    this.logger.debug(`[Auth] P-256: challenge matches ✅`);

    // Validate it's a real P-256 point (throws if invalid)
    p256.ProjectivePoint.fromHex(pubKeyHex);

    // 5. Verify P-256 signature
    const authDataBytes = toBytes(authenticatorData as Hex);
    const clientDataHash = crypto.createHash("sha256").update(clientDataJSON as string).digest();
    const signedData = Buffer.concat([Buffer.from(authDataBytes), clientDataHash]);
    const signedDataHash = crypto.createHash("sha256").update(signedData).digest();

    const sigHex =
      (r as bigint).toString(16).padStart(64, "0") +
      (s as bigint).toString(16).padStart(64, "0");

    const isValid = p256.verify(sigHex, signedDataHash, pubKeyHex);
    return { isValid, pubX: extractedPubX, pubY: extractedPubY };
  }

  /**
   * Best-effort extraction of P-256 public key from an ERC-6492 wrapped signature.
   * Used to persist the key after first login so cross-device auth works off-chain.
   */
  private extractPubKeyFromSignature(signature: `0x${string}`): { x: string; y: string } | null {
    const isWrapped = signature.endsWith(ERC_6492_MAGIC_BYTES);
    if (!isWrapped) return null;

    try {
      const sigBody = ("0x" + signature.slice(2).slice(0, -64)) as Hex;
      const [, factoryCalldata] = decodeAbiParameters(
        [{ type: "address" }, { type: "bytes" }, { type: "bytes" }],
        sigBody,
      );

      const fcHex = (factoryCalldata as Hex).slice(2);
      const [, initData] = decodeAbiParameters(
        [{ type: "address" }, { type: "bytes" }, { type: "uint256" }],
        ("0x" + fcHex.substring(8)) as Hex,
      );

      const initHex = (initData as Hex).slice(2);
      const initParams = initHex.substring(8);
      const vdOffset = parseInt(initParams.substring(128, 192), 16);
      const vdLength = parseInt(initParams.substring(vdOffset * 2, vdOffset * 2 + 64), 16);
      const vdData = initParams.substring(vdOffset * 2 + 64, vdOffset * 2 + 64 + vdLength * 2);

      if (vdData.length >= 192) {
        const pubX = BigInt("0x" + vdData.substring(0, 64));
        const pubY = BigInt("0x" + vdData.substring(64, 128));
        const x = pubX.toString(16).padStart(64, "0");
        const y = pubY.toString(16).padStart(64, "0");

        // Validate it's a real P-256 point
        p256.ProjectivePoint.fromHex("04" + x + y);
        return { x, y };
      }
    } catch {
      // Not a valid ERC-6492 passkey sig — that's fine
    }
    return null;
  }
}
