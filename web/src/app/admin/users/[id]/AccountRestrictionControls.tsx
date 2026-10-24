"use client";

import { useState } from "react";
import { useAuth } from "../../../../components/auth/AuthProvider";
import { ConfirmDialog } from "../../../../components/ui/ConfirmDialog";
import { useToast } from "../../../../components/ui/Toast";
import {
  closeAccount,
  suspendAccount,
  unsuspendAccount,
  type AdminAccountStatus,
} from "../../../../lib/api";
import { AdminStepUpCancelledError, withAdminStepUp } from "../../../../lib/adminStepUp";
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
 * #2147 controls (suspend, lift, close) on a user's record. Admins only: the
 * parent does not render this for operators, and the server refuses them too.
 * Every change is confirmed and tells the person with a notice. Suspending and
 * closing also need a fresh passkey confirmation (#2173); it is asked for only
 * when the server requires it, and then good for a few minutes.
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
  const { signMessage } = useAuth();
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
      const stepUp = {
        token,
        signMessage,
        onPrompt: () =>
          addToast({
            type: "info",
            title: "Confirm it is you",
            message: "Your passkey will ask you to confirm this change.",
          }),
      };
      const updated =
        pending === "suspend"
          ? await withAdminStepUp(stepUp, (proof) =>
              suspendAccount(token, target, input as Parameters<typeof suspendAccount>[2], proof),
            )
          : pending === "unsuspend"
            ? await unsuspendAccount(token, target, input)
            : await withAdminStepUp(stepUp, (proof) =>
                closeAccount(token, target, input as Parameters<typeof closeAccount>[2], proof),
              );
      setDraft(EMPTY_RESTRICTION_DRAFT);
      onChanged(updated);
      addToast({ type: "success", title: "Account updated", message: "The person has been sent a notice." });
    } catch (error) {
      if (error instanceof AdminStepUpCancelledError) {
        // They dismissed the passkey prompt: nothing was sent, so nothing to report as an error.
        addToast({ type: "info", title: "Nothing changed", message: error.message });
        return;
      }
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
