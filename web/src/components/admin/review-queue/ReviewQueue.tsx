"use client";

/**
 * Shared building blocks for operator review queues (artist claims,
 * management transfer recovery, ...). Presentational only: queue pages own
 * their data, session scoping, and decision state and pass it in as props.
 * Styles live in `src/styles/review-queue.css` (class prefix `review-queue-`).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../../ui/Button";

export const REVIEW_NOTE_MAX_LENGTH = 4000;

export type ReviewDecision = "approve" | "reject";

/* ---------- Time helpers ---------- */

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export type FormattedRequestTime = { iso: string; relative: string; absolute: string };

export function formatRequestedAt(value: string, now: number = Date.now()): FormattedRequestTime | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const elapsedSeconds = Math.round((date.getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  let relative = "just now";
  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (Math.abs(elapsedSeconds) >= seconds) {
      relative = formatter.format(Math.trunc(elapsedSeconds / seconds), unit);
      break;
    }
  }
  return {
    iso: date.toISOString(),
    relative,
    absolute: date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
  };
}

/** Formatted time of the oldest valid `createdAt`, or null when none parse. */
export function oldestCreatedAt(items: ReadonlyArray<{ createdAt: string }>, now?: number) {
  let oldest: string | null = null;
  let oldestTime = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const time = new Date(item.createdAt).getTime();
    if (!Number.isNaN(time) && time < oldestTime) {
      oldestTime = time;
      oldest = item.createdAt;
    }
  }
  return oldest ? formatRequestedAt(oldest, now) : null;
}

/* ---------- Icons ---------- */

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

export const CheckIcon = ({ size }: IconProps) => (
  <Icon size={size}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></Icon>
);
export const AlertIcon = ({ size }: IconProps) => (
  <Icon size={size}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.5h.01" /></Icon>
);
export const LockIcon = ({ size }: IconProps) => (
  <Icon size={size}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></Icon>
);
export const InboxIcon = ({ size }: IconProps) => (
  <Icon size={size}><path d="M4 13.5 6.5 5h11l2.5 8.5" /><path d="M4 13.5V19h16v-5.5h-5a3 3 0 0 1-6 0z" /></Icon>
);
export const InfoIcon = ({ size }: IconProps) => (
  <Icon size={size}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.5h.01" /></Icon>
);
export const RefreshIcon = ({ size }: IconProps) => (
  <Icon size={size}><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 20v-4h-4" /></Icon>
);

/* ---------- Copy control ---------- */

export function CopyValueButton({ value, subject }: { value: string; subject: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const copy = async () => {
    let next: "copied" | "failed" = "failed";
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        next = "copied";
      }
    } catch {
      next = "failed";
    }
    setStatus(next);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setStatus("idle"), 1500);
  };

  return (
    <button type="button" className="review-queue-copy" onClick={() => void copy()}>
      <span aria-live="polite">
        {status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Copy"}
        <span className="visually-hidden">{` ${subject}`}</span>
      </span>
    </button>
  );
}

/**
 * A value with a Copy control. `text` is what is displayed (defaults to
 * `value`); `value` is what is copied. Values render monospace unless
 * `plain` is set (e.g. email addresses).
 */
export function CopyableValue({
  value,
  subject,
  text,
  muted = false,
  plain = false,
}: {
  value: string;
  subject: string;
  text?: string;
  muted?: boolean;
  plain?: boolean;
}) {
  const className = plain
    ? "review-queue-text"
    : muted ? "review-queue-mono review-queue-mono--muted" : "review-queue-mono";
  return (
    <span className="review-queue-value-row">
      <span className={className}>{text ?? value}</span>
      <CopyValueButton value={value} subject={subject} />
    </span>
  );
}

/* ---------- Page chrome ---------- */

export function ReviewQueuePage({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <main
      className={`analytics-container review-queue${className ? ` ${className}` : ""}`}
      style={{ padding: "12px 0 64px" }}
    >
      {children}
    </main>
  );
}

