import {
  ApiRequestError,
  requestAdminStepUpChallenge,
  verifyAdminStepUp,
  type AdminStepUpProof,
} from "./api";
import { isPasskeyDismissal } from "./passkeyDismissal";

/**
 * #2173: the browser half of the admin step-up.
 *
 * Destructive admin actions (suspend, close, broadcast) need a fresh passkey or
 * wallet confirmation that the server checks and turns into a short-lived proof.
 * This asks for it only when the server says it is needed: the action is tried
 * first with whatever proof is still fresh (none, the first time), and a
 * `403 step_up_*` answer triggers one challenge, one signature prompt and one
 * retry. The person is therefore prompted once per window, not once per click.
 */

export const STEP_UP_CODES = ["step_up_required", "step_up_expired", "step_up_invalid"] as const;
export type StepUpCode = (typeof STEP_UP_CODES)[number];

/** A proof is dropped this long before the server would, so a request never races its expiry. */
export const STEP_UP_SAFETY_MARGIN_MS = 15_000;

/** The person dismissed the passkey prompt. Nothing was sent and nothing changed. */
export class AdminStepUpCancelledError extends Error {
  constructor() {
    super("Confirmation cancelled. Nothing was changed.");
    this.name = "AdminStepUpCancelledError";
  }
}

/** The server did not accept the confirmation (wrong signature, expired or spent challenge). */
export class AdminStepUpRefusedError extends Error {
  constructor(message = "We could not confirm it is you, so nothing was changed. Please try again.") {
    super(message);
    this.name = "AdminStepUpRefusedError";
  }
}

/** The step-up code on a 403, or null when the failure is anything else. */
export function stepUpCodeOf(error: unknown): StepUpCode | null {
  if (!(error instanceof ApiRequestError) || error.status !== 403) return null;
  const code = (error.details as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && (STEP_UP_CODES as readonly string[]).includes(code) ? (code as StepUpCode) : null;
}

let cached: { token: string; proof: string; expiresAt: number } | null = null;

/** The proof still worth sending for this session, if any. */
export function freshStepUpProof(token: string, now: number = Date.now()): string | undefined {
  if (!cached || cached.token !== token) return undefined;
  return cached.expiresAt - STEP_UP_SAFETY_MARGIN_MS > now ? cached.proof : undefined;
}

export function rememberStepUpProof(token: string, proof: AdminStepUpProof) {
  const expiresAt = Date.parse(proof.expiresAt);
  cached = Number.isNaN(expiresAt) ? null : { token, proof: proof.proof, expiresAt };
}

/** Forget any proof (sign-out, and tests). */
export function clearStepUpProof() {
  cached = null;
}

export type StepUpContext = {
  token: string;
  /** The auth provider's signer: a passkey prompt for a passkey account. */
  signMessage: (message: string) => Promise<string>;
  /** Called just before the passkey prompt opens, so the screen can say why. */
  onPrompt?: () => void;
};

/** One challenge, one signature prompt, one verification. */
export async function obtainStepUpProof(context: StepUpContext): Promise<string> {
  const challenge = await requestAdminStepUpChallenge(context.token);
  context.onPrompt?.();

  let signature: string;
  try {
    // The server's message, verbatim. Never our own.
    signature = await context.signMessage(challenge.message);
  } catch (error) {
    if (isPasskeyDismissal(error)) throw new AdminStepUpCancelledError();
    throw new AdminStepUpRefusedError("Your passkey could not confirm this, so nothing was changed. Please try again.");
  }

  try {
    const proof = await verifyAdminStepUp(context.token, {
      address: challenge.address,
      signature,
      challengeToken: challenge.challengeToken,
    });
    rememberStepUpProof(context.token, proof);
    return proof.proof;
  } catch (error) {
    // 400 and 403 are the server declining the confirmation; anything else is a real failure.
    if (error instanceof ApiRequestError && (error.status === 400 || error.status === 403)) {
      throw new AdminStepUpRefusedError();
    }
    throw error;
  }
}

/**
 * Run a destructive admin call, asking for a confirmation only if the server
 * requires one. `call` receives the proof to send (undefined when none is fresh)
 * and may be called twice: once as is, and once again after a confirmation.
 */
export async function withAdminStepUp<T>(
  context: StepUpContext,
  call: (proof: string | undefined) => Promise<T>,
): Promise<T> {
  try {
    return await call(freshStepUpProof(context.token));
  } catch (error) {
    if (!stepUpCodeOf(error)) throw error;
    clearStepUpProof();
    const proof = await obtainStepUpProof(context);
    return call(proof);
  }
}
