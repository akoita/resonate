import { getAccountClosure, type AccountClosureRequest } from "../../lib/api";

/**
 * #1771: the browser's one view of whether this account is scheduled for
 * deletion.
 *
 * Two surfaces read it — the Settings panel where it is started and stopped,
 * and the shell notice that makes sure nobody has to open Settings to find out
 * it is happening. They must never disagree: a banner still announcing a
 * deletion the person just cancelled is as alarming as no banner at all, and
 * one that lingers after the panel says "cancelled" teaches people not to
 * believe either surface.
 *
 * Module-scoped rather than a provider, for the same reason
 * `analyticsConsent.ts` is: the two readers sit in different trees (one inside
 * the page, one in the app shell) and there is no common ancestor below the
 * root worth threading state through.
 */
export type AccountClosureState = {
  /**
   * False until the server has answered once. Nothing may be announced while
   * this is false — "we have not asked yet" is not "nothing is scheduled",
   * and guessing in either direction is a lie about someone's account.
   */
  known: boolean;
  request: AccountClosureRequest | null;
};

const UNKNOWN: AccountClosureState = { known: false, request: null };

type Listener = (state: AccountClosureState) => void;

let state: AccountClosureState = { ...UNKNOWN };
const listeners = new Set<Listener>();

function publish(next: AccountClosureState) {
  state = next;
  for (const listener of listeners) {
    listener(state);
  }
}

export function getAccountClosureState(): AccountClosureState {
  return state;
}

export function subscribeToAccountClosure(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Record what the server just told us, from either surface. */
export function setAccountClosureRequest(request: AccountClosureRequest | null) {
  publish({ known: true, request: request ?? null });
}

/** Signing out drops the answer so the next account is not shown this one's. */
export function resetAccountClosureState() {
  publish({ ...UNKNOWN });
}

/**
 * Ask the server whether a deletion is pending.
 *
 * A failed check leaves the previous answer alone rather than clearing it. If
 * the network drops while a deletion is scheduled, the honest thing is to keep
 * showing the notice we have already shown; silently withdrawing it would hide
 * the only warning some people will ever get.
 */
export async function loadAccountClosure(
  token: string | null | undefined,
): Promise<AccountClosureState> {
  if (!token) {
    resetAccountClosureState();
    return state;
  }

  try {
    setAccountClosureRequest(await getAccountClosure(token));
  } catch {
    // Keep the last known answer.
  }

  return state;
}
