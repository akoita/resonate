"use client";

import { FormEvent, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useToast } from "../../../components/ui/Toast";
import {
  closeAccount,
  getAdminAccountStatus,
  suspendAccount,
  unsuspendAccount,
  type AdminAccountStatus,
} from "../../../lib/api";
import AccountRestrictionPanel, {
  EMPTY_RESTRICTION_DRAFT,
  getRestrictionConfirmCopy,
  toRestrictionInput,
  validateRestrictionDraft,
  type RestrictionAction,
  type RestrictionDraft,
  type RestrictionDraftErrors,
} from "./AccountRestrictionPanel";

/**
 * #2147: look an account up by user id or wallet address, then suspend, lift a
 * suspension or close it. Every change is confirmed, audited, and tells the
 * person with a notice that carries the reason category (never the note).
 * Admin only.
 */
export default function AdminAccountsPage() {
  const { token, role } = useAuth();
  const { addToast } = useToast();
  const isAdmin = role === "admin";
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState<AdminAccountStatus | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [draft, setDraft] = useState<RestrictionDraft>(EMPTY_RESTRICTION_DRAFT);
  const [errors, setErrors] = useState<RestrictionDraftErrors>({});
  const [pending, setPending] = useState<RestrictionAction | null>(null);
  const [busy, setBusy] = useState(false);

  const lookUp = async (event: FormEvent) => {
    event.preventDefault();
    const key = query.trim();
    if (!token || !key || looking) return;
    setLooking(true);
    setLookupError(null);
    try {
      setAccount(await getAdminAccountStatus(token, key));
      setDraft(EMPTY_RESTRICTION_DRAFT);
      setErrors({});
    } catch (error) {
      setAccount(null);
      setLookupError(error instanceof Error ? error.message : "Could not load that account.");
    } finally {
      setLooking(false);
    }
  };

  const request = (action: RestrictionAction) => {
    const found = validateRestrictionDraft(action, draft);
    setErrors(found);
    if (Object.keys(found).length === 0) setPending(action);
  };

  const apply = async () => {
    if (!token || !account || !pending || busy) return;
    setBusy(true);
    try {
      const input = toRestrictionInput(pending, draft);
      const target = account.userId;
      const updated =
        pending === "suspend"
          ? await suspendAccount(token, target, input as Parameters<typeof suspendAccount>[2])
          : pending === "unsuspend"
            ? await unsuspendAccount(token, target, input)
            : await closeAccount(token, target, input as Parameters<typeof closeAccount>[2]);
      setAccount(updated);
      setDraft(EMPTY_RESTRICTION_DRAFT);
      addToast({ type: "success", title: "Account updated", message: "The person has been sent a notice." });
    } catch (error) {
      addToast({
        type: "error",
        title: "Account not updated",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const confirm = pending && account ? getRestrictionConfirmCopy(pending, account, draft) : null;

  return (
    <AuthGate title="Sign in with an admin account to manage accounts.">
      {!isAdmin ? (
        <p className="ui-card" style={{ padding: "20px" }}>
          Only admins can suspend or close accounts.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "20px", maxWidth: "860px" }}>
          <header>
            <h1 style={{ margin: 0 }}>Accounts</h1>
            <p style={{ margin: "6px 0 0", opacity: 0.7 }}>
              Suspend or close an account for a stated reason. A suspended person can still sign in, claim refunds, read
              notices and export their data. They are told what happened and how to appeal.
            </p>
          </header>
          <form className="ui-card" onSubmit={(e) => void lookUp(e)} style={{ padding: "20px", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "end" }}>
            <label style={{ display: "grid", gap: "4px", fontSize: "0.85rem", flex: "1 1 320px" }}>
              <span>User id or wallet address</span>
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="0x... or user id" />
            </label>
            <button type="submit" className="ui-btn ui-btn-primary" disabled={looking || !query.trim()}>
              {looking ? "Looking up..." : "Look up"}
            </button>
          </form>
          {lookupError ? <p role="alert" style={{ color: "#f87171", margin: 0 }}>{lookupError}</p> : null}
          {account ? (
            <AccountRestrictionPanel
              account={account}
              draft={draft}
              errors={errors}
              busy={busy}
              onChange={(patch) => {
                setDraft((previous) => ({ ...previous, ...patch }));
                setErrors({});
              }}
              onRequest={request}
            />
          ) : null}
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(confirm)}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={busy ? "Working..." : (confirm?.confirmLabel ?? "Confirm")}
        variant={confirm?.variant ?? "warning"}
        onConfirm={apply}
        onCancel={() => setPending(null)}
      />
    </AuthGate>
  );
}
