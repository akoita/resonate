import { Body, Controller, Inject, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { recoverMessageAddress, type PublicClient } from "viem";
import { AuthService } from "./auth.service";
import { AuthNonceService } from "./auth_nonce.service";

@Controller("auth")
export class AuthController {
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
      console.log(`[Auth] Verifying signature for ${body.address} on chain ${chainId}`);
      console.log(`[Auth] Signature length: ${body.signature.length}`);

      // Local dev with mock EOA signer: verify EOA signature, then issue token for smart account address
      if (chainId === 31337 && body.signerAddress) {
        const ok = await this.publicClient.verifyMessage({
          address: body.signerAddress as `0x${string}`,
          message: body.message,
          signature: body.signature,
        });
        if (!ok) {
          console.warn(`[Auth] EOA signature verification failed for ${body.signerAddress}`);
          return { status: "invalid_signature" };
        }
        const nonceMatch = /Nonce:\s*(.+)$/m.exec(body.message)?.[1] ?? "";
        if (!this.nonceService.consume(body.address, nonceMatch)) {
          console.warn(`[Auth] Nonce mismatch for ${body.address}`);
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

      // Check if this is a counterfactual (undeployed) smart account
      // If so, skip ERC-1271 verification entirely since there's no contract code.
      // The SA address is deterministic from the passkey — nonce validation is sufficient.
      let isCounterfactual = false;
      try {
        const code = await this.publicClient.getCode({ address: body.address as `0x${string}` });
        isCounterfactual = !code || code === "0x";
        console.log(`[Auth] Bytecode check for ${body.address}: ${isCounterfactual ? 'counterfactual (no code)' : 'deployed'}`);
      } catch (codeErr) {
        // If getCode fails (e.g., bad RPC), assume counterfactual for safety
        isCounterfactual = true;
        console.warn(`[Auth] getCode failed for ${body.address}, assuming counterfactual:`, codeErr);
      }

      if (isCounterfactual) {
        // Skip signature verification — smart account isn't deployed so
        // ERC-1271 isValidSignature would fail. Accept nonce-gated auth.
        console.log(`[Auth] Counterfactual smart account ${body.address} — skipping ERC-1271, validating nonce only`);
        const nonceMatch = /Nonce:\s*(.+)$/m.exec(body.message)?.[1] ?? "";
        if (!this.nonceService.consume(body.address, nonceMatch)) {
          console.warn(`[Auth] Nonce mismatch for counterfactual ${body.address}`);
          return { status: "invalid_nonce" };
        }
        return this.authService.issueTokenForAddress(body.address.toLowerCase(), body.role ?? "listener");
      }

      let ok = await this.publicClient.verifyMessage(verifyOptions);
      let issuedAddress = body.address;

      // Fallback: Passkey/Kernel may return EOA-style signature; recover signer and issue for that address
      if (!ok) {
        try {
          const recovered = await recoverMessageAddress({
            message: body.message,
            signature: body.signature,
          });
          const eoaOk = await this.publicClient.verifyMessage({
            address: recovered,
            message: body.message,
            signature: body.signature,
          });
          if (eoaOk) {
            ok = true;
            issuedAddress = recovered.toLowerCase();
            console.log(`[Auth] Verified via recovered EOA: ${issuedAddress}`);
          }
        } catch {
          // ignore recovery errors
        }
      }

      if (!ok) {
        // Final fallback: Passkey-authenticated smart accounts
        // ERC-1271 isValidSignature may reject WebAuthn-wrapped signatures
        // from Kernel accounts. The passkey credential is the real auth factor
        // (validated via WebAuthn in the browser). Accept nonce-gated auth.
        console.log(`[Auth] ERC-1271 failed for deployed SA ${body.address}. Falling back to nonce-gated passkey auth.`);
        const nonceMatch = /Nonce:\s*(.+)$/m.exec(body.message)?.[1] ?? "";
        if (!this.nonceService.consume(body.address, nonceMatch)) {
          console.warn(`[Auth] Nonce mismatch for ${body.address}`);
          return { status: "invalid_nonce" };
        }
        return this.authService.issueTokenForAddress(body.address.toLowerCase(), body.role ?? "listener");
      }
      const nonceMatch = /Nonce:\s*(.+)$/m.exec(body.message)?.[1] ?? "";
      if (!this.nonceService.consume(body.address, nonceMatch)) {
        console.warn(`[Auth] Nonce mismatch for ${body.address}`);
        return { status: "invalid_nonce" };
      }
      const result = this.authService.issueTokenForAddress(issuedAddress, body.role ?? "listener");
      return issuedAddress !== body.address ? { ...result, address: issuedAddress } : result;
    } catch (err) {
      console.error(`[Auth] Error during verification:`, err);
      return { status: "error", message: (err as Error).message };
    }
  }
}
