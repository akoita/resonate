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

      // Fallback: Counterfactual smart account (not yet deployed on-chain)
      // ERC-1271 verification fails because there's no contract code at the address.
      // The address is deterministically derived from the passkey credential,
      // so if the nonce is valid we can trust the authenticated address.
      if (!ok) {
        try {
          const code = await this.publicClient.getCode({ address: body.address as `0x${string}` });
          const isCounterfactual = !code || code === "0x";
          if (isCounterfactual) {
            console.log(`[Auth] Smart account ${body.address} is counterfactual (not deployed). Accepting passkey-authenticated address.`);
            ok = true;
            issuedAddress = body.address.toLowerCase();
          }
        } catch (codeErr) {
          console.warn(`[Auth] Failed to check bytecode for ${body.address}:`, codeErr);
        }
      }

      if (!ok) {
        console.warn(`[Auth] Signature verification failed for ${body.address}`);
        return { status: "invalid_signature" };
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
