/**
 * Publishing without a deposit (#2659).
 *
 * `PUBLISH_DEPOSIT_MODE=none` makes every trust tier publish with no Content
 * Protection deposit: the stake requirement reads zero and the upload flow
 * attests without staking. The attestation step stays. Upload limits for
 * accounts that are not yet verified (`upload_limits.ts`) take over the job
 * the deposit did. Any other value, or none, keeps the deposit (`required`).
 *
 * Existing stakes are untouched and stay claimable through the current flow.
 */
export type PublishDepositMode = "required" | "none";

export function resolvePublishDepositMode(env: NodeJS.ProcessEnv = process.env): PublishDepositMode {
  return env.PUBLISH_DEPOSIT_MODE?.trim().toLowerCase() === "none" ? "none" : "required";
}

export function isPublishDepositWaived(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolvePublishDepositMode(env) === "none";
}
