import { Body, Controller, Inject, Post, Logger } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { recoverMessageAddress, hashMessage, hashTypedData, decodeAbiParameters, toBytes, fromHex, type Hex, type PublicClient } from "viem";
import { p256 } from "@noble/curves/p256";
import * as crypto from "crypto";
import { AuthService } from "./auth.service";
import { AuthNonceService } from "./auth_nonce.service";

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
      // The Kernel account's signMessage wraps the EIP-191 messageHash in an
      // EIP-712 hashTypedData({Kernel: [{hash: messageHash}]}) before signing.
      // We must replicate this wrapping when verifying.
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

      // Fallback 2: Off-chain WebAuthn P-256 verification (for undeployed Kernel v0.7 + passkey)
      // On-chain isValidSignature fails for undeployed accounts with secondary passkey validators.
      // We verify the signature directly: extract pubkey from factory calldata, verify P-256 sig.
      if (!ok && body.signature.endsWith(ERC_6492_MAGIC_BYTES)) {
        try {
          // ZeroDev v3.1 signatures no longer contain the factory calldata required 
          // to extract the P-256 public key off-chain in the same layout.
          // We will attempt it, but catch the point extraction error gracefully.
          this.logger.log(`[Auth] Trying off-chain WebAuthn P-256 verification...`);
          ok = this.verifyPasskeyOffChain(body.address, body.message, body.signature, chainId);
          if (ok) {
            this.logger.log(`[Auth] ✅ Off-chain WebAuthn P-256 verification succeeded for ${body.address}`);
          } else {
            this.logger.log(`[Auth] ⚠ Off-chain WebAuthn P-256 verification returned false for ${body.address}`);
          }
        } catch (p256Err) {
          this.logger.warn(`[Auth] Off-chain WebAuthn verification failed: ${(p256Err as Error).message?.substring(0, 300)}`);
        }
      }

      // Fallback 3: Passkey/Kernel may return EOA-style signature; recover signer and issue for that address.
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
            // If the EOA signature is valid but doesn't match the claimed address,
            // we *could* treat it as valid if we trust the EOA -> Smart Account mapping,
            // but for now we just log it.
            // Actually, for consistency with the above recovery, if it's a valid EOA sig, maybe we just issue?
            // But usually this means it's a "Validator" signature (EOA) not the Smart Account itself.
             this.logger.log(`[Auth] Recovered EOA: ${recovered}, expected: ${body.address}`);
          }
        } catch (recoverErr) {
           this.logger.warn(`[Auth] recoverMessageAddress failed: ${(recoverErr as Error).message?.substring(0, 200)}`);
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
  ): boolean {
    // 1. Strip ERC-6492 magic suffix and decode the outer wrapper
    const sigBody = ("0x" + signature.slice(2).slice(0, -64)) as Hex;
    const [, factoryCalldata, innerSig] = decodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }, { type: "bytes" }],
      sigBody,
    );

    // 2. Parse inner signature: mode byte (1) + validator address (20) = 21 bytes = 42 hex chars
    const innerHex = innerSig as Hex;
    const afterValidator = ("0x" + (innerHex as string).slice(44)) as Hex;

    const [authenticatorData, clientDataJSON, , r, s] = decodeAbiParameters(
      [
        { type: "bytes" },
        { type: "string" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bool" },
      ],
      afterValidator,
    );

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
      return false;
    }
    this.logger.debug(`[Auth] P-256: challenge matches ✅`);

    // 4. Extract public key from factory calldata
    const fcHex = (factoryCalldata as Hex).slice(2);
    // createAccount(address impl, bytes initData, uint256 salt)
    const [, initData] = decodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }, { type: "uint256" }],
      ("0x" + fcHex.substring(8)) as Hex,
    );

    const initHex = (initData as Hex).slice(2);
    // Skip selector (4 bytes = 8 hex), then parse initData params:
    // bytes21 validatorId (static, 32 bytes padded)
    // address hook (static, 32 bytes)
    // bytes validatorData (dynamic, offset at position 2)
    // bytes hookData (dynamic)
    // bytes[] initConfig (dynamic)
    const initParams = initHex.substring(8);
    const vdOffset = parseInt(initParams.substring(128, 192), 16);
    const vdLength = parseInt(initParams.substring(vdOffset * 2, vdOffset * 2 + 64), 16);
    const vdData = initParams.substring(vdOffset * 2 + 64, vdOffset * 2 + 64 + vdLength * 2);

    // enableData = abi.encode((uint256 x, uint256 y), bytes32 authenticatorIdHash)
    // Layout: x (32 bytes) || y (32 bytes) || authenticatorIdHash (32 bytes)
    if (vdData.length < 192) {
      this.logger.warn(`[Auth] P-256: validatorData too short: ${vdData.length}`);
      return false;
    }

    const pubX = BigInt("0x" + vdData.substring(0, 64));
    const pubY = BigInt("0x" + vdData.substring(64, 128));
    const pubKeyHex = "04" + pubX.toString(16).padStart(64, "0") + pubY.toString(16).padStart(64, "0");

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
    return isValid;
  }
}
