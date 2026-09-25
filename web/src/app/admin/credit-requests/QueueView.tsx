"use client";

import { useId, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import {
  AlertIcon,
  CopyableValue,
  InfoIcon,
  RefreshIcon,
  ReviewCard,
  ReviewDetailItem,
  ReviewDetails,
  ReviewEvidence,
  ReviewPill,
  ReviewQueueHeader,
  ReviewQueueList,
  ReviewQueueLoading,
  ReviewQueuePage,
  ReviewQueueStatePanel,
  ReviewQueueSuccess,
  formatRequestedAt,
  oldestCreatedAt,
} from "../../../components/admin/review-queue/ReviewQueue";
import type { CreditRequest } from "../../../lib/api";
import { formatCreditCapacity } from "../../../lib/credits";
import { DEFAULT_GRANT_REASON, QUICK_GRANT_CENTS, formatUsdCents } from "./amount";

export type CreditRequestsTab = "pending" | "resolved";

export type CreditRequestsQueueState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; requests: CreditRequest[] };

/** Per-request form input. Missing fields fall back to their defaults. */
export type CreditRequestDraft = {
  amount?: string;
  reason?: string;
  dismissNote?: string;
};

export type CreditRequestAction = "grant" | "dismiss";

export type PendingGrant = { request: CreditRequest; amountCents: number; reason: string };
export type PendingDismissal = { request: CreditRequest; note: string };

/** Mirror the API limits so input is never silently rejected server-side. */
export const GRANT_REASON_MAX_LENGTH = 120;
export const DISMISS_NOTE_MAX_LENGTH = 280;

export const SELF_REQUEST_MESSAGE = "This is your own request — another operator has to resolve it.";

/**
 * Whether the signed-in operator filed this request. Operators may not
 * resolve their own request (the API answers 403 `self_review_forbidden`).
 * Same case-insensitive comparison as the artist-claims queue.
 */
export function reviewerIsRequester(reviewerUserId: string | null, requesterUserId: string) {
  return Boolean(
    reviewerUserId
    && requesterUserId
    && reviewerUserId.toLowerCase() === requesterUserId.toLowerCase(),
  );
}

/** Shorten a wallet address or user id for display: "0xa536…82cb". */
export function shortenId(id: string) {
  const value = id.trim();
  if (value.length <= 13) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function draftReason(draft: CreditRequestDraft | undefined) {
  return draft?.reason ?? DEFAULT_GRANT_REASON;
}

export function getGrantConfirmMessage({ request, amountCents, reason }: PendingGrant) {
  const lines = [`Grant ${formatUsdCents(amountCents)} of generation credits to ${shortenId(request.userId)}?`];
  const trimmedReason = reason.trim();
  lines.push(
    trimmedReason
      ? `Reason recorded in the credit ledger: “${trimmedReason}”.`
      : "The grant is recorded in the credit ledger.",
  );
  lines.push(`Requester: ${request.userId}`);
  return lines.join("\n\n");
}

export function getDismissConfirmMessage({ request, note }: PendingDismissal) {
  const lines = [`Dismiss the credit request from ${shortenId(request.userId)} without granting credits?`];
  const trimmedNote = note.trim();
  lines.push(trimmedNote ? `Dismissal note: “${trimmedNote}”.` : "No dismissal note will be recorded.");
  lines.push(`Requester: ${request.userId}`);
  return lines.join("\n\n");
}

export function formatBalance(balanceCents: number, priceCentsPer30s: number | null) {
  const dollars = formatUsdCents(balanceCents);
  if (priceCentsPer30s === null || priceCentsPer30s <= 0) return dollars;
  const capacity = formatCreditCapacity(balanceCents, priceCentsPer30s);
  return `${dollars} · ≈ ${capacity.minLabel} min of generation`;
}

function TimeLabel({ value, prefix }: { value: string | null; prefix?: string }) {
  const formatted = value ? formatRequestedAt(value) : null;
  if (!formatted) return <span className="review-queue-text review-queue-text--muted">Unknown date</span>;
  return (
    <span className="review-queue-text">
      <time dateTime={formatted.iso} title={formatted.absolute}>
        {prefix ? `${prefix} ${formatted.relative}` : formatted.relative}
      </time>
      <span className="review-queue-mono--muted">{` · ${formatted.absolute}`}</span>
    </span>
  );
}

function Requester({ userId }: { userId: string }) {
  return (
    <span title={userId}>
      <CopyableValue value={userId} text={shortenId(userId)} subject="requester user ID" />
    </span>
  );
}

function StatusPill({ request }: { request: CreditRequest }) {
  if (request.status === "granted") {
    return (
      <span className="review-queue-pill border-[rgba(52,211,153,0.45)] bg-[rgba(52,211,153,0.12)] text-[var(--r-success)]">
        {request.grantedCents !== null ? `Granted ${formatUsdCents(request.grantedCents)}` : "Granted"}
      </span>
    );
  }
  if (request.status === "dismissed") {
    return <span className="review-queue-pill bg-[var(--r-surface-highest)] text-[var(--r-on-surface-variant)]">Dismissed</span>;
  }
  return <ReviewPill tone="pending">Pending</ReviewPill>;
}

const fieldClass =
  "w-full min-h-[44px] rounded-[10px] border border-[var(--r-outline)] bg-[var(--r-surface-lowest)] px-3 py-2 text-[var(--r-on-surface)] focus-visible:border-[var(--r-primary-soft)]";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">{label}</label>
      {children}
      {hint ? <p className="m-0 text-[12px] text-[var(--r-on-surface-muted)]">{hint}</p> : null}
    </div>
  );
}

