"use client";

import { useState } from "react";
import { ConfirmDialog } from "../../../../components/ui/ConfirmDialog";
import { useToast } from "../../../../components/ui/Toast";
import {
  closeAccount,
  suspendAccount,
  unsuspendAccount,
  type AdminAccountStatus,
} from "../../../../lib/api";
import AccountRestrictionPanel, {
  EMPTY_RESTRICTION_DRAFT,
  getRestrictionConfirmCopy,
  toRestrictionInput,
  validateRestrictionDraft,
  type RestrictionAction,
  type RestrictionDraft,
  type RestrictionDraftErrors,
} from "../../accounts/AccountRestrictionPanel";

/**
 * #2147 controls (suspend, lift, close) on a user's record. Admins only: the
 * parent does not render this for operators, and the server refuses them too.
 * Every change is confirmed and tells the person with a notice.
 */
export default function AccountRestrictionControls({
  token,
  account,
  onChanged,
}: {
  token: string | null;
  account: AdminAccountStatus;
  onChanged: (updated: AdminAccountStatus) => void;
}) {
  const { addToast } = useToast();
  const [draft, setDraft] = useState<RestrictionDraft>(EMPTY_RESTRICTION_DRAFT);
  const [errors, setErrors] = useState<RestrictionDraftErrors>({});
  const [pending, setPending] = useState<RestrictionAction | null>(null);
  const [busy, setBusy] = useState(false);

  const request = (action: RestrictionAction) => {
    const found = validateRestrictionDraft(action, draft);
    setErrors(found);
    if (Object.keys(found).length === 0) setPending(action);
  };

  const apply = async () => {
    if (!token || !pending || busy) return;
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
      setDraft(EMPTY_RESTRICTION_DRAFT);
      onChanged(updated);
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

  const confirm = pending ? getRestrictionConfirmCopy(pending, account, draft) : null;

  return (
    <>
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
      <ConfirmDialog
        isOpen={Boolean(confirm)}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={busy ? "Working..." : (confirm?.confirmLabel ?? "Confirm")}
        variant={confirm?.variant ?? "warning"}
        onConfirm={apply}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
