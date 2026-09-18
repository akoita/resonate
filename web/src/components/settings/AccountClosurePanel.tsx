"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  cancelAccountClosure,
  requestAccountClosure,
  requestAccountClosureChallenge,
  type AccountClosureRequest,
} from "../../lib/api";
import {
  getAccountClosureState,
  loadAccountClosure,
  setAccountClosureRequest,
  subscribeToAccountClosure,
  type AccountClosureState,
} from "./accountClosureState";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
};

/**
 * #1771: where a person asks us to delete their account and everything we
 * hold about them — and where they stop it.
 *
 * Three things this panel is careful about.
 *
 * It asks twice, in two different ways: a confirmation people read, then a
 * passkey signature only the account holder can give. Neither alone is
 * enough — a dialog can be clicked through by someone borrowing an unlocked
 * laptop, and a signature prompt on its own never says what is being signed.
 *
 * It never writes the message it asks people to sign. The server composes it
 * and verifies against its own reconstruction; a client-written message would
 * either be rejected or, worse, show one sentence while authorising another.
 *
 * And it treats stopping as the easy direction. Cancelling takes one button
 * and no signature, the deadline and the remaining days are stated rather than
 * implied, and the panel says in both states that simply signing in cancels
 * the deletion. Someone seeing this who did not ask for it is the person this
 * screen is really for.
 */
