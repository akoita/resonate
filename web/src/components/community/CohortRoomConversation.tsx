"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createCommunityRoomMessage,
  deleteCommunityMessage,
  listCommunityRoomMessages,
  reportCommunityMessage,
  type CommunityMessage,
} from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../ui/Button";
import { CommunityMessageItem, communityMessageRemoved, formatCommunityMessageTime } from "./CommunityMessageItem";

type Notice = { type: "success" | "error" | "info"; message: string } | null;

type CohortRoomConversationProps = {
  roomId: string;
  /** Whether the room accepts new posts (active vs paused/archived). */
  roomActive: boolean;
  emptyTitle: string;
  emptyDescription: string;
};

const DEFAULT_REPORT_REASON = "Concern for moderator review";

export function cohortMessageAuthorLabel(message: CommunityMessage, currentUserId: string | null) {
  if (message.authorLabel) return message.authorLabel;
  if (message.authorId && currentUserId && message.authorId === currentUserId) return "You";
  return "Cohort member";
}

export function isOwnCohortMessage(message: CommunityMessage, currentUserId: string | null) {
  return Boolean(message.authorId && currentUserId && message.authorId === currentUserId);
}

export function cohortMessageRemoved(message: CommunityMessage) {
  return communityMessageRemoved(message);
}

/** @deprecated Use {@link formatCommunityMessageTime}; retained for compatibility. */
export const formatCohortMessageTime = formatCommunityMessageTime;

export default function CohortRoomConversation({
  roomId,
  roomActive,
  emptyTitle,
  emptyDescription,
}: CohortRoomConversationProps) {
  const { token, userId } = useAuth();
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState(DEFAULT_REPORT_REASON);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await listCommunityRoomMessages(token, roomId);
      setMessages(response.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load cohort room messages.");
    } finally {
      setLoading(false);
    }
  }, [token, roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePost = async () => {
    if (!token) return;
    const body = draft.trim();
    if (!body) return;
    setBusyKey("post");
    setNotice(null);
    try {
      const response = await createCommunityRoomMessage(token, roomId, { body });
      setMessages((current) => [...current, response.message]);
      setDraft("");
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Could not post message." });
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelete = async (message: CommunityMessage) => {
    if (!token) return;
    setBusyKey(`delete:${message.id}`);
    setNotice(null);
    try {
      await deleteCommunityMessage(token, message.id);
      setMessages((current) => current.filter((item) => item.id !== message.id));
      setNotice({ type: "info", message: "Message removed." });
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Could not delete message." });
    } finally {
      setBusyKey(null);
    }
  };

  const handleReport = async (message: CommunityMessage) => {
    if (!token || !reportReason.trim()) return;
    setBusyKey(`report:${message.id}`);
    setNotice(null);
    try {
      await reportCommunityMessage(token, message.id, reportReason.trim());
      setReportingMessageId(null);
      setReportReason(DEFAULT_REPORT_REASON);
      setNotice({ type: "success", message: "Report sent for moderator review." });
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Could not send report." });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <CohortRoomConversationView
      messages={messages}
      currentUserId={userId}
      loading={loading}
      error={error}
      roomActive={roomActive}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      draft={draft}
      busyKey={busyKey}
      notice={notice}
      reportingMessageId={reportingMessageId}
      reportReason={reportReason}
      onDraftChange={setDraft}
      onPost={handlePost}
      onRetry={load}
      onStartReport={(messageId) => {
        setReportingMessageId(messageId);
        setReportReason(DEFAULT_REPORT_REASON);
      }}
      onCancelReport={() => setReportingMessageId(null)}
      onReportReasonChange={setReportReason}
      onSubmitReport={handleReport}
      onDelete={handleDelete}
    />
  );
}

type ViewProps = {
  messages: CommunityMessage[];
  currentUserId: string | null;
  loading: boolean;
  error: string | null;
  roomActive: boolean;
  emptyTitle: string;
  emptyDescription: string;
  draft: string;
  busyKey: string | null;
  notice: Notice;
  reportingMessageId: string | null;
  reportReason: string;
  onDraftChange: (value: string) => void;
  onPost: () => void;
  onRetry: () => void;
  onStartReport: (messageId: string) => void;
  onCancelReport: () => void;
  onReportReasonChange: (value: string) => void;
  onSubmitReport: (message: CommunityMessage) => void;
  onDelete: (message: CommunityMessage) => void;
};

export function CohortRoomConversationView({
  messages,
  currentUserId,
  loading,
  error,
  roomActive,
  emptyTitle,
  emptyDescription,
  draft,
  busyKey,
  notice,
  reportingMessageId,
  reportReason,
  onDraftChange,
  onPost,
  onRetry,
  onStartReport,
  onCancelReport,
  onReportReasonChange,
  onSubmitReport,
  onDelete,
}: ViewProps) {
  return (
    <div className="cohort-room-conversation" aria-label="Cohort room conversation">
      {!roomActive ? (
        <div className="listener-cohorts-state listener-cohorts-state--locked">
          <strong>Room is read-only</strong>
          <p>This cohort room is paused or archived. You can read messages but cannot post right now.</p>
        </div>
      ) : null}

      {notice ? (
        <div className={`artist-community__notice artist-community__notice--${notice.type === "error" ? "error" : "success"}`}>
          {notice.message}
        </div>
      ) : null}

      {loading ? (
        <div className="listener-cohorts-state">Loading conversation...</div>
      ) : error ? (
        <div className="listener-cohorts-state listener-cohorts-state--locked">
          <strong>Conversation unavailable</strong>
          <p>{error}</p>
          <Button variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : messages.length === 0 ? (
        <div className="artist-community__chat-empty">
          <strong>{emptyTitle}</strong>
          <p>{emptyDescription}</p>
        </div>
      ) : (
        <div className="cohort-room-conversation__messages" aria-live="polite">
          {messages.map((message) => {
            const own = isOwnCohortMessage(message, currentUserId);
            const removed = cohortMessageRemoved(message);
            return (
              <CommunityMessageItem
                key={message.id}
                message={message}
                author={cohortMessageAuthorLabel(message, currentUserId)}
                removed={removed}
                canDelete={own}
                canReport={!own}
                deleteBusy={busyKey === `delete:${message.id}`}
                onDelete={() => onDelete(message)}
                onStartReport={() => onStartReport(message.id)}
                reporting={reportingMessageId === message.id}
                reportReason={reportReason}
                reportBusy={busyKey === `report:${message.id}`}
                onReportReasonChange={onReportReasonChange}
                onSubmitReport={() => onSubmitReport(message)}
                onCancelReport={onCancelReport}
              />
            );
          })}
        </div>
      )}

      {roomActive && !loading && !error ? (
        <div className="artist-community-composer">
          <label htmlFor="cohort-room-message">Message</label>
          <textarea
            id="cohort-room-message"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Share something with this cohort"
            rows={3}
          />
          <Button onClick={onPost} disabled={!draft.trim() || busyKey === "post"}>
            {busyKey === "post" ? "Posting..." : "Post message"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
