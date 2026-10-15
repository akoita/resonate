"use client";

import { useCallback, useEffect, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useToast } from "../../../components/ui/Toast";
import { getSentBroadcastNotices, sendBroadcastNotice, type SentBroadcastNotice } from "../../../lib/api";
import { loadPlatformNotices } from "../../../lib/platformNotices";
import NoticeComposer, {
  EMPTY_DRAFT,
  SentNoticesList,
  getSendConfirmMessage,
  toBroadcastInput,
  validateNoticeDraft,
  type NoticeDraft,
  type NoticeDraftErrors,
} from "./NoticeComposer";

type SentState = { status: "loading" } | { status: "error" } | { status: "ready"; notices: SentBroadcastNotice[] };

/**
 * #2146: operators compose a platform broadcast (policy, terms, incident) with
 * a preview and a confirmation, and see what has already been sent.
 */
export default function AdminNoticesPage() {
  const { token, role } = useAuth();
  const { addToast } = useToast();
  const canSend = role === "admin" || role === "operator";
  const [draft, setDraft] = useState<NoticeDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<NoticeDraftErrors>({});
  const [showPreview, setShowPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<SentState>({ status: "loading" });

  const loadSent = useCallback(async () => {
    if (!token || !canSend) return;
    setSent({ status: "loading" });
    try {
      const result = await getSentBroadcastNotices(token);
      setSent({ status: "ready", notices: result.notices });
    } catch {
      setSent({ status: "error" });
    }
  }, [canSend, token]);

  useEffect(() => {
    void loadSent();
  }, [loadSent]);

  const checkDraft = () => {
    const found = validateNoticeDraft(draft);
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const send = async () => {
    if (!token || sending) return;
    setSending(true);
    try {
      await sendBroadcastNotice(token, toBroadcastInput(draft));
      setConfirming(false);
      setDraft(EMPTY_DRAFT);
      setShowPreview(false);
      addToast({ type: "success", title: "Notice sent", message: "It now appears in people's notifications." });
      void loadSent();
      void loadPlatformNotices(token);
    } catch (error) {
      setConfirming(false);
      addToast({
        type: "error",
        title: "Notice not sent",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthGate title="Sign in with an operator account to send platform notices.">
      {!canSend ? (
        <p className="ui-card" style={{ padding: "20px" }}>
          Only operators and admins can send platform notices.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "20px", maxWidth: "860px" }}>
          <header>
            <h1 style={{ margin: 0 }}>Platform notices</h1>
            <p style={{ margin: "6px 0 0", opacity: 0.7 }}>
              Tell people about a policy or terms change, or an incident. Moderation notices are sent automatically to the
              person affected.
            </p>
          </header>
          <NoticeComposer
            draft={draft}
            errors={errors}
            showPreview={showPreview}
            sending={sending}
            onChange={(field, value) => {
              setDraft((previous) => ({ ...previous, [field]: value }));
              setErrors((previous) => ({ ...previous, [field]: undefined }));
            }}
            onPreview={() => {
              checkDraft();
              setShowPreview(true);
            }}
            onRequestSend={() => {
              if (checkDraft()) {
                setShowPreview(true);
                setConfirming(true);
              }
            }}
          />
          <SentNoticesList state={sent} onRetry={() => void loadSent()} />
        </div>
      )}
      <ConfirmDialog
        isOpen={confirming}
        title="Send this notice?"
        message={getSendConfirmMessage(draft)}
        confirmLabel={sending ? "Sending..." : "Send notice"}
        variant="warning"
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
    </AuthGate>
  );
}
