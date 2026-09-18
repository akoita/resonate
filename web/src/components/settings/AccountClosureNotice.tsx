"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import { cancelScheduledAccountClosure, describeTimeUntilClosure, formatClosureDate } from "./AccountClosurePanel";
import {
  getAccountClosureState,
  loadAccountClosure,
  resetAccountClosureState,
  subscribeToAccountClosure,
  type AccountClosureState,
} from "./accountClosureState";

/**
 * #1771: the standing notice that this account is going to be deleted.
 *
 * It lives in the app shell rather than only in Settings because of who needs
 * it most. Someone who scheduled their own deletion will remember; someone
 * whose account was scheduled by a person with their unlocked laptop will not,
 * and a warning they only meet by opening Settings is a warning they will meet
 * for the first time after the account is gone. Thirty days of silence is the
 * failure mode this exists to prevent.
 *
 * Two deliberate differences from the analytics consent banner (#1772), which
 * is fixed to the bottom of the viewport at z-index 9999 and explicitly wins
 * the stacking contest against the update pill at 9998:
 *
 *  - This notice does not join that contest at all. It is in normal flow at
 *    the top of the shell, under the topbar, so the consent question keeps the
 *    bottom anchor and its win over the update pill stands untouched. Two
 *    undismissable fixed banners competing for one corner would have meant one
 *    of them covering the other.
 *  - It takes layout space instead of floating over content. A deletion
 *    deadline is a state of the account, not an interruption, and a bar that
 *    pushes the page down cannot hide anything underneath itself.
 *
 * Like the consent banner it does not block the app, has no dismiss control
 * while a deletion is pending, and disappears the moment the deletion is
 * cancelled.
 */
export default function AccountClosureNotice() {
  const { status, token } = useAuth();
  const { addToast } = useToast();
  const [closure, setClosure] = useState<AccountClosureState>(() => getAccountClosureState());
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => subscribeToAccountClosure(setClosure), []);

  useEffect(() => {
    if (status !== "authenticated" || !token) {
      // Signing out drops the answer so the next account is never shown
      // somebody else's deadline.
      resetAccountClosureState();
      return;
    }
    void loadAccountClosure(token);
  }, [status, token]);

  const cancel = async () => {
    if (!token || cancelling) return;
    setCancelling(true);
    try {
      await cancelScheduledAccountClosure(token, addToast);
    } finally {
      setCancelling(false);
    }
  };

  const request = closure.known ? closure.request : null;
  if (status !== "authenticated" || !token || !request) return null;

  return (
    <AccountClosureBanner
      dueAt={request.dueAt}
      cancelling={cancelling}
      onCancel={() => void cancel()}
    />
  );
}

/**
 * The bar itself, kept presentational so the deadline, the way back, and the
 * promise that signing in is enough can be asserted without an auth session.
 */
export function AccountClosureBanner({
  dueAt,
  cancelling,
  onCancel,
  now,
}: {
  dueAt: string;
  cancelling: boolean;
  onCancel: () => void;
  now?: Date;
}) {
  return (
    <section
      role="region"
      aria-labelledby="account-closure-notice-title"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "12px",
        padding: "10px 16px",
        borderBottom: "1px solid rgba(239, 68, 68, 0.28)",
        background: "rgba(239, 68, 68, 0.12)",
        color: "var(--color-text, #fff)",
        fontSize: "0.85rem",
        lineHeight: 1.5,
      }}
    >
      <p style={{ margin: 0, flex: "1 1 320px", minWidth: "220px" }}>
        <strong id="account-closure-notice-title">
          Your account is scheduled for deletion on {formatClosureDate(dueAt)}
        </strong>{" "}
        — {describeTimeUntilClosure(dueAt, now)}. If you did not ask for this, cancel it now. Signing
        in also cancels it.
      </p>
      <span style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="ui-btn ui-btn-primary" onClick={onCancel} disabled={cancelling}>
          {cancelling ? "Cancelling..." : "Cancel deletion"}
        </button>
        <Link href="/settings" style={{ textDecoration: "underline" }}>
          Open Settings
        </Link>
      </span>
    </section>
  );
}
