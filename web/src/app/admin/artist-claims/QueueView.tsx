"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import type { ArtistClaimDecision, PendingArtistClaim } from "../../../lib/api";

export type ArtistClaimsQueueState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; claims: PendingArtistClaim[] };

type ArtistClaimsQueueViewProps = {
  state: ArtistClaimsQueueState;
  reviewerUserId: string | null;
  reviewNotes: Record<string, string>;
  reviewErrors: Record<string, string>;
  reviewingClaimId: string | null;
  reviewingDecision: ArtistClaimDecision | null;
  approvalClaim: PendingArtistClaim | null;
  rejectionClaim: PendingArtistClaim | null;
  successMessage: string | null;
  onRetry: () => void;
  onReviewNoteChange: (claimId: string, value: string) => void;
  onRequestApproval: (claim: PendingArtistClaim) => void;
  onRequestRejection: (claim: PendingArtistClaim) => void;
  onCancelApproval: () => void;
  onConfirmApproval: () => Promise<void>;
  onCancelRejection: () => void;
  onConfirmRejection: () => Promise<void>;
};

export const REVIEW_NOTE_MAX_LENGTH = 4000;

export function reviewerIsClaimant(reviewerUserId: string | null, claimantUserId: string) {
  return Boolean(
    reviewerUserId
    && claimantUserId
    && reviewerUserId.toLowerCase() === claimantUserId.toLowerCase(),
  );
}

function artistName(claim: PendingArtistClaim) {
  return claim.artist.displayName.trim() || "this artist profile";
}

/**
 * Sentence explaining the backend rule that approving one pending claim
 * rejects every other pending claim for the same artist profile.
 * `claimsForProfile` counts all pending claims for the profile, including
 * this one; returns null when there is no competing claim.
 */
export function getCompetingClaimsNotice(claimsForProfile: number) {
  const others = claimsForProfile - 1;
  if (others < 1) return null;
  return others === 1
    ? "Approving this claim automatically rejects the other pending claim for this profile."
    : `Approving this claim automatically rejects the other ${others} pending claims for this profile.`;
}

export function getApprovalMessage(claim: PendingArtistClaim, claimsForProfile = 1) {
  const base = `Approve claimant ${claim.claimantUserId} to edit the public “${artistName(claim)}” profile (profile ID ${claim.artistId})? This grants no release access and changes no rights or payouts. Confirm that the evidence and your required review note support this decision.`;
  const competing = getCompetingClaimsNotice(claimsForProfile);
  return competing ? `${base}\n\n${competing}` : base;
}

export function getRejectionMessage(claim: PendingArtistClaim) {
  return `Reject the claim on the public “${artistName(claim)}” profile (profile ID ${claim.artistId})? The claimant does not get editing access and can submit a new request with more evidence. Your review note is recorded with the decision.`;
}

export function countClaimsByArtist(claims: PendingArtistClaim[]) {
  const counts = new Map<string, number>();
  for (const claim of claims) counts.set(claim.artistId, (counts.get(claim.artistId) ?? 0) + 1);
  return counts;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function formatRequestedAt(value: string, now: number = Date.now()) {
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

function oldestRequest(claims: PendingArtistClaim[]) {
  let oldest: string | null = null;
  let oldestTime = Number.POSITIVE_INFINITY;
  for (const claim of claims) {
    const time = new Date(claim.createdAt).getTime();
    if (!Number.isNaN(time) && time < oldestTime) {
      oldestTime = time;
      oldest = claim.createdAt;
    }
  }
  return oldest ? formatRequestedAt(oldest) : null;
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

const CheckIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></Icon>
);
const AlertIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.5h.01" /></Icon>
);
const LockIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></Icon>
);
const InboxIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><path d="M4 13.5 6.5 5h11l2.5 8.5" /><path d="M4 13.5V19h16v-5.5h-5a3 3 0 0 1-6 0z" /></Icon>
);
const InfoIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.5h.01" /></Icon>
);
const RefreshIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 20v-4h-4" /></Icon>
);

/* ---------- Copy control ---------- */

