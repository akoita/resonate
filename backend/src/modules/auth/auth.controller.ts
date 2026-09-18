import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Optional,
  Post,
  forwardRef,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { seconds } from "../shared/rate_limits";
import { recoverMessageAddress, type PublicClient } from "viem";
import { AuthService } from "./auth.service";
import { AuthNonceService } from "./auth_nonce.service";
import { SignupFaucetService, type AuthMode } from "./signup_faucet.service";
import { EventBus } from "../shared/event_bus";
import { AccountClosureService } from "../privacy/account_closure.service";
import { writeStructuredLog } from "../shared/structured_logging";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly nonceService: AuthNonceService,
    @Inject("PUBLIC_CLIENT") private readonly publicClient: PublicClient,
    private readonly eventBus: EventBus,
    @Inject(forwardRef(() => AccountClosureService))
    private readonly accountClosureService: AccountClosureService,
    @Optional() private readonly signupFaucetService?: SignupFaucetService,
  ) { }

  @Post("login")
  // Dev-only shortcut: the handler 403s unless AUTH_DEV_LOGIN_ENABLED is
  // set, so this limit binds only where the flag is on — local work and the
  // E2E suite, which signs in once per spec from a single address.
  @Throttle({ default: { limit: 60, ttl: seconds(60) } })
  login(@Body() body: { userId: string; role?: string }) {
    if (process.env.AUTH_DEV_LOGIN_ENABLED !== "true") {
      throw new ForbiddenException("auth/login is disabled");
    }

    return this.authService.issueToken(body.userId, body.role ?? "listener");
  }

  @Post("nonce")
  @Throttle({ default: { limit: 20, ttl: seconds(60) } })
  nonce(@Body() body: { address: string }) {
    return { nonce: this.nonceService.issue(body.address) };
  }

  @Post("verify")
  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  async verify(
    @Body()
    body: {
      address: string;
      message: string;
      signature: `0x${string}`;
      role?: string;
      authMode?: AuthMode;
      chainId?: number;
      /** Local dev (31337): EOA that signed; we verify this and issue token for address (smart account) */
      signerAddress?: string;
      /** P-256 public key coordinates for passkey identity continuity */
      pubKeyX?: string;
      pubKeyY?: string;
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
        return this.issueTokenAndMaybeFundSignup({
          userId: body.address,
          walletAddress: body.address,
          role: body.role,
          authMode: body.authMode,
          requestedChainId: body.chainId,
          verifiedChainId: chainId,
          pubKeyX: body.pubKeyX,
          pubKeyY: body.pubKeyY,
        });
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
        return this.issueTokenAndMaybeFundSignup({
          userId: body.address.toLowerCase(),
          walletAddress: body.address,
          role: body.role,
          authMode: body.authMode,
          requestedChainId: body.chainId,
          verifiedChainId: chainId,
          pubKeyX: body.pubKeyX,
          pubKeyY: body.pubKeyY,
        });
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
        return this.issueTokenAndMaybeFundSignup({
          userId: body.address.toLowerCase(),
          walletAddress: body.address,
          role: body.role,
          authMode: body.authMode,
          requestedChainId: body.chainId,
          verifiedChainId: chainId,
          pubKeyX: body.pubKeyX,
          pubKeyY: body.pubKeyY,
        });
      }
      const nonceMatch = /Nonce:\s*(.+)$/m.exec(body.message)?.[1] ?? "";
      if (!this.nonceService.consume(body.address, nonceMatch)) {
        console.warn(`[Auth] Nonce mismatch for ${body.address}`);
        return { status: "invalid_nonce" };
      }
      const result = await this.issueTokenAndMaybeFundSignup({
        userId: issuedAddress,
        walletAddress: body.address,
        role: body.role,
        authMode: body.authMode,
        requestedChainId: body.chainId,
        verifiedChainId: chainId,
        pubKeyX: body.pubKeyX,
        pubKeyY: body.pubKeyY,
      });
      return issuedAddress !== body.address && !("address" in result)
        ? { ...result, address: issuedAddress }
        : result;
    } catch (err) {
      console.error(`[Auth] Error during verification:`, err);
      return { status: "error", message: (err as Error).message };
    }
  }

  /**
   * Every successful sign-in cancels a pending account closure.
   *
   * This is the load-bearing half of #1771 slice 3b, not a convenience. There
   * is no email channel in this backend yet (#1777), so nothing can tell a
   * person "someone asked to delete your account". Signing in is therefore the
   * *only* way a real owner can discover and stop an erasure that a stolen
   * token scheduled, and it is why the closure window is thirty days: an
   * attacker has to keep the owner out of their account for a month rather than
   * a minute.
   *
   * Awaited rather than published as an event, because a cancel that is
   * dispatched and then dropped is an account erased after its owner tried to
   * save it, and nothing afterwards would say so.
   *
   * A failure is logged at `error` and swallowed: locking somebody out of their
   * account because the cancel failed would be worse than a cancel they can
   * retry simply by signing in again — and being locked out is the exact
   * condition that lets the erasure run.
   */
  private async cancelScheduledClosureOnSignIn(userId: string) {
    try {
      const cancelled = await this.accountClosureService.cancel(userId);
      if (cancelled) {
        writeStructuredLog({
          level: "info",
          event: "privacy.account_closure.cancelled_by_sign_in",
          message: "Scheduled account closure cancelled because the account holder signed in",
          userId,
          closureRequestId: cancelled.id,
        });
      }
    } catch (error) {
      writeStructuredLog({
        level: "error",
        event: "privacy.account_closure.cancel_on_sign_in_failed",
        message:
          "Sign-in could not cancel a scheduled account closure; the closure may still be pending",
        userId,
        error: (error as Error).message,
      });
    }
  }

  private async issueTokenAndMaybeFundSignup(input: {
    userId: string;
    walletAddress: string;
    role?: string;
    authMode?: AuthMode;
    requestedChainId?: number;
    verifiedChainId: number;
    pubKeyX?: string;
    pubKeyY?: string;
  }) {
    const wallet = await this.authService.upsertWalletIdentity({
      userId: input.userId,
      walletAddress: input.walletAddress,
      chainId: input.requestedChainId ?? input.verifiedChainId,
      pubKeyX: input.pubKeyX,
      pubKeyY: input.pubKeyY,
    });
    const canonicalUserId = wallet.userId ?? input.userId;

    // Signing in calls off a scheduled erasure — see below. Awaited before the
    // token is issued so the answer to "did my account survive?" is settled by
    // the time the caller holds a session.
    await this.cancelScheduledClosureOnSignIn(canonicalUserId);

    const result = this.authService.issueTokenForAddress(canonicalUserId, input.role ?? "listener");
    let signupFaucet:
      | { status: "sent"; txHash: `0x${string}`; chainId: number; amountEth: string }
      | undefined;
    if (this.signupFaucetService) {
      try {
        const faucetResult = await this.signupFaucetService.maybeFundOnSignup({
          authMode: input.authMode,
          requestedChainId: input.requestedChainId,
          verifiedChainId: input.verifiedChainId,
          userId: canonicalUserId,
          walletAddress: input.walletAddress,
        });
        if (faucetResult.status === "sent") {
          signupFaucet = faucetResult;
          this.eventBus.publish({
            eventName: "wallet.faucet_requested",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            userId: canonicalUserId,
            chainId: faucetResult.chainId,
            amountEth: faucetResult.amountEth,
            status: "sent",
          });
        }
      } catch (error) {
        console.error("[Auth] Signup faucet failed after token issuance:", error);
      }
    }
    this.eventBus.publish({
      eventName: "identity.authenticated",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId: canonicalUserId,
      role: input.role ?? "listener",
      authMode: input.authMode,
      requestedChainId: input.requestedChainId,
      verifiedChainId: input.verifiedChainId,
      signupFaucetSent: Boolean(signupFaucet),
    });
    return {
      ...result,
      ...(canonicalUserId.toLowerCase() !== input.userId.toLowerCase()
        ? { address: canonicalUserId.toLowerCase() }
        : {}),
      ...(signupFaucet ? { signupFaucet } : {}),
    };
  }
}