export type ReviewQueueSummary = {
  pendingCount: number;
  oldest: FormattedRequestTime | null;
  onRefresh: () => void;
};

export function ReviewQueueHeader({
  eyebrow,
  title,
  description,
  summary,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  summary?: ReviewQueueSummary | null;
}) {
  return (
    <header className="analytics-header-section review-queue-header">
      <p className="artist-analytics-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="analytics-muted review-queue-intro">{description}</p>
      {summary && summary.pendingCount > 0 ? (
        <div className="review-queue-summary">
          <span className="review-queue-pill review-queue-pill--count">{`${summary.pendingCount} pending`}</span>
          {summary.oldest ? (
            <span className="review-queue-summary__oldest">
              Oldest requested{" "}
              <time dateTime={summary.oldest.iso} title={summary.oldest.absolute}>{summary.oldest.relative}</time>
            </span>
          ) : null}
          <Button variant="ghost" className="review-queue-refresh" onClick={summary.onRefresh}>
            <RefreshIcon size={16} />
            Refresh
          </Button>
        </div>
      ) : null}
    </header>
  );
}

export function ReviewQueueSuccess({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="review-queue-success" role="status">
      <CheckIcon />
      <span>{message}</span>
    </p>
  );
}

export function ReviewQueueLoading({ statusText }: { statusText: string }) {
  return (
    <section className="review-queue-list" aria-busy="true">
      <p className="visually-hidden" role="status">{statusText}</p>
      {[0, 1].map((index) => (
        <div key={index} className="review-queue-card review-queue-card--skeleton" aria-hidden="true">
          <span className="review-queue-skeleton review-queue-skeleton--title" />
          <span className="review-queue-skeleton review-queue-skeleton--line" />
          <span className="review-queue-skeleton review-queue-skeleton--block" />
          <span className="review-queue-skeleton review-queue-skeleton--line review-queue-skeleton--short" />
        </div>
      ))}
    </section>
  );
}

export type ReviewQueueStateVariant = "forbidden" | "error" | "empty";

/**
 * Full-width state panel. `forbidden` and `error` are announced as alerts;
 * `error` renders a primary retry action and `empty` a ghost refresh action.
 */
export function ReviewQueueStatePanel({
  variant,
  heading,
  body,
  actionLabel,
  onAction,
}: {
  variant: ReviewQueueStateVariant;
  heading: string;
  body: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const isAlert = variant !== "empty";
  return (
    <section className="review-queue-card review-queue-state" role={isAlert ? "alert" : undefined}>
      <span className={`review-queue-state__icon${isAlert ? " review-queue-state__icon--error" : ""}`}>
        {variant === "forbidden" ? <LockIcon size={22} /> : variant === "error" ? <AlertIcon size={22} /> : <InboxIcon size={22} />}
      </span>
      <h2>{heading}</h2>
      <p className="analytics-muted">{body}</p>
      {actionLabel && onAction ? (
        variant === "empty" ? (
          <Button variant="ghost" onClick={onAction}>
            <RefreshIcon size={16} />
            {actionLabel}
          </Button>
        ) : (
          <Button variant="primary" onClick={onAction}>{actionLabel}</Button>
        )
      ) : null}
    </section>
  );
}

export function ReviewQueueList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="review-queue-list" aria-label={label}>
      {children}
    </section>
  );
}

/* ---------- Card ---------- */

export function ReviewPill({ tone, children }: { tone: "pending" | "warning"; children: ReactNode }) {
  return <span className={`review-queue-pill review-queue-pill--${tone}`}>{children}</span>;
}

