import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { PublicClient } from "viem";
import { AuthService } from "../auth/auth.service";
import { AuthNonceService } from "../auth/auth_nonce.service";
import { accountClosureNonceKey, buildAccountClosureMessage } from "./account_closure_message";
import { writeStructuredLog } from "../shared/structured_logging";
import { checkWalletSignature, type WalletSignatureMode } from "../auth/wallet_signature_check";

/** What actually convinced us the signature was real. */
export type AccountClosureStepUpMode = WalletSignatureMode;

export interface AccountClosureChallenge {
  address: string;
  message: string;
  nonce: string;
}

/**
 * The step-up in front of account closure (#1771 slice 3b).
 *
 * A valid session is not enough to schedule an irreversible erasure: a stolen
 * token, a borrowed laptop or a CSRF-ish flow would otherwise be able to delete
 * a person's account outright. So closing an account takes a *fresh signature*
 * over a message that names the action, verified against an address that
 * belongs to the authenticated user.
 *
 * Why a signature and not a WebAuthn assertion: `WebAuthnCredential.userId` is
 * a per-registration `randomUUID()` unrelated to `User.id`, so a verified
 * assertion cannot be tied back to the authenticated account without going
 * through `PasskeyIdentity` and re-deriving a public-key hash. The signature
 * path is the one already proven by sign-in, and for a passkey account the
 * signature *is* a passkey prompt — the same gesture, with the advantage that
 * the person signs words describing the deletion instead of an opaque
 * challenge.
 */
@Injectable()
export class AccountClosureStepUpService {
  constructor(
    private readonly authService: AuthService,
    private readonly nonceService: AuthNonceService,
    @Inject("PUBLIC_CLIENT") private readonly publicClient: PublicClient,
  ) {}

  /**
   * Issue the text to sign for the authenticated person.
   *
   * The address is resolved from the account, never accepted from the caller:
   * a challenge for an address the caller names would let them collect a
   * signature request for somebody else's wallet on our wording.
   */
  async challenge(userId: string): Promise<AccountClosureChallenge> {
    const address = await this.authService.findSigningAddressForUser(userId);
    if (!address) {
      throw new BadRequestException(
        "This account has no wallet address to sign with, so account closure cannot be confirmed here.",
      );
    }

    const nonce = this.nonceService.issue(accountClosureNonceKey(address));
    return { address, message: buildAccountClosureMessage({ address, nonce }), nonce };
  }

  /**
   * Check a signature against the challenge we issued, and nothing else.
   *
   * The order matters and is not cosmetic:
   *
   * 1. **The address must belong to the authenticated user.** A valid signature
   *    from an address that is not theirs is somebody proving they own *a*
   *    wallet, not *this account* — so this is checked before any crypto, and
   *    fails closed with 403.
   * 2. **The message is rebuilt from server state.** The nonce is read from the
   *    nonce store rather than taken from the request, so there is no input at
   *    all from which the caller could influence the words being verified.
   * 3. **The nonce is consumed before verification.** A failed signature burns
   *    the challenge, which costs an honest client one extra round trip and
   *    denies an attacker unlimited attempts against one nonce.
   *
   * Counterfactual smart accounts are supported without weakening this check:
   * viem wraps an undeployed smart account's signature in ERC-6492 using its
   * factory data, and `verifyMessage` evaluates that deployment path before
   * asking ERC-1271. If neither that check nor offline EOA recovery proves the
   * signature, an irreversible action must fail closed.
   */
  /**
   * A refused step-up answers 400, not 401.
   *
   * The bearer token was valid — the request reached here only by passing the
   * JWT guard — so the session is not the thing that failed. Answering 401
   * also has a concrete cost on the client: `apiRequest` treats every 401 as a
   * dead session and clears the stored one, so a mistyped or stale signature
   * would sign the person out in the middle of deleting their account.
   */
  async verify(input: {
    userId: string;
    address: string;
    signature: `0x${string}`;
  }): Promise<AccountClosureStepUpMode> {
    const address = typeof input.address === "string" ? input.address.trim() : "";
    const signature = typeof input.signature === "string" ? input.signature.trim() : "";
    if (!address || !signature) {
      throw new BadRequestException("An address and a signature are required to close an account.");
    }

    if (!(await this.authService.isAddressForUser(input.userId, address))) {
      throw new ForbiddenException(
        "That address does not belong to this account, so it cannot consent to closing it.",
      );
    }

    const nonceKey = accountClosureNonceKey(address);
    const nonce = this.nonceService.peek(nonceKey);
    if (!nonce) {
      throw new BadRequestException(
        "No account-closure challenge is outstanding for that address. Request a new one.",
      );
    }

    const message = buildAccountClosureMessage({ address, nonce });

    // Single use, and spent before the answer is known.
    if (!this.nonceService.consume(nonceKey, nonce)) {
      throw new BadRequestException("That account-closure challenge is no longer valid.");
    }

    const mode = await this.checkSignature({
      userId: input.userId,
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!mode) {
      writeStructuredLog({
        level: "warn",
        event: "privacy.account_closure.step_up_refused",
        message: "Account-closure signature did not match the challenge this server issued",
        userId: input.userId,
      });
      throw new BadRequestException(
        "That signature does not match the account-closure request this server issued.",
      );
    }

    writeStructuredLog({
      level: "info",
      event: "privacy.account_closure.step_up_verified",
      message: "Account-closure step-up verified by signature",
      userId: input.userId,
      stepUpMode: mode,
    });

    return mode;
  }

  private checkSignature(input: {
    userId: string;
    address: `0x${string}`;
    message: string;
    signature: `0x${string}`;
  }): Promise<AccountClosureStepUpMode | null> {
    // An opaque signature that neither ERC-6492/ERC-1271 nor EOA recovery can
    // prove is a refusal: the nonce prevents replay, but is not proof that the
    // account holder approved deletion.
    return checkWalletSignature(
      { publicClient: this.publicClient, authService: this.authService },
      input,
    );
  }
}
