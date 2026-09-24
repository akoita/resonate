"use client";

import Link from "next/link";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import type { PendingArtistClaim } from "../../../lib/api";

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
  approvalClaim: PendingArtistClaim | null;
  successMessage: string | null;
  onRetry: () => void;
  onReviewNoteChange: (claimId: string, value: string) => void;
  onRequestApproval: (claim: PendingArtistClaim) => void;
  onReject: (claim: PendingArtistClaim) => void;
  onCancelApproval: () => void;
  onConfirmApproval: () => Promise<void>;
};

export function reviewerIsClaimant(reviewerUserId: string | null, claimantUserId: string) {
  return Boolean(
    reviewerUserId
    && claimantUserId
    && reviewerUserId.toLowerCase() === claimantUserId.toLowerCase(),
  );
}

function getApprovalMessage(claim: PendingArtistClaim) {
  const artistName = claim.artist.displayName.trim() || "this artist profile";
  return `Approve claimant ${claim.claimantUserId} to edit the public “${artistName}” profile (profile ID ${claim.artistId})? This grants no release access and changes no rights or payouts. Confirm that the evidence and your required review note support this decision.`;
}

export default function ArtistClaimsQueueView({
  state,
  reviewerUserId,
  reviewNotes,
  reviewErrors,
  reviewingClaimId,
  approvalClaim,
  successMessage,
  onRetry,
  onReviewNoteChange,
  onRequestApproval,
  onReject,
  onCancelApproval,
  onConfirmApproval,
}: ArtistClaimsQueueViewProps) {
  return (
    <main className="analytics-container artist-claims-admin" style={{ padding: "12px 0 64px" }}>
      <header className="analytics-header-section">
        <p className="artist-analytics-eyebrow">Operator review</p>
        <h1>Artist claim review queue</h1>
        <p className="analytics-muted">
          Review the submitted evidence and exact artist profile before recording a decision.
          Approval grants editing access to the public profile only. It does not grant release access or change rights or payouts.
        </p>
      </header>

      {successMessage ? <p className="claims-success" role="status">{successMessage}</p> : null}

      {state.status === "loading" ? <p role="status">Loading pending artist claims…</p> : null}

      {state.status === "forbidden" ? (
        <section className="glass-panel claims-state" role="alert">
          <h2>Access denied</h2>
          <p className="analytics-muted">Only operators and administrators can review artist claims.</p>
        </section>
      ) : null}

      {state.status === "error" ? (
        <section className="glass-panel claims-state" role="alert">
          <h2>Unable to load the review queue</h2>
          <p className="analytics-muted">{state.message}</p>
          <button type="button" onClick={onRetry}>Try again</button>
        </section>
      ) : null}

      {state.status === "ready" && state.claims.length === 0 ? (
        <section className="glass-panel claims-state">
          <h2>No pending artist claims</h2>
          <p className="analytics-muted">New artist profile claims will appear here for review.</p>
          <button type="button" onClick={onRetry}>Refresh queue</button>
        </section>
      ) : null}

      {state.status === "ready" && state.claims.length > 0 ? (
        <section className="glass-panel claims-queue" aria-label="Pending artist claims">
          {state.claims.map((claim) => {
            const isSelfReview = reviewerIsClaimant(reviewerUserId, claim.claimantUserId);
            const requestedAt = new Date(claim.createdAt);
            const requestedLabel = Number.isNaN(requestedAt.getTime())
              ? "Unknown date"
              : requestedAt.toLocaleString();
            const reviewNoteErrorId = `claim-review-error-${claim.id}`;
            const reviewNoteHintId = `claim-review-hint-${claim.id}`;

            return (
              <article key={claim.id} className="claim-request">
                <header className="claim-request__header">
                  <div>
                    <h2>{claim.artist.displayName || "Artist profile"}</h2>
                    <p className="analytics-muted">Requested {requestedLabel}</p>
                  </div>
                  <span className="claim-status">Pending</span>
                </header>

                <dl className="claim-parties">
                  <div>
                    <dt>Exact artist profile</dt>
                    <dd>
                      <Link href={`/artist/${encodeURIComponent(claim.artistId)}`}>
                        View {claim.artist.displayName || "artist profile"}
                      </Link>
                      <span className="claim-profile-id">Profile ID: {claim.artistId}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Claimant user ID</dt>
                    <dd className="claim-id">{claim.claimantUserId}</dd>
                  </div>
                </dl>

                <section className="claim-evidence" aria-label={`Evidence for ${claim.artist.displayName || "artist claim"}`}>
                  <h3>Submitted evidence</h3>
                  <p>{claim.evidence}</p>
                </section>

                <label className="claim-review-note">
                  Review note <span>(required)</span>
                  <textarea
                    required
                    maxLength={4000}
                    rows={4}
                    value={reviewNotes[claim.id] ?? ""}
                    onChange={(event) => onReviewNoteChange(claim.id, event.target.value)}
                    aria-describedby={`${reviewNoteHintId}${reviewErrors[claim.id] ? ` ${reviewNoteErrorId}` : ""}`}
                  />
                </label>
                <p id={reviewNoteHintId} className="analytics-muted">Record the reason for your decision.</p>
                {reviewErrors[claim.id] ? <p id={reviewNoteErrorId} className="claim-error" role="alert">{reviewErrors[claim.id]}</p> : null}

                {isSelfReview ? (
                  <p className="claim-self-review" role="note">
                    Your account submitted this claim. An independent operator must review it.
                  </p>
                ) : null}

                <div className="claim-actions">
                  <button
                    type="button"
                    disabled={reviewingClaimId !== null || isSelfReview}
                    onClick={() => onRequestApproval(claim)}
                  >
                    {reviewingClaimId === claim.id ? "Saving…" : "Approve claim"}
                  </button>
                  <button
                    type="button"
                    disabled={reviewingClaimId !== null || isSelfReview}
                    onClick={() => onReject(claim)}
                  >
                    {reviewingClaimId === claim.id ? "Saving…" : "Reject claim"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(approvalClaim)}
        title="Approve artist claim?"
        message={approvalClaim ? getApprovalMessage(approvalClaim) : ""}
        confirmLabel="Approve claim"
        variant="warning"
        onCancel={onCancelApproval}
        onConfirm={onConfirmApproval}
      />

      <style jsx>{`
        .claims-state { padding: 24px; }
        .claims-queue { padding: 0 24px; }
        .claim-request { padding: 24px 0; border-bottom: 1px solid rgba(255,255,255,.1); }
        .claim-request:last-child { border-bottom: 0; }
        .claim-request h2 { margin: 0; font-size: 18px; }
        .claim-request h3 { margin: 0 0 8px; font-size: 14px; }
        .claim-request__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .claim-status { border: 1px solid rgba(245,158,11,.4); border-radius: 999px; padding: 4px 9px; color: #fbbf24; font-size: 12px; }
        .claim-parties { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin: 16px 0; }
        .claim-parties div { min-width: 0; }
        .claim-parties dt { color: var(--r-on-surface-muted, #aaa); font-size: 11px; }
        .claim-parties dd { display: grid; gap: 4px; margin: 3px 0 0; overflow-wrap: anywhere; }
        .claim-parties a { color: var(--r-primary, #a78bfa); text-decoration: underline; text-underline-offset: 3px; }
        .claim-profile-id { color: var(--r-on-surface-muted, #aaa); font-size: 12px; }
        .claim-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .claim-evidence { margin: 16px 0; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; background: rgba(255,255,255,.03); padding: 14px; }
        .claim-evidence p { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
        .claim-review-note { display: grid; gap: 8px; max-width: 720px; font-weight: 600; }
        .claim-review-note span { color: var(--r-on-surface-muted, #aaa); font-weight: 400; }
        .claim-review-note textarea { width: 100%; min-height: 90px; border: 1px solid rgba(255,255,255,.2); border-radius: 10px; background: var(--r-surface-container, #252430); color: var(--r-on-surface); padding: 10px; font: inherit; }
        .claim-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
        .claim-actions button, .claims-state button { min-height: 44px; border: 1px solid rgba(255,255,255,.2); border-radius: 10px; background: var(--r-surface-container, #252430); color: var(--r-on-surface); padding: 9px 15px; cursor: pointer; }
        .claim-actions button:disabled { cursor: not-allowed; opacity: .5; }
        .claim-self-review { border-left: 3px solid #f59e0b; padding: 8px 12px; color: var(--r-on-surface-muted, #ddd); }
        .claim-error { color: #fca5a5; }
        .claims-success { border-left: 3px solid #22c55e; padding: 10px 14px; color: #bbf7d0; }
        @media (max-width: 640px) { .claims-queue { padding: 0 16px; } }
      `}</style>
    </main>
  );
}
