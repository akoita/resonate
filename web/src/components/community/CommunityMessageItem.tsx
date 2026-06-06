"use client";

import type { CommunityMessage } from "../../lib/api";
import { Button } from "../ui/Button";

/**
 * Shared message bubble for every community surface (listener cohorts, artist
 * rooms, campaign supporter rooms). All three previously rendered their own
 * near-identical `artist-community-message` markup; this is the single source
 * of truth so a message looks and behaves the same wherever it appears.
 *
 * The component is deliberately presentational: callers compute the
 * privacy-safe `author` label and decide which capabilities (`canDelete`,
 * `canReport`, moderation) apply for the current viewer. That keeps per-surface
 * policy (who may moderate, how authors are labelled) out of the shared bubble.
 */

/** A message is "removed" when moderation/author deletion has redacted its body. */
export function communityMessageRemoved(message: CommunityMessage) {
  return message.status !== "visible" || message.body == null;
}

export function formatCommunityMessageTime(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export type CommunityMessageItemProps = {
  message: CommunityMessage;
  /** Precomputed, privacy-safe author label. Raw ids must never be passed in. */
  author: string;
  /** Whether the message has been removed (hidden body, no actions). */
  removed: boolean;
  /** Render with the announcement treatment (artist/operator broadcasts). */
  announcement?: boolean;
  canDelete?: boolean;
  canReport?: boolean;
  canRemoveMember?: boolean;
  canBan?: boolean;
  deleteBusy?: boolean;
  onDelete?: () => void;
  onStartReport?: () => void;
  onRemoveMember?: () => void;
  onBan?: () => void;
  reporting?: boolean;
  reportReason?: string;
  reportBusy?: boolean;
  onReportReasonChange?: (value: string) => void;
  onSubmitReport?: () => void;
  onCancelReport?: () => void;
};

export function CommunityMessageItem({
  message,
  author,
  removed,
  announcement = false,
  canDelete = false,
  canReport = false,
  canRemoveMember = false,
  canBan = false,
  deleteBusy = false,
  onDelete,
  onStartReport,
  onRemoveMember,
  onBan,
  reporting = false,
  reportReason = "",
  reportBusy = false,
  onReportReasonChange,
  onSubmitReport,
  onCancelReport,
}: CommunityMessageItemProps) {
  const showActions = !removed && (canReport || canDelete || canRemoveMember || canBan);

  return (
    <article className={`artist-community-message${announcement ? " artist-community-message--announcement" : ""}`}>
      <div className="artist-community-message__meta">
        <strong>{author}</strong>
        <span>{formatCommunityMessageTime(message.createdAt)}</span>
      </div>
      <p>{removed ? "Message removed." : message.body}</p>

      {showActions ? (
        <div className="artist-community-message__actions">
          {canReport ? (
            <button type="button" onClick={onStartReport}>
              Report
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" onClick={onDelete} disabled={deleteBusy}>
              {deleteBusy ? "Deleting..." : "Delete"}
            </button>
          ) : null}
          {canRemoveMember ? (
            <button type="button" onClick={onRemoveMember}>
              Remove member
            </button>
          ) : null}
          {canBan ? (
            <button type="button" onClick={onBan}>
              Ban
            </button>
          ) : null}
        </div>
      ) : null}

      {reporting ? (
        <div className="artist-community-report">
          <input
            value={reportReason}
            onChange={(event) => onReportReasonChange?.(event.target.value)}
            aria-label="Report reason"
          />
          <Button
            variant="ghost"
            onClick={onSubmitReport}
            disabled={!reportReason.trim() || reportBusy}
          >
            {reportBusy ? "Sending..." : "Send report"}
          </Button>
          {onCancelReport ? (
            <Button variant="ghost" onClick={onCancelReport}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
