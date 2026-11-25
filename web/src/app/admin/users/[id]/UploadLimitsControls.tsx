"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "../../../../components/ui/ConfirmDialog";
import { useToast } from "../../../../components/ui/Toast";
import { getTrustTier, setArtistUploadLimitsLifted } from "../../../../lib/api";
import UploadLimitsPanel, { getUploadLimitsConfirmCopy, type UploadLimitsState } from "./UploadLimitsPanel";

/** #2659: lift or restore an artist's upload limits. Admins only; the server refuses others. */
export default function UploadLimitsControls({
  token,
  artistId,
  who,
}: {
  token: string | null;
  artistId: string;
  who: string;
}) {
  const { addToast } = useToast();
  const [state, setState] = useState<UploadLimitsState>({ status: "loading" });
  const [pending, setPending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!token) return;
    setState({ status: "loading" });
    getTrustTier(artistId, token)
      .then((trust) =>
        setState({
          status: "ready",
          lifted: Boolean(trust?.uploadLimitsLifted),
          verified: trust?.tier === "verified",
        }),
      )
      .catch((error: unknown) =>
        setState({ status: "error", message: error instanceof Error ? error.message : "Could not load upload limits." }),
      );
  }, [artistId, token]);

  useEffect(() => {
    reload();
  }, [reload]);

  const apply = async () => {
    if (!token || pending === null || busy) return;
    setBusy(true);
    try {
      const result = await setArtistUploadLimitsLifted(artistId, pending, token);
      setState((previous) =>
        previous.status === "ready" ? { ...previous, lifted: Boolean(result.liftedAt) } : previous,
      );
      addToast({
        type: "success",
        title: pending ? "Upload limits lifted" : "Upload limits restored",
        message: pending ? "They can now publish without the new-account limits." : "The new-account limits apply again.",
      });
    } catch (error) {
      addToast({
        type: "error",
        title: "Upload limits not changed",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const confirm = pending === null ? null : getUploadLimitsConfirmCopy(pending, who);

  return (
    <>
      <UploadLimitsPanel state={state} busy={busy} onRequest={setPending} onRetry={reload} />
      <ConfirmDialog
        isOpen={Boolean(confirm)}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={busy ? "Working..." : (confirm?.confirmLabel ?? "Confirm")}
        variant="default"
        onConfirm={apply}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
