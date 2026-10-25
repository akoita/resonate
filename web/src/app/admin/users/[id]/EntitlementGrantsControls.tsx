"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../components/auth/AuthProvider";
import { ConfirmDialog } from "../../../../components/ui/ConfirmDialog";
import { useToast } from "../../../../components/ui/Toast";
import { createEntitlementGrant, listEntitlementGrants, revokeEntitlementGrant } from "../../../../lib/api";
import { AdminStepUpCancelledError, withAdminStepUp } from "../../../../lib/adminStepUp";
import EntitlementGrantsPanel, {
  EMPTY_GRANT_DRAFT,
  getGrantConfirmCopy,
  toGrantInput,
  validateGrantDraft,
  type GrantAction,
  type GrantDraft,
  type GrantDraftErrors,
  type GrantsState,
} from "./EntitlementGrantsPanel";

/**
 * #2406 controls (grant Pro until a date, revoke) on a person's record. Admins
 * only: the parent does not render this for operators, and the server refuses
 * them too. Granting and revoking are confirmed and need a fresh passkey
 * confirmation (#2173), asked for only when the server requires it.
 */
export default function EntitlementGrantsControls({
  token,
  userId,
  who,
  onChanged,
}: {
  token: string | null;
  userId: string;
  /** How the person is named in the confirmation. */
  who: string;
  /** After a change, so the record reloads and its operator activity shows it. */
  onChanged?: () => void;
}) {
  const { addToast } = useToast();
  const { signMessage } = useAuth();
  const [state, setState] = useState<GrantsState>({ status: "loading" });
  const [draft, setDraft] = useState<GrantDraft>(EMPTY_GRANT_DRAFT);
  const [errors, setErrors] = useState<GrantDraftErrors>({});
  const [pending, setPending] = useState<GrantAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    listEntitlementGrants(token, userId)
      .then((grants) => {
        if (!cancelled) setState({ status: "ready", grants });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Pro grants could not be loaded." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, userId, reloads]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setReloads((count) => count + 1);
  }, []);

  const request = (action: GrantAction) => {
    if (action.kind === "grant") {
      const found = validateGrantDraft(draft);
      setErrors(found);
      if (Object.keys(found).length > 0) return;
    }
    setPending(action);
  };

  const apply = async () => {
    if (!token || !pending || busy) return;
    setBusy(true);
    const stepUp = {
      token,
      signMessage,
      onPrompt: () =>
        addToast({ type: "info", title: "Confirm it is you", message: "Your passkey will ask you to confirm this change." }),
    };
    try {
      if (pending.kind === "grant") {
        const input = toGrantInput(userId, draft);
        await withAdminStepUp(stepUp, (proof) => createEntitlementGrant(token, input, proof));
        setDraft(EMPTY_GRANT_DRAFT);
        addToast({ type: "success", title: "Pro granted", message: "Their plan now reads Pro (granted)." });
      } else {
        const grantId = pending.grant.id;
        await withAdminStepUp(stepUp, (proof) => revokeEntitlementGrant(token, grantId, proof));
        addToast({ type: "success", title: "Grant revoked", message: "Their plan is back to Free." });
      }
      reload();
      onChanged?.();
    } catch (error) {
      if (error instanceof AdminStepUpCancelledError) {
        addToast({ type: "info", title: "Nothing changed", message: error.message });
        return;
      }
      addToast({
        type: "error",
        title: pending.kind === "grant" ? "Pro not granted" : "Grant not revoked",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const confirm = pending ? getGrantConfirmCopy(pending, who, draft) : null;

  return (
    <>
      <EntitlementGrantsPanel
        state={state}
        draft={draft}
        errors={errors}
        busy={busy}
        onChange={(patch) => {
          setDraft((previous) => ({ ...previous, ...patch }));
          setErrors({});
        }}
        onRequest={request}
        onRetry={reload}
      />
      <ConfirmDialog
        isOpen={Boolean(confirm)}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={busy ? "Working..." : (confirm?.confirmLabel ?? "Confirm")}
        variant={confirm?.variant ?? "default"}
        onConfirm={apply}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
