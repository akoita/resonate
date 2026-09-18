import { ACCOUNT_CLOSURE_WINDOW_DAYS } from "./account_closure.service";

/**
 * The words a person signs to schedule their own erasure (#1771 slice 3b).
 *
 * **The server builds this text; the client never supplies it.** The whole
 * value of naming the action is lost if the caller chooses the words: a site
 * that could hand us a signature over "Sign in to Example" and submit it as
 * consent to delete an account would make the step-up decorative. The challenge
 * route returns this string so the wallet can display it, and the request route
 * rebuilds it from the address and the outstanding nonce and verifies against
 * its own reconstruction — the returned copy is for the human, never an input.
 *
 * It is therefore a pure function of `(address, nonce)` and must stay one.
 * Anything that varies between the challenge and the request — a timestamp, a
 * due date, a locale — would make the two reconstructions differ and refuse
 * every honest signature. The address is lowercased for the same reason: the
 * client may echo it back in any case, and EIP-55 checksumming would make the
 * text depend on the case the caller happened to send.
 *
 * The prose is deliberately alarming. This is the one message in the product a
 * person would be seriously harmed by signing absent-mindedly, so it says what
 * it does in the first line, before the address and the nonce a wallet UI is
 * likely to truncate.
 */
export function buildAccountClosureMessage(input: {
  address: string;
  nonce: string;
}): string {
  const address = input.address.trim().toLowerCase();
  return [
    "Resonate: delete my account",
    "",
    "I am asking Resonate to close my account and erase my personal data.",
    "Once the deletion runs it cannot be undone.",
    "",
    `The deletion is scheduled for ${ACCOUNT_CLOSURE_WINDOW_DAYS} days from now.`,
    "Signing in to Resonate before then cancels it.",
    "",
    "Do not sign this if you did not ask to delete your account.",
    "",
    `Account: ${address}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}

/**
 * The key the closure nonce is stored under.
 *
 * `AuthNonceService` keeps one nonce per key and keys sign-in by address alone,
 * so an un-namespaced closure challenge would overwrite the nonce of a sign-in
 * the same person had just started — and sign-in is the only way a real owner
 * can cancel a closure somebody else scheduled. Breaking sign-in from the
 * closure flow would break the safety valve, so the two namespaces are kept
 * apart rather than sharing a slot.
 */
export function accountClosureNonceKey(address: string): string {
  return `account-closure:${address.trim().toLowerCase()}`;
}