export default function AccountClosurePanel({ token, addToast }: Props) {
  const { signMessage } = useAuth();
  const [closure, setClosure] = useState<AccountClosureState>(() => getAccountClosureState());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<"scheduling" | "cancelling" | null>(null);

  useEffect(() => subscribeToAccountClosure(setClosure), []);

  useEffect(() => {
    void loadAccountClosure(token);
  }, [token]);

  const schedule = async () => {
    if (!token || busy) return;
    setBusy("scheduling");
    try {
      await scheduleAccountClosure(token, signMessage, addToast);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!token || busy) return;
    setBusy("cancelling");
    try {
      await cancelScheduledAccountClosure(token, addToast);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <AccountClosureCard
        request={closure.request}
        signedIn={Boolean(token)}
        busy={busy}
        onRequestDelete={() => setConfirmOpen(true)}
        onCancelDelete={() => void cancel()}
      />
      <ConfirmDialog
        isOpen={confirmOpen}
        variant="danger"
        title={CLOSURE_CONFIRM_TITLE}
        message={CLOSURE_CONFIRM_MESSAGE}
        confirmLabel="Yes, delete my account"
        cancelLabel="Keep my account"
        onConfirm={async () => {
          // Close first: the passkey prompt should not appear behind a modal
          // overlay, and the panel's own busy state carries on from here.
          setConfirmOpen(false);
          await schedule();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

export const CLOSURE_CONFIRM_TITLE = "Delete your account and your data?";

/**
 * The words on the confirmation. Exported so the promises made here can be
 * asserted in a test: every one of them is a commitment the rest of the system
 * has to keep, and the escape hatch in the second paragraph is the only way
 * back for someone whose account was scheduled by somebody else.
 */
export const CLOSURE_CONFIRM_MESSAGE = [
  "This is permanent. Once it runs it cannot be undone, and we cannot bring your account or your data back.",
  "Nothing happens for 30 days. Signing in at any point before then cancels the deletion — that is how you stop this if you change your mind, or if you did not ask for it.",
  "Some things stay. We keep the records the law obliges us to keep. Entries written to the blockchain and files stored on IPFS live outside Resonate, are public by design, and stay where they are.",
  "If you have released music, it stops streaming on Resonate. People who bought something from you keep it.",
  "Next, your passkey will ask you to sign — that is how we know this is really you.",
].join("\n\n");

/**
 * Ask for the challenge, have the person sign the server's own words, and
 * submit. Kept out of the component so each ending can be asserted as its own
 * message: a declined passkey, a refused signature, and a signature for the
 * wrong account are three different things to say, and only one of them is an
 * error.
 */
export async function scheduleAccountClosure(
  token: string,
  signMessage: (message: string) => Promise<string>,
  addToast: ToastFn,
): Promise<void> {
  let signature: string;
  let challenge: { address: string; message: string };

  try {
    challenge = await requestAccountClosureChallenge(token);
  } catch {
    addToast({
      type: "error",
      title: "Deletion not scheduled",
      message: "Something went wrong on our side before we could start. Nothing has changed. Please try again in a moment.",
    });
    return;
  }

  try {
    // The server's message, verbatim. Never our own.
    signature = await signMessage(challenge.message);
  } catch (error) {
    if (isPasskeyDismissal(error)) {
      // They changed their mind at the passkey prompt. Nothing has gone wrong
      // and nothing was requested, so there is nothing to report: an error
      // toast here would tell someone they had a problem when they simply
      // decided not to.
      return;
    }
    addToast({
      type: "error",
      title: "Deletion not scheduled",
      message: "Your passkey could not confirm this. Nothing has changed. Please try again.",
    });
    return;
  }

  try {
    const result = await requestAccountClosure(token, {
      address: challenge.address,
      signature,
    });

    if (result.status === "wrong_account") {
      addToast({
        type: "error",
        title: "That is not this account",
        message: "The signature was for a different account than the one you are signed in to. Nothing has changed. Sign in as the account you want to delete and try again.",
      });
      return;
    }

    if (result.status === "signature_rejected") {
      addToast({
        type: "error",
        title: "We could not verify that signature",
        message: "The signature did not check out, so nothing has been scheduled. Please try again.",
      });
      return;
    }

    setAccountClosureRequest(result.request);
    addToast({
      type: "success",
      title: "Deletion scheduled",
      message: `Your account and your data will be deleted on ${formatClosureDate(result.request.dueAt)}. Signing in before then cancels it.`,
    });
  } catch {
    addToast({
      type: "error",
      title: "Deletion not scheduled",
      message: "Something went wrong on our side. Nothing has been scheduled. Please try again in a moment.",
    });
  }
}

/** Stop a scheduled deletion. One call, no signature, no second question. */
export async function cancelScheduledAccountClosure(
  token: string,
  addToast: ToastFn,
): Promise<void> {
  try {
    await cancelAccountClosure(token);
    setAccountClosureRequest(null);
    addToast({
      type: "success",
      title: "Deletion cancelled",
      message: "Your account is staying. Nothing has been deleted.",
    });
  } catch {
    addToast({
      type: "error",
      title: "Deletion not cancelled",
      message: "We could not cancel it just now. Please try again — and remember that simply signing in also cancels it.",
    });
  }
}

/**
 * True when the passkey prompt ended because the person dismissed it (or let
 * it time out), rather than because something failed. WebAuthn reports both as
 * `NotAllowedError`, and in both cases nothing was signed and nothing was
 * requested, so both are ordinary outcomes rather than errors.
 */
export function isPasskeyDismissal(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const normalized = `${name} ${message}`.toLowerCase();
  return (
    name === "AbortError" ||
    normalized.includes("notallowederror") ||
    normalized.includes("timed out or was not allowed")
  );
}

/** The day the deletion runs, in the reader's own locale. */
export function formatClosureDate(dueAt: string): string {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "the scheduled date";
  return due.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * How long is left, said the way a person would say it.
 *
 * Rounded up, because "tomorrow" for something twenty hours away is closer to
 * the truth than "today" — except in the last half-day, where "tomorrow" would
 * read as more time than there is. Never counts below zero: if the deletion is
 * due and the job has not run yet, it is still happening today.
 */
export function describeTimeUntilClosure(dueAt: string, now: Date = new Date()): string {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "soon";
  const hours = (due.getTime() - now.getTime()) / 3_600_000;
  if (hours <= 12) return "today";
  const days = Math.ceil(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

/**
 * The panel itself, kept presentational so both states — and the copy that
 * carries the promises — can be asserted without an auth session.
 */
export function AccountClosureCard({
  request,
  signedIn,
  busy,
  onRequestDelete,
  onCancelDelete,
  now,
}: {
  request: AccountClosureRequest | null;
  signedIn: boolean;
  busy: "scheduling" | "cancelling" | null;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  now?: Date;
}) {
  if (request) {
    return (
      <div className="settings-section">
        <div className="settings-section-header">
          <div>
            <span className="settings-kicker">Your account</span>
            <h2 className="settings-section-title">Your account is scheduled for deletion</h2>
            <p className="settings-copy">
              Your account and the data we hold about you are due to be deleted on{" "}
              <strong>{formatClosureDate(request.dueAt)}</strong> — that is{" "}
              {describeTimeUntilClosure(request.dueAt, now)}. Until then nothing has been deleted and
              your account works exactly as it did before.
            </p>
          </div>
        </div>

        <div className="settings-source">
          <div className="settings-source-actions">
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              onClick={onCancelDelete}
              disabled={!signedIn || busy !== null}
            >
              {busy === "cancelling" ? "Cancelling..." : "Cancel deletion"}
            </button>
          </div>
          <p className="settings-copy">
            If you did not ask for this, cancel it now. Signing in also cancels it, so you have not
            lost anything by being away.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <span className="settings-kicker">Your account</span>
          <h2 className="settings-section-title">Delete your account</h2>
          <p className="settings-copy">
            You can ask us to delete your Resonate account and the data we hold about you. We will
            not ask why, and you do not have to give a reason.
          </p>
        </div>
      </div>

      <div className="settings-source">
        <div className="settings-source-actions">
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={onRequestDelete}
            disabled={!signedIn || busy !== null}
          >
            {busy === "scheduling" ? "Waiting for your passkey..." : "Delete my account"}
          </button>
        </div>
        <p className="settings-copy">
          It does not happen straight away. We wait <strong>30 days</strong>, then delete.{" "}
          <strong>Signing in at any point before then cancels it</strong> — so a change of mind, or a
          request you did not make, costs you nothing more than signing in. After that it is
          permanent and cannot be undone.
        </p>
        <p className="settings-copy">
          Deleting removes what Resonate keeps about you in our own systems, apart from the records
          we are legally obliged to keep. It does not cover files stored on IPFS or entries written
          to the blockchain: those live outside Resonate, are public by design, and stay where they
          are.
        </p>
        <p className="settings-copy">
          If you have released music, it stops streaming on Resonate. People who bought something
          from you keep it — a purchase belongs to the person who made it, and deleting your account
          does not take it away from them.
        </p>
      </div>
    </div>
  );
}