type CreditRequestsQueueViewProps = {
  tab: CreditRequestsTab;
  state: CreditRequestsQueueState;
  /** Signed-in operator; their own pending requests render locked. */
  reviewerUserId: string | null;
  priceCentsPer30s: number | null;
  drafts: Record<string, CreditRequestDraft>;
  errors: Record<string, string>;
  inFlight: { requestId: string; action: CreditRequestAction } | null;
  pendingGrant: PendingGrant | null;
  pendingDismissal: PendingDismissal | null;
  successMessage: string | null;
  onTabChange: (tab: CreditRequestsTab) => void;
  onRetry: () => void;
  onDraftChange: (requestId: string, field: keyof CreditRequestDraft, value: string) => void;
  onQuickGrant: (request: CreditRequest, amountCents: number) => void;
  onRequestGrant: (request: CreditRequest) => void;
  onRequestDismiss: (request: CreditRequest) => void;
  onCancelGrant: () => void;
  onConfirmGrant: () => Promise<void>;
  onCancelDismiss: () => void;
  onConfirmDismiss: () => Promise<void>;
};

const TABS: Array<{ id: CreditRequestsTab; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "resolved", label: "Resolved" },
];

function QueueTabs({
  tab,
  panelId,
  onTabChange,
}: {
  tab: CreditRequestsTab;
  panelId: string;
  onTabChange: (tab: CreditRequestsTab) => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    onTabChange(TABS[next].id);
    const sibling = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
    sibling?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Credit request status"
      className="inline-flex gap-1 rounded-full border border-[var(--r-outline)] bg-[var(--r-surface-lowest)] p-1"
    >
      {TABS.map((item, index) => {
        const selected = item.id === tab;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`credit-requests-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onTabChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`min-h-[36px] cursor-pointer rounded-full border-0 px-4 text-[14px] font-semibold transition-colors ${
              selected
                ? "bg-[rgba(124,92,255,0.22)] text-[var(--r-on-surface)]"
                : "bg-transparent text-[var(--r-on-surface-muted)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[var(--r-on-surface)]"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function PendingDecision({
  request,
  draft,
  error,
  inFlight,
  busy,
  locked,
  onDraftChange,
  onQuickGrant,
  onRequestGrant,
  onRequestDismiss,
}: {
  request: CreditRequest;
  draft: CreditRequestDraft | undefined;
  error: string | undefined;
  inFlight: CreditRequestAction | null;
  busy: boolean;
  /** The reviewer filed this request: every action is shown but locked. */
  locked: boolean;
  onDraftChange: (field: keyof CreditRequestDraft, value: string) => void;
  onQuickGrant: (amountCents: number) => void;
  onRequestGrant: () => void;
  onRequestDismiss: () => void;
}) {
  const amountId = `credit-request-amount-${request.id}`;
  const reasonId = `credit-request-reason-${request.id}`;
  const dismissNoteId = `credit-request-dismiss-note-${request.id}`;
  const errorId = `credit-request-error-${request.id}`;
  const lockedId = `credit-request-locked-${request.id}`;
  // Locked controls stay focusable (aria-disabled, not disabled) so the reason
  // is announced; their click handlers are removed so they never act.
  const actionProps = (onClick: () => void) => locked
    ? { "aria-disabled": true as const, "aria-describedby": lockedId, disabled: busy }
    : { disabled: busy, onClick };
  const inputLockProps = locked ? { disabled: true, "aria-describedby": lockedId } : {};

  return (
    <div className="review-queue-decision">
      {locked ? (
        <p id={lockedId} className="review-queue-self-review" role="note">
          <InfoIcon />
          <span>{SELF_REQUEST_MESSAGE}</span>
        </p>
      ) : null}
      <div className="grid gap-2">
        <span className="text-[13px] font-semibold">Quick grant</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Quick grant amounts for ${shortenId(request.userId)}`}>
          {QUICK_GRANT_CENTS.map((cents) => (
            <Button
              key={cents}
              variant="ghost"
              className="min-h-[44px]"
              {...actionProps(() => onQuickGrant(cents))}
            >
              {`Grant ${formatUsdCents(cents)}`}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
        <Field id={amountId} label="Custom amount (USD)" hint="$0.01 to $100,000.00">
          <input
            id={amountId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 2.50"
            className={fieldClass}
            value={draft?.amount ?? ""}
            onChange={(event) => onDraftChange("amount", event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            {...inputLockProps}
          />
        </Field>
        <Field id={reasonId} label="Grant reason (optional)" hint="Recorded in the credit ledger.">
          <input
            id={reasonId}
            type="text"
            maxLength={GRANT_REASON_MAX_LENGTH}
            className={fieldClass}
            value={draftReason(draft)}
            onChange={(event) => onDraftChange("reason", event.target.value)}
            {...inputLockProps}
          />
        </Field>
      </div>

      <Field id={dismissNoteId} label="Dismissal note (optional)" hint="Only used if you dismiss this request.">
        <input
          id={dismissNoteId}
          type="text"
          maxLength={DISMISS_NOTE_MAX_LENGTH}
          className={fieldClass}
          value={draft?.dismissNote ?? ""}
          onChange={(event) => onDraftChange("dismissNote", event.target.value)}
          {...inputLockProps}
        />
      </Field>

      {error ? (
        <p id={errorId} className="review-queue-error" role="alert">
          <AlertIcon size={16} />
          <span>{error}</span>
        </p>
      ) : null}

      <div className="review-queue-actions">
        <Button variant="primary" {...actionProps(onRequestGrant)}>
          {inFlight === "grant" ? "Granting…" : "Grant custom amount"}
        </Button>
        <Button variant="ghost" className="review-queue-reject" {...actionProps(onRequestDismiss)}>
          {inFlight === "dismiss" ? "Dismissing…" : "Dismiss request"}
        </Button>
      </div>
    </div>
  );
}

export default function CreditRequestsQueueView({
  tab,
  state,
  reviewerUserId,
  priceCentsPer30s,
  drafts,
  errors,
  inFlight,
  pendingGrant,
  pendingDismissal,
  successMessage,
  onTabChange,
  onRetry,
  onDraftChange,
  onQuickGrant,
  onRequestGrant,
  onRequestDismiss,
  onCancelGrant,
  onConfirmGrant,
  onCancelDismiss,
  onConfirmDismiss,
}: CreditRequestsQueueViewProps) {
  const panelId = useId();
  const requests = state.status === "ready" ? state.requests : [];
  const isPending = tab === "pending";
  const oldest = isPending ? oldestCreatedAt(requests.map((request) => ({ createdAt: request.requestedAt }))) : null;

  return (
    <ReviewQueuePage className="credit-requests-admin">
      <ReviewQueueHeader
        eyebrow="Operator review"
        title="Credit requests"
        description={(
          <>
            Users who run out of generation credits can ask for a top-up. Review each request, then grant credits or dismiss it.
            Every grant is recorded in the credit ledger and the requester is notified.
          </>
        )}
      />

      {state.status === "forbidden" ? (
        <ReviewQueueStatePanel
          variant="forbidden"
          heading="Access denied"
          body="Only operators and administrators can review credit requests."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <QueueTabs tab={tab} panelId={panelId} onTabChange={onTabChange} />
            {state.status === "ready" && requests.length > 0 ? (
              <span className="review-queue-pill review-queue-pill--count">
                {`${requests.length} ${isPending ? "pending" : "resolved"}`}
              </span>
            ) : null}
            {oldest ? (
              <span className="review-queue-summary__oldest">
                Oldest requested{" "}
                <time dateTime={oldest.iso} title={oldest.absolute}>{oldest.relative}</time>
              </span>
            ) : null}
            <Button
              variant="ghost"
              className="ml-auto min-h-[44px]"
              disabled={state.status === "loading"}
              onClick={onRetry}
            >
              <RefreshIcon size={16} />
              {state.status === "loading" ? "Loading…" : "Refresh"}
            </Button>
          </div>

          <ReviewQueueSuccess message={successMessage} />

          <div id={panelId} role="tabpanel" aria-labelledby={`credit-requests-tab-${tab}`} className="grid gap-5">
            {state.status === "loading" ? (
              <ReviewQueueLoading statusText={isPending ? "Loading pending credit requests…" : "Loading resolved credit requests…"} />
            ) : null}

            {state.status === "error" ? (
              <ReviewQueueStatePanel
                variant="error"
                heading="Unable to load credit requests"
                body={state.message}
                actionLabel="Try again"
                onAction={onRetry}
              />
            ) : null}

            {state.status === "ready" && requests.length === 0 ? (
              <ReviewQueueStatePanel
                variant="empty"
                heading={isPending ? "No pending credit requests" : "No resolved credit requests"}
                body={isPending
                  ? "New requests for generation credits will appear here."
                  : "Granted and dismissed requests will appear here."}
                actionLabel="Refresh queue"
                onAction={onRetry}
              />
            ) : null}

            {requests.length > 0 ? (
              <ReviewQueueList label={isPending ? "Pending credit requests" : "Resolved credit requests"}>
                {requests.map((request) => {
                  const pending = request.status === "pending";
                  const isOwnRequest = reviewerIsRequester(reviewerUserId, request.userId);
                  return (
                    <ReviewCard
                      key={request.id}
                      titleId={`credit-request-title-${request.id}`}
                      title={<span title={request.userId}>{`Credit request from ${shortenId(request.userId)}`}</span>}
                      requestedAt={request.requestedAt}
                      badges={(
                        <>
                          {pending && isOwnRequest ? <ReviewPill tone="warning">Your request</ReviewPill> : null}
                          {pending && request.balanceCents <= 0 ? <ReviewPill tone="warning">Out of credits</ReviewPill> : null}
                          <StatusPill request={request} />
                        </>
                      )}
                    >
                      <ReviewDetails>
                        <ReviewDetailItem label="Requester">
                          <Requester userId={request.userId} />
                        </ReviewDetailItem>
                        <ReviewDetailItem label="Current balance">
                          <span className="review-queue-text">{formatBalance(request.balanceCents, priceCentsPer30s)}</span>
                        </ReviewDetailItem>
                        {!pending ? (
                          <>
                            <ReviewDetailItem label="Resolved">
                              <TimeLabel value={request.resolvedAt} />
                            </ReviewDetailItem>
                            <ReviewDetailItem label="Resolved by">
                              {request.resolvedBy ? (
                                <span title={request.resolvedBy}>
                                  <CopyableValue value={request.resolvedBy} text={shortenId(request.resolvedBy)} subject="operator user ID" />
                                </span>
                              ) : (
                                <span className="review-queue-text review-queue-text--muted">Unknown</span>
                              )}
                            </ReviewDetailItem>
                          </>
                        ) : null}
                      </ReviewDetails>

                      {request.note?.trim() ? (
                        <ReviewEvidence headingId={`credit-request-note-${request.id}`} heading="Requester note" text={request.note} />
                      ) : (
                        <p className="review-queue-text review-queue-text--muted mx-6 mt-4">No note from the requester.</p>
                      )}

                      {!pending && request.resolutionNote?.trim() ? (
                        <ReviewEvidence
                          headingId={`credit-request-resolution-${request.id}`}
                          heading="Resolution note"
                          text={request.resolutionNote}
                        />
                      ) : null}

                      {pending ? (
                        <PendingDecision
                          request={request}
                          draft={drafts[request.id]}
                          error={errors[request.id]}
                          inFlight={inFlight?.requestId === request.id ? inFlight.action : null}
                          busy={inFlight !== null}
                          locked={isOwnRequest}
                          onDraftChange={(field, value) => onDraftChange(request.id, field, value)}
                          onQuickGrant={(cents) => onQuickGrant(request, cents)}
                          onRequestGrant={() => onRequestGrant(request)}
                          onRequestDismiss={() => onRequestDismiss(request)}
                        />
                      ) : (
                        <div className="pb-6" />
                      )}
                    </ReviewCard>
                  );
                })}
              </ReviewQueueList>
            ) : null}
          </div>
        </>
      )}

      <ConfirmDialog
        isOpen={Boolean(pendingGrant)}
        title="Grant generation credits?"
        message={pendingGrant ? getGrantConfirmMessage(pendingGrant) : ""}
        confirmLabel={pendingGrant ? `Grant ${formatUsdCents(pendingGrant.amountCents)}` : "Grant"}
        variant="warning"
        onCancel={onCancelGrant}
        onConfirm={onConfirmGrant}
      />

      <ConfirmDialog
        isOpen={Boolean(pendingDismissal)}
        title="Dismiss credit request?"
        message={pendingDismissal ? getDismissConfirmMessage(pendingDismissal) : ""}
        confirmLabel="Dismiss request"
        variant="warning"
        onCancel={onCancelDismiss}
        onConfirm={onConfirmDismiss}
      />
    </ReviewQueuePage>
  );
}