export function ReviewCard({
  titleId,
  title,
  requestedAt,
  badges,
  children,
}: {
  titleId: string;
  title: ReactNode;
  requestedAt: string;
  badges?: ReactNode;
  children: ReactNode;
}) {
  const requested = formatRequestedAt(requestedAt);
  return (
    <article className="review-queue-card" aria-labelledby={titleId}>
      <header className="review-queue-card__header">
        <div className="review-queue-card__title">
          <h2 id={titleId}>{title}</h2>
          <p className="review-queue-card__time">
            {requested ? (
              <>
                <time dateTime={requested.iso} title={requested.absolute}>{`Requested ${requested.relative}`}</time>
                <span aria-hidden="true"> · </span>
                <span>{requested.absolute}</span>
              </>
            ) : "Requested: Unknown date"}
          </p>
        </div>
        {badges ? <div className="review-queue-card__badges">{badges}</div> : null}
      </header>
      {children}
    </article>
  );
}

export function ReviewDetails({ children }: { children: ReactNode }) {
  return <dl className="review-queue-details">{children}</dl>;
}

export function ReviewDetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="review-queue-details__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function ReviewEvidence({ headingId, heading = "Submitted evidence", text }: { headingId: string; heading?: string; text: string }) {
  return (
    <section className="review-queue-evidence" aria-labelledby={headingId}>
      <h3 id={headingId}>{heading}</h3>
      <p>{text}</p>
    </section>
  );
}

/* ---------- Decision footer ---------- */

export function ReviewNotice({ tone, children }: { tone: "info" | "warning"; children: ReactNode }) {
  return (
    <p className={`review-queue-notice review-queue-notice--${tone}`}>
      {tone === "info" ? <InfoIcon /> : <AlertIcon />}
      <span>{children}</span>
    </p>
  );
}

export function ReviewDecisionFooter({
  idPrefix,
  itemId,
  selfReviewMessage,
  notices,
  note,
  onNoteChange,
  error,
  approveLabel,
  rejectLabel,
  inFlightDecision,
  disabled,
  onApprove,
  onReject,
}: {
  /** Prefix for element IDs, e.g. `claim` → `claim-review-note-<itemId>`. */
  idPrefix: string;
  itemId: string;
  /** When set, only this notice renders: the reviewer cannot decide the item. */
  selfReviewMessage?: string | null;
  notices?: ReactNode;
  note: string;
  onNoteChange: (value: string) => void;
  error?: string;
  approveLabel: string;
  rejectLabel: string;
  /** Decision in flight for this item; only that button shows a progress label. */
  inFlightDecision: ReviewDecision | null;
  /** Disables both decision buttons (e.g. while any review is saving). */
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const noteId = `${idPrefix}-review-note-${itemId}`;
  const errorId = `${idPrefix}-review-error-${itemId}`;
  const hintId = `${idPrefix}-review-hint-${itemId}`;

  return (
    <div className="review-queue-decision">
      {selfReviewMessage ? (
        <p className="review-queue-self-review" role="note">
          <InfoIcon />
          <span>{selfReviewMessage}</span>
        </p>
      ) : (
        <>
          {notices}
          <div className="review-queue-note">
            <div className="review-queue-note__label-row">
              <label htmlFor={noteId}>Review note</label>
              <span className="review-queue-pill review-queue-pill--required">Required</span>
            </div>
            <textarea
              id={noteId}
              required
              maxLength={REVIEW_NOTE_MAX_LENGTH}
              rows={4}
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
            />
            <div className="review-queue-note__meta">
              <p id={hintId}>Record the reason for your decision.</p>
              <span className="review-queue-note__count">{`${note.length} / ${REVIEW_NOTE_MAX_LENGTH}`}</span>
            </div>
            {error ? (
              <p id={errorId} className="review-queue-error" role="alert">
                <AlertIcon size={16} />
                <span>{error}</span>
              </p>
            ) : null}
          </div>
          <div className="review-queue-actions">
            <Button variant="primary" disabled={disabled} onClick={onApprove}>
              {inFlightDecision === "approve" ? "Approving…" : approveLabel}
            </Button>
            <Button variant="ghost" className="review-queue-reject" disabled={disabled} onClick={onReject}>
              {inFlightDecision === "reject" ? "Rejecting…" : rejectLabel}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