function CopyValueButton({ value, subject }: { value: string; subject: string }) {
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
    <button type="button" className="claim-copy" onClick={() => void copy()}>
      <span aria-live="polite">
        {status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Copy"}
        <span className="visually-hidden">{` ${subject}`}</span>
      </span>
      <style jsx>{`
        .claim-copy {
          display: inline-flex;
          align-items: center;
          flex: none;
          min-height: 32px;
          padding: 4px 10px;
          border: 1px solid var(--r-outline);
          border-radius: var(--r-radius-full);
          background: transparent;
          color: var(--r-on-surface-variant);
          font: inherit;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }
        .claim-copy:hover {
          border-color: var(--r-primary-soft);
          background: rgba(124, 92, 255, 0.12);
          color: var(--r-on-surface);
        }
        .claim-copy:focus-visible {
          outline: 2px solid var(--r-primary-soft);
          outline-offset: 2px;
        }
        @media (max-width: 640px), (pointer: coarse) {
          .claim-copy { min-height: 44px; min-width: 72px; justify-content: center; padding: 4px 16px; border-radius: var(--r-radius-sm); }
        }
      `}</style>
    </button>
  );
}

/* ---------- View ---------- */

export default function ArtistClaimsQueueView({
  state,
  reviewerUserId,
  reviewNotes,
  reviewErrors,
  reviewingClaimId,
  reviewingDecision,
  approvalClaim,
  rejectionClaim,
  successMessage,
  onRetry,
  onReviewNoteChange,
  onRequestApproval,
  onRequestRejection,
  onCancelApproval,
  onConfirmApproval,
  onCancelRejection,
  onConfirmRejection,
}: ArtistClaimsQueueViewProps) {
  const claims = state.status === "ready" ? state.claims : [];
  const claimsByArtist = countClaimsByArtist(claims);
  const oldest = claims.length > 0 ? oldestRequest(claims) : null;

  return (
    <main className="analytics-container artist-claims-admin" style={{ padding: "12px 0 64px" }}>
      <header className="analytics-header-section claims-header">
        <p className="artist-analytics-eyebrow">Operator review</p>
        <h1>Artist claim review queue</h1>
        <p className="analytics-muted claims-intro">
          Review the submitted evidence and exact artist profile before recording a decision.
          Approval grants editing access to the public profile only. It does not grant release access or change rights or payouts.
        </p>
        {claims.length > 0 ? (
          <div className="claims-summary">
            <span className="claim-pill claim-pill--count">{`${claims.length} pending`}</span>
            {oldest ? (
              <span className="claims-summary__oldest">
                Oldest requested <time dateTime={oldest.iso} title={oldest.absolute}>{oldest.relative}</time>
              </span>
            ) : null}
            <Button variant="ghost" className="claims-refresh" onClick={onRetry}>
              <RefreshIcon size={16} />
              Refresh
            </Button>
          </div>
        ) : null}
      </header>

      {successMessage ? (
        <p className="claims-success" role="status">
          <CheckIcon />
          <span>{successMessage}</span>
        </p>
      ) : null}

      {state.status === "loading" ? (
        <section className="claims-list" aria-busy="true">
          <p className="visually-hidden" role="status">Loading pending artist claims…</p>
          {[0, 1].map((index) => (
            <div key={index} className="claim-card claim-card--skeleton" aria-hidden="true">
              <span className="skeleton skeleton--title" />
              <span className="skeleton skeleton--line" />
              <span className="skeleton skeleton--block" />
              <span className="skeleton skeleton--line skeleton--short" />
            </div>
          ))}
        </section>
      ) : null}

      {state.status === "forbidden" ? (
        <section className="claim-card claims-state" role="alert">
          <span className="claims-state__icon claims-state__icon--error"><LockIcon size={22} /></span>
          <h2>Access denied</h2>
          <p className="analytics-muted">Only operators and administrators can review artist claims.</p>
        </section>
      ) : null}

      {state.status === "error" ? (
        <section className="claim-card claims-state" role="alert">
          <span className="claims-state__icon claims-state__icon--error"><AlertIcon size={22} /></span>
          <h2>Unable to load the review queue</h2>
          <p className="analytics-muted">{state.message}</p>
          <Button variant="primary" onClick={onRetry}>Try again</Button>
        </section>
      ) : null}

      {state.status === "ready" && claims.length === 0 ? (
        <section className="claim-card claims-state">
          <span className="claims-state__icon"><InboxIcon size={22} /></span>
          <h2>No pending artist claims</h2>
          <p className="analytics-muted">New artist profile claims will appear here for review.</p>
          <Button variant="ghost" onClick={onRetry}>
            <RefreshIcon size={16} />
            Refresh queue
          </Button>
        </section>
      ) : null}

      {claims.length > 0 ? (
        <section className="claims-list" aria-label="Pending artist claims">
          {claims.map((claim) => {
            const isSelfReview = reviewerIsClaimant(reviewerUserId, claim.claimantUserId);
            const requested = formatRequestedAt(claim.createdAt);
            const claimsForProfile = claimsByArtist.get(claim.artistId) ?? 1;
            const competingNotice = getCompetingClaimsNotice(claimsForProfile);
            const displayName = claim.artist.displayName.trim();
            const note = reviewNotes[claim.id] ?? "";
            const reviewError = reviewErrors[claim.id];
            const titleId = `claim-title-${claim.id}`;
            const evidenceHeadingId = `claim-evidence-${claim.id}`;
            const noteId = `claim-review-note-${claim.id}`;
            const reviewNoteErrorId = `claim-review-error-${claim.id}`;
            const reviewNoteHintId = `claim-review-hint-${claim.id}`;
            const isReviewingThis = reviewingClaimId === claim.id;

            return (
              <article key={claim.id} className="claim-card" aria-labelledby={titleId}>
                <header className="claim-card__header">
                  <div className="claim-card__title">
                    <h2 id={titleId}>{displayName || "Artist profile"}</h2>
                    <p className="claim-card__time">
                      {requested ? (
                        <>
                          <time dateTime={requested.iso} title={requested.absolute}>{`Requested ${requested.relative}`}</time>
                          <span aria-hidden="true"> · </span>
                          <span>{requested.absolute}</span>
                        </>
                      ) : "Requested: Unknown date"}
                    </p>
                  </div>
                  <div className="claim-card__badges">
                    {claimsForProfile > 1 ? (
                      <span className="claim-pill claim-pill--warning">{`${claimsForProfile} claims for this profile`}</span>
                    ) : null}
                    <span className="claim-pill claim-pill--pending">Pending</span>
                  </div>
                </header>

                <dl className="claim-details">
                  <div className="claim-details__item">
                    <dt>Artist profile</dt>
                    <dd>
                      <Link className="claim-profile-link" href={`/artist/${encodeURIComponent(claim.artistId)}`}>
                        {`Open ${displayName || "artist"} profile`}
                      </Link>
                      <span className="claim-value-row">
                        <span className="claim-mono claim-mono--muted">{`Profile ID: ${claim.artistId}`}</span>
                        <CopyValueButton value={claim.artistId} subject="profile ID" />
                      </span>
                    </dd>
                  </div>
                  <div className="claim-details__item">
                    <dt>Claimant</dt>
                    <dd>
                      <span className="claim-value-row">
                        <span className="claim-mono">{claim.claimantUserId}</span>
                        <CopyValueButton value={claim.claimantUserId} subject="claimant user ID" />
                      </span>
                    </dd>
                  </div>
                </dl>

                <section className="claim-evidence" aria-labelledby={evidenceHeadingId}>
                  <h3 id={evidenceHeadingId}>Submitted evidence</h3>
                  <p>{claim.evidence}</p>
                </section>

                <div className="claim-decision">
                  {isSelfReview ? (
                    <p className="claim-self-review" role="note">
                      <InfoIcon />
                      <span>Your account submitted this claim. An independent operator must review it.</span>
                    </p>
                  ) : (
                    <>
                      {competingNotice ? (
                        <p className="claim-competing">
                          <AlertIcon />
                          <span>{competingNotice}</span>
                        </p>
                      ) : null}
                      <div className="claim-note">
                        <div className="claim-note__label-row">
                          <label htmlFor={noteId}>Review note</label>
                          <span className="claim-pill claim-pill--required">Required</span>
                        </div>
                        <textarea
                          id={noteId}
                          required
                          maxLength={REVIEW_NOTE_MAX_LENGTH}
                          rows={4}
                          value={note}
                          onChange={(event) => onReviewNoteChange(claim.id, event.target.value)}
                          aria-invalid={reviewError ? true : undefined}
                          aria-describedby={`${reviewNoteHintId}${reviewError ? ` ${reviewNoteErrorId}` : ""}`}
                        />
                        <div className="claim-note__meta">
                          <p id={reviewNoteHintId}>Record the reason for your decision.</p>
                          <span className="claim-note__count">{`${note.length} / ${REVIEW_NOTE_MAX_LENGTH}`}</span>
                        </div>
                        {reviewError ? (
                          <p id={reviewNoteErrorId} className="claim-error" role="alert">
                            <AlertIcon size={16} />
                            <span>{reviewError}</span>
                          </p>
                        ) : null}
                      </div>
                      <div className="claim-actions">
                        <Button
                          variant="primary"
                          disabled={reviewingClaimId !== null}
                          onClick={() => onRequestApproval(claim)}
                        >
                          {isReviewingThis && reviewingDecision === "approve" ? "Approving…" : "Approve claim"}
                        </Button>
                        <Button
                          variant="ghost"
                          className="claim-reject"
                          disabled={reviewingClaimId !== null}
                          onClick={() => onRequestRejection(claim)}
                        >
                          {isReviewingThis && reviewingDecision === "reject" ? "Rejecting…" : "Reject claim"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(approvalClaim)}
        title="Approve artist claim?"
        message={approvalClaim
          ? getApprovalMessage(approvalClaim, claimsByArtist.get(approvalClaim.artistId) ?? 1)
          : ""}
        confirmLabel="Approve claim"
        variant="warning"
        onCancel={onCancelApproval}
        onConfirm={onConfirmApproval}
      />

      <ConfirmDialog
        isOpen={Boolean(rejectionClaim)}
        title="Reject artist claim?"
        message={rejectionClaim ? getRejectionMessage(rejectionClaim) : ""}
        confirmLabel="Reject claim"
        variant="warning"
        onCancel={onCancelRejection}
        onConfirm={onConfirmRejection}
      />

      <style jsx>{`
        .claims-header h1 { margin: 0; }
        .claims-intro { margin: 0; max-width: 820px; line-height: 1.6; }
        .claims-summary {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px 16px;
        }
        .claims-summary__oldest { color: var(--r-on-surface-muted); font-size: 14px; }
        .claims-summary__oldest time { color: var(--r-on-surface); }
        .claims-summary :global(.claims-refresh) { margin-left: auto; min-height: 44px; padding: 10px 18px; }

        .claim-pill {
          display: inline-flex;
          align-items: center;
          min-height: 26px;
          padding: 3px 10px;
          border: 1px solid var(--r-outline);
          border-radius: var(--r-radius-full);
          font-size: 12px;
          font-weight: 600;
          line-height: 1.3;
          white-space: nowrap;
        }
        .claim-pill--count {
          border-color: rgba(124, 92, 255, 0.45);
          background: rgba(124, 92, 255, 0.16);
          color: var(--r-on-surface);
          font-size: 13px;
        }
        .claim-pill--pending {
          border-color: rgba(124, 92, 255, 0.4);
          background: rgba(124, 92, 255, 0.1);
          color: var(--r-on-surface-variant);
        }
        .claim-pill--warning {
          border-color: rgba(251, 191, 36, 0.45);
          background: rgba(251, 191, 36, 0.1);
          color: var(--r-warning);
        }
        .claim-pill--required {
          min-height: 22px;
          padding: 1px 8px;
          font-size: 11px;
          color: var(--r-on-surface-variant);
          background: var(--r-surface-highest);
        }

        .claims-success {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          padding: 12px 16px;
          border: 1px solid rgba(52, 211, 153, 0.4);
          border-radius: var(--r-radius-sm);
          background: rgba(52, 211, 153, 0.1);
          color: var(--r-on-surface);
        }
        .claims-success :global(svg) { flex: none; color: var(--r-success); }

        .claims-list { display: grid; gap: 20px; min-width: 0; }

        .claim-card {
          min-width: 0;
          border: 1px solid var(--r-outline);
          border-radius: var(--r-radius-md);
          background: linear-gradient(180deg, var(--r-surface-high), var(--r-surface-mid));
          overflow: hidden;
        }
        .claim-card__header,
        .claim-details,
        .claim-evidence { margin-left: 24px; margin-right: 24px; }
        .claim-card h2 { margin: 0; font-family: var(--font-display); font-size: 20px; line-height: 1.3; }
        .claim-card h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--r-on-surface-variant); }

        .claim-card__header {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px 16px;
          padding-top: 22px;
        }
        .claim-card__title { min-width: 0; }
        .claim-card__time { margin: 4px 0 0; color: var(--r-on-surface-muted); font-size: 13px; }
        .claim-card__time time { color: var(--r-on-surface-variant); }
        .claim-card__badges { display: flex; flex-wrap: wrap; gap: 8px; }

        .claim-details {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 16px 24px;
          margin-top: 18px;
          margin-bottom: 0;
        }
        .claim-details__item { min-width: 0; }
        .claim-details dt {
          color: var(--r-on-surface-muted);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .claim-details dd { display: grid; gap: 6px; justify-items: start; margin: 6px 0 0; min-width: 0; }
        .claim-details :global(.claim-profile-link) {
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          color: var(--r-primary-soft);
          font-weight: 600;
          text-decoration: none;
          text-underline-offset: 3px;
          overflow-wrap: anywhere;
        }
        .claim-details :global(.claim-profile-link:hover) { text-decoration: underline; }
        .claim-details :global(.claim-profile-link:focus-visible) {
          outline: 2px solid var(--r-primary-soft);
          outline-offset: 2px;
          border-radius: 4px;
        }
        .claim-value-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; min-width: 0; max-width: 100%; }
        .claim-mono {
          min-width: 0;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 13px;
          color: var(--r-on-surface);
          overflow-wrap: anywhere;
        }
        .claim-mono--muted { color: var(--r-on-surface-muted); font-size: 12px; }

        .claim-evidence {
          margin-top: 18px;
          margin-bottom: 20px;
          padding: 14px 16px;
          border: 1px solid var(--r-outline);
          border-radius: var(--r-radius-sm);
          background: rgba(8, 8, 15, 0.35);
        }
        .claim-evidence p {
          margin: 0;
          max-width: 860px;
          color: var(--r-on-surface);
          line-height: 1.65;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
        }

        .claim-decision {
          display: grid;
          gap: 14px;
          padding: 18px 24px 22px;
          border-top: 1px solid var(--r-outline);
          background: rgba(8, 8, 15, 0.3);
        }
        .claim-self-review,
        .claim-competing,
        .claim-error {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin: 0;
          line-height: 1.5;
        }
        .claim-self-review :global(svg),
        .claim-competing :global(svg),
        .claim-error :global(svg) { flex: none; margin-top: 2px; }
        .claim-self-review {
          padding: 12px 14px;
          border: 1px solid rgba(96, 165, 250, 0.35);
          border-radius: var(--r-radius-sm);
          background: rgba(96, 165, 250, 0.08);
          color: var(--r-on-surface);
        }
        .claim-self-review :global(svg) { color: var(--r-info); }
        .claim-competing {
          padding: 10px 14px;
          border: 1px solid rgba(251, 191, 36, 0.35);
          border-radius: var(--r-radius-sm);
          background: rgba(251, 191, 36, 0.08);
          color: var(--r-on-surface);
          font-size: 14px;
        }
        .claim-competing :global(svg) { color: var(--r-warning); }

        .claim-note { display: grid; gap: 8px; max-width: 760px; min-width: 0; }
        .claim-note__label-row { display: flex; align-items: center; gap: 8px; }
        .claim-note__label-row label { font-weight: 600; }
        .claim-note textarea {
          width: 100%;
          min-height: 104px;
          padding: 12px 14px;
          border: 1px solid var(--r-outline);
          border-radius: var(--r-radius-sm);
          background: var(--r-surface-lowest);
          color: var(--r-on-surface);
          font: inherit;
          line-height: 1.5;
          resize: vertical;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .claim-note textarea:hover { border-color: rgba(152, 128, 255, 0.45); }
        .claim-note textarea:focus-visible {
          outline: none;
          border-color: var(--r-primary-soft);
          box-shadow: 0 0 0 3px rgba(124, 92, 255, 0.3);
        }
        .claim-note textarea[aria-invalid="true"] { border-color: rgba(255, 107, 107, 0.7); }
        .claim-note__meta {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          justify-content: space-between;
          gap: 4px 16px;
          color: var(--r-on-surface-muted);
          font-size: 13px;
        }
        .claim-note__meta p { margin: 0; }
        .claim-note__count { margin-left: auto; font-variant-numeric: tabular-nums; }
        .claim-error { color: var(--r-error); font-size: 14px; }

        .claim-actions { display: flex; flex-wrap: wrap; gap: 10px; }
        .claim-actions :global(.ui-btn) { min-height: 44px; padding: 10px 20px; }
        .claim-actions :global(.claim-reject:hover:not(:disabled)) {
          color: var(--r-error);
          border-color: rgba(255, 107, 107, 0.55);
          background: rgba(255, 107, 107, 0.1);
        }
        .claim-actions :global(.claim-reject:focus-visible) { outline-color: rgba(255, 107, 107, 0.7); }

        .claims-state {
          display: grid;
          justify-items: start;
          gap: 10px;
          padding: 28px 24px;
        }
        .claims-state h2 { font-size: 18px; }
        .claims-state p { margin: 0 0 6px; }
        .claims-state :global(.ui-btn) { min-height: 44px; padding: 10px 20px; }
        .claims-state__icon {
          display: inline-grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: var(--r-radius-sm);
          border: 1px solid rgba(124, 92, 255, 0.35);
          background: rgba(124, 92, 255, 0.12);
          color: var(--r-primary-soft);
        }
        .claims-state__icon--error {
          border-color: rgba(255, 107, 107, 0.35);
          background: rgba(255, 107, 107, 0.1);
          color: var(--r-error);
        }

        .claim-card--skeleton { display: grid; gap: 14px; padding: 24px; }
        .skeleton {
          display: block;
          height: 14px;
          border-radius: 6px;
          background: linear-gradient(90deg, var(--r-surface-highest) 0%, rgba(255, 255, 255, 0.08) 50%, var(--r-surface-highest) 100%);
          background-size: 200% 100%;
          animation: claims-shimmer 1.4s ease-in-out infinite;
        }
        .skeleton--title { width: 38%; height: 20px; }
        .skeleton--line { width: 60%; }
        .skeleton--block { height: 72px; }
        .skeleton--short { width: 30%; }
        @keyframes claims-shimmer {
          from { background-position: 200% 0; }
          to { background-position: -200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .skeleton { animation: none; }
        }

        @media (max-width: 640px) {
          .claim-card__header,
          .claim-details,
          .claim-evidence { margin-left: 16px; margin-right: 16px; }
          .claim-card__header { padding-top: 16px; }
          .claim-decision { padding: 16px; }
          .claim-evidence { padding: 12px; }
          .claims-state { padding: 20px 16px; }
          .claim-card--skeleton { padding: 16px; }
          .claim-actions { flex-direction: column; }
          .claim-actions :global(.ui-btn) { width: 100%; }
          .claims-summary :global(.claims-refresh) { margin-left: 0; }
        }
      `}</style>
    </main>
  );
}
