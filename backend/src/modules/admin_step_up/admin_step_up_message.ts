import { ADMIN_STEP_UP_MAX_TTL_SECONDS } from "./admin_step_up_token.service";

/**
 * The words an admin signs to confirm a destructive action (#2173).
 *
 * **The server builds this text; the client never supplies it.** As with the
 * account-closure message, the value of naming the action is lost if the
 * caller chooses the words. It is a pure function of `(address, nonce)`: the
 * challenge returns it for the wallet to display, and verification rebuilds it
 * from the address and the nonce inside the signed challenge token.
 *
 * The window is stated as the ceiling (5 minutes), not the configured value, so
 * the text stays constant across deployments that shorten the window.
 */
export function buildAdminStepUpMessage(input: { address: string; nonce: string }): string {
  const address = input.address.trim().toLowerCase();
  return [
    "Resonate: confirm an admin action",
    "",
    "I am confirming it is me, so I can suspend or close accounts and send",
    `platform notices for the next ${Math.floor(ADMIN_STEP_UP_MAX_TTL_SECONDS / 60)} minutes at most.`,
    "",
    "Do not sign this if you did not just ask to do that.",
    "",
    `Account: ${address}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}
