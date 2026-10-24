import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { PublicClient } from "viem";
import { writeAdminAuditEvent } from "../admin_audit/admin_audit_event";
import { AuthService } from "../auth/auth.service";
import { checkWalletSignature, type WalletSignatureMode } from "../auth/wallet_signature_check";
import { writeStructuredLog } from "../shared/structured_logging";
import { buildAdminStepUpMessage } from "./admin_step_up_message";
import { AdminStepUpTokenService } from "./admin_step_up_token.service";

export interface AdminStepUpChallenge {
  address: string;
  message: string;
  challengeToken: string;
  expiresAt: string;
}

export interface AdminStepUpProof {
  proof: string;
  expiresAt: string;
  ttlSeconds: number;
}

type RefusalReason =
  | "challenge_invalid"
  | "challenge_spent"
  | "wrong_account"
  | "address_mismatch"
  | "signature_mismatch";

/**
 * The step-up in front of destructive admin actions (#2173).
 *
 * A valid session is not enough to suspend or close an account or to broadcast
 * to every user: a stolen token or a borrowed unlocked laptop would be enough.
 * So these routes take a *fresh signature* from the signed-in admin's own
 * account: a passkey prompt for a passkey account (verified through
 * ERC-6492/ERC-1271, exactly like the account-closure step-up), a wallet prompt
 * for an EOA. The server verifies it and issues a proof good for at most five
 * minutes, which `@RequireStepUp()` routes demand.
 *
 * Why a signature rather than a raw WebAuthn assertion: `WebAuthnCredential`
 * rows are keyed by a per-registration id that is not `User.id`, so a verified
 * assertion cannot be tied back to the signed-in account (the same reason the
 * account-closure step-up signs). A smart-account passkey signature is the same
 * gesture and is bound to the account.
 *
 * The challenge is stateless (a signed token carrying the nonce) so it works on
 * any instance. A spent-challenge set on this instance makes a captured
 * signature single-use where it is replayed to the same instance; across
 * instances a replay is bounded by the 2 minute challenge life, needs the
 * admin's session token as well, and can only mint another proof for that same
 * admin.
 */
@Injectable()
export class AdminStepUpService {
  /** jti of answered challenges to their expiry; pruned on every answer. */
  private readonly spent = new Map<string, number>();

  constructor(
    private readonly tokens: AdminStepUpTokenService,
    private readonly authService: AuthService,
    @Inject("PUBLIC_CLIENT") private readonly publicClient: PublicClient,
  ) {}

  /** The address is resolved from the account, never accepted from the caller. */
  async challenge(userId: string): Promise<AdminStepUpChallenge> {
    const address = await this.authService.findSigningAddressForUser(userId);
    if (!address) {
      throw new BadRequestException(
        "This account has no wallet address to sign with, so admin actions cannot be confirmed here.",
      );
    }
    const issued = this.tokens.issueChallenge({ userId, address });
    return {
      address,
      message: buildAdminStepUpMessage({ address, nonce: issued.nonce }),
      challengeToken: issued.token,
      expiresAt: new Date(issued.expiresAt).toISOString(),
    };
  }

  /**
   * Answers 400 for a signature or challenge that does not check out and 403
   * for an address that is not this account's: never 401, which the web client
   * reads as a dead session. Every refusal is recorded; a proof is never issued
   * unless its audit record was written.
   */
  async verify(
    userId: string,
    input: { address: string; signature: string; challengeToken: string },
  ): Promise<AdminStepUpProof> {
    const refuse = async (reason: RefusalReason, error: Error): Promise<never> => {
      await writeAdminAuditEvent({
        actorUserId: userId,
        action: "admin.step_up_refused",
        outcome: "denied",
        detail: { reason },
      });
      writeStructuredLog({
        level: "warn",
        event: "admin.step_up.refused",
        message: "Admin step-up was refused",
        userId,
        reason,
      });
      throw error;
    };

    const challenge = this.tokens.checkChallenge(input.challengeToken, userId);
    if (!challenge.ok) {
      return refuse(
        "challenge_invalid",
        new BadRequestException("That confirmation request is not valid or has expired. Request a new one."),
      );
    }

    // Spent before the answer is known: a failed signature burns the challenge.
    this.pruneSpent();
    if (this.spent.has(challenge.jti)) {
      return refuse(
        "challenge_spent",
        new BadRequestException("That confirmation request was already used. Request a new one."),
      );
    }
    this.spent.set(challenge.jti, challenge.expiresAt);

    if (!(await this.authService.isAddressForUser(userId, input.address))) {
      return refuse(
        "wrong_account",
        new ForbiddenException("That address does not belong to this account, so it cannot confirm for it."),
      );
    }
    if (input.address.toLowerCase() !== challenge.address) {
      return refuse(
        "address_mismatch",
        new BadRequestException("That is not the address this confirmation was issued for. Request a new one."),
      );
    }

    // The message is rebuilt from server state; the client supplies no words.
    const mode: WalletSignatureMode | null = await checkWalletSignature(
      { publicClient: this.publicClient, authService: this.authService },
      {
        userId,
        address: challenge.address as `0x${string}`,
        message: buildAdminStepUpMessage({ address: challenge.address, nonce: challenge.nonce }),
        signature: input.signature as `0x${string}`,
      },
    );
    if (!mode) {
      return refuse(
        "signature_mismatch",
        new BadRequestException("That signature does not match the confirmation this server issued."),
      );
    }

    const { proof, expiresAt } = this.tokens.issueProof(userId);
    await writeAdminAuditEvent(
      {
        actorUserId: userId,
        action: "admin.step_up_verified",
        detail: { mode, ttlSeconds: this.tokens.ttlSeconds },
      },
      { required: true },
    );
    return { proof, expiresAt: new Date(expiresAt).toISOString(), ttlSeconds: this.tokens.ttlSeconds };
  }

  private pruneSpent(now: number = Date.now()) {
    for (const [jti, expiresAt] of this.spent) {
      if (expiresAt <= now) this.spent.delete(jti);
    }
  }
}
