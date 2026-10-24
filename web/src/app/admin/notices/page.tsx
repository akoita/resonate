"use client";

import { useCallback, useEffect, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useToast } from "../../../components/ui/Toast";
import { AdminStepUpCancelledError, withAdminStepUp } from "../../../lib/adminStepUp";
import { getAdminUsersOverview, getSentBroadcastNotices, sendBroadcastNotice } from "../../../lib/api";
import { loadPlatformNotices } from "../../../lib/platformNotices";
import {
  EMPTY_DRAFT,
  getSendConfirmMessage,
  toBroadcastInput,
  validateNoticeDraft,
  type NoticeDraft,
  type NoticeDraftErrors,
} from "./NoticeComposer";
import NoticesView from "./NoticesView";
import type { SentNoticesState } from "./SentNoticesList";

/**
 * #2146: operators compose a platform broadcast (policy, terms, incident) with
 * a live preview and a confirmation, and see what has already been sent.
 */
export default function AdminNoticesPage() {
  const { token, role, signMessage } = useAuth();
  const { addToast } = useToast();
  const canSend = role === "admin" || role === "operator";
  const [draft, setDraft] = useState<NoticeDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<NoticeDraftErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<SentNoticesState>({ status: "loading" });
  // Head count for the "who receives it" line; left out silently if the overview fails.
  const [audienceSize, setAudienceSize] = useState<number | null>(null);

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

  useEffect(() => {
    if (!token || !canSend) return;
    let cancelled = false;
    getAdminUsersOverview(token)
      .then((overview) => {
        if (!cancelled) setAudienceSize(overview.totalUsers);
      })
      .catch(() => {
        if (!cancelled) setAudienceSize(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canSend, token]);

  const checkDraft = () => {
    const found = validateNoticeDraft(draft);
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const send = async () => {
    if (!token || sending) return;
    setSending(true);
    try {
      // A broadcast cannot be recalled, so it needs a fresh passkey confirmation (#2173).
      await withAdminStepUp(
        {
          token,
          signMessage,
          onPrompt: () =>
            addToast({
              type: "info",
              title: "Confirm it is you",
              message: "Your passkey will ask you to confirm sending this notice.",
            }),
        },
        (proof) => sendBroadcastNotice(token, toBroadcastInput(draft), proof),
      );
      setConfirming(false);
      setDraft(EMPTY_DRAFT);
      addToast({ type: "success", title: "Notice sent", message: "It now appears in people's notifications." });
      void loadSent();
      void loadPlatformNotices(token);
    } catch (error) {
      setConfirming(false);
      if (error instanceof AdminStepUpCancelledError) {
        addToast({ type: "info", title: "Nothing sent", message: error.message });
        return;
      }
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
      <NoticesView
        canSend={canSend}
        draft={draft}
        errors={errors}
        sending={sending}
        audienceSize={audienceSize}
        sent={sent}
        onChange={(field, value) => {
          setDraft((previous) => ({ ...previous, [field]: value }));
          setErrors((previous) => ({ ...previous, [field]: undefined }));
        }}
        onRequestSend={() => {
          if (checkDraft()) setConfirming(true);
        }}
        onRetrySent={() => void loadSent()}
      />
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
