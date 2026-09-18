import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { recoverMessageAddress, type PublicClient } from "viem";
import { AuthService } from "../auth/auth.service";
import { AuthNonceService } from "../auth/auth_nonce.service";
import { accountClosureNonceKey, buildAccountClosureMessage } from "./account_closure_message";
import { writeStructuredLog } from "../shared/structured_logging";

/** What actually convinced us the signature was real. */
export type AccountClosureStepUpMode =
  /** The claimed address recovered directly from the signature (plain EOA). */
  | "eoa"
  /** ERC-1271/ERC-6492 said yes — a deployed smart account. */
  | "erc1271"
  /** The signature recovered to another address this same person owns. */
  | "recovered_eoa"
  /**
   * Nothing cryptographic held, and the request was accepted on the strength
   * of the session and a single-use nonce alone. See {@link verify}.
   */
  | "nonce_only";

export interface AccountClosureChallenge {
  address: string;
  message: string;
  nonce: string;
}

/**
 * The local UniversalSigValidator, mirrored from `AuthController.verify`. The
 * canonical ERC-6492 validators do not exist on Anvil, so viem has to be
 * pointed at the one this repository deploys.
 */
const LOCAL_UNIVERSAL_SIG_VALIDATOR = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
const LOCAL_CHAIN_ID = 31337;

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
   * The `nonce_only` outcome mirrors `AuthController.verify`, which accepts
   * nonce-gated authentication when ERC-1271 cannot be evaluated — a
   * counterfactual (undeployed) smart account has no code to call, and its
   * WebAuthn-wrapped signature is not one viem can recover from. Refusing that
   * case here would leave every passkey user who has never transacted unable to
   * delete their own account, which is a worse failure than the one it
   * prevents. It is logged at `warn` so the weakest outcome is visible rather
   * than assumed, and the 30-day window plus cancel-on-sign-in remain the real
   * protection against a request the account holder did not make.
   *
   * It is narrower than auth's, though, in the one way that matters here: that
   * fallback applies only when the signature could not be evaluated *at all*.
   * A signature that recovers cleanly to somebody else is a signature over
   * different words, or by a different key, and is refused — otherwise a caller
   * who obtained a signature over some other text could still submit it, and
   * naming the action in the message would buy nothing.
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
      level: mode === "nonce_only" ? "warn" : "info",
      event: "privacy.account_closure.step_up_verified",
      message:
        mode === "nonce_only"
          ? "Account-closure step-up accepted on nonce alone; no signature check held"
          : "Account-closure step-up verified by signature",
      userId: input.userId,
      stepUpMode: mode,
    });

    return mode;
  }

  private async checkSignature(input: {
    userId: string;
    address: `0x${string}`;
    message: string;
    signature: `0x${string}`;
  }): Promise<AccountClosureStepUpMode | null> {
    // Offline recovery first. It costs no RPC call and settles the plain-EOA
    // case, which an on-chain check alone would miss: an EOA has no code, and a
    // bytecode check cannot tell one apart from a counterfactual smart account.
    const recovered = await this.recoverSigner(input.message, input.signature);
    if (recovered && recovered.toLowerCase() === input.address.toLowerCase()) {
      return "eoa";
    }

    const chainId = await this.chainId();

    // Deliberately NOT gated on the account having code. ERC-6492 exists for
    // exactly the account that has none yet: viem validates a wrapped signature
    // through a deployless call that runs the factory from the wrapper and then
    // asks ERC-1271. Requiring bytecode first would skip that path for every
    // counterfactual smart account — which is most passkey accounts that have
    // never transacted — and drop them into the unverified fallback below. The
    // extra call costs nothing for an EOA, because a plain signature has
    // already returned above.
    {
      const verifyOptions: Parameters<PublicClient["verifyMessage"]>[0] & {
        universalSignatureValidatorAddress?: `0x${string}`;
      } = {
        address: input.address,
        message: input.message,
        signature: input.signature,
      };
      if (chainId === LOCAL_CHAIN_ID) {
        verifyOptions.universalSignatureValidatorAddress = LOCAL_UNIVERSAL_SIG_VALIDATOR;
      }
      try {
        if (await this.publicClient.verifyMessage(verifyOptions)) {
          return "erc1271";
        }
      } catch {
        // A validator that reverts is a "no", not an outage: fall through.
      }
    }

    // A smart account whose owner EOA signed on its behalf. Accepted only when
    // the recovered signer is itself an address of this same person, so this
    // stays a proof about *this account* rather than about any wallet.
    if (recovered && (await this.authService.isAddressForUser(input.userId, recovered))) {
      return "recovered_eoa";
    }

    if (recovered) {
      // The signature was fully evaluable and named a stranger. Nothing about
      // it is ambiguous, so there is no fallback to fall back to: refuse.
      return null;
    }

    // Not recoverable and not checkable on chain — a WebAuthn-wrapped signature
    // from an account with no code. See the note on `verify`.
    return "nonce_only";
  }

  private async recoverSigner(message: string, signature: `0x${string}`) {
    try {
      return await recoverMessageAddress({ message, signature });
    } catch {
      return null;
    }
  }

  private async chainId() {
    try {
      return await this.publicClient.getChainId();
    } catch {
      return null;
    }
  }

}
