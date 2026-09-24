"use client";

import Link from "next/link";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import {
  CopyableValue,
  REVIEW_NOTE_MAX_LENGTH,
  ReviewCard,
  ReviewDecisionFooter,
  ReviewDetailItem,
  ReviewDetails,
  ReviewEvidence,
  ReviewNotice,
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
import type { ArtistClaimDecision, PendingArtistClaim } from "../../../lib/api";

export { REVIEW_NOTE_MAX_LENGTH, formatRequestedAt };

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

  return (
    <ReviewQueuePage className="artist-claims-admin">
      <ReviewQueueHeader
        eyebrow="Operator review"
        title="Artist claim review queue"
        description={(
          <>
            Review the submitted evidence and exact artist profile before recording a decision.
            Approval grants editing access to the public profile only. It does not grant release access or change rights or payouts.
          </>
        )}
        summary={claims.length > 0
          ? { pendingCount: claims.length, oldest: oldestCreatedAt(claims), onRefresh: onRetry }
          : null}
      />

      <ReviewQueueSuccess message={successMessage} />

      {state.status === "loading" ? <ReviewQueueLoading statusText="Loading pending artist claims…" /> : null}

      {state.status === "forbidden" ? (
        <ReviewQueueStatePanel
          variant="forbidden"
          heading="Access denied"
          body="Only operators and administrators can review artist claims."
        />
      ) : null}

      {state.status === "error" ? (
        <ReviewQueueStatePanel
          variant="error"
          heading="Unable to load the review queue"
          body={state.message}
          actionLabel="Try again"
          onAction={onRetry}
        />
      ) : null}

      {state.status === "ready" && claims.length === 0 ? (
        <ReviewQueueStatePanel
          variant="empty"
          heading="No pending artist claims"
          body="New artist profile claims will appear here for review."
          actionLabel="Refresh queue"
          onAction={onRetry}
        />
      ) : null}

      {claims.length > 0 ? (
        <ReviewQueueList label="Pending artist claims">
          {claims.map((claim) => {
            const isSelfReview = reviewerIsClaimant(reviewerUserId, claim.claimantUserId);
            const claimsForProfile = claimsByArtist.get(claim.artistId) ?? 1;
            const competingNotice = getCompetingClaimsNotice(claimsForProfile);
            const displayName = claim.artist.displayName.trim();
            const isReviewingThis = reviewingClaimId === claim.id;

            return (
              <ReviewCard
                key={claim.id}
                titleId={`claim-title-${claim.id}`}
                title={displayName || "Artist profile"}
                requestedAt={claim.createdAt}
                badges={(
                  <>
                    {claimsForProfile > 1 ? (
                      <ReviewPill tone="warning">{`${claimsForProfile} claims for this profile`}</ReviewPill>
                    ) : null}
                    <ReviewPill tone="pending">Pending</ReviewPill>
                  </>
                )}
              >
                <ReviewDetails>
                  <ReviewDetailItem label="Artist profile">
                    <Link className="review-queue-link" href={`/artist/${encodeURIComponent(claim.artistId)}`}>
                      {`Open ${displayName || "artist"} profile`}
                    </Link>
                    <CopyableValue value={claim.artistId} text={`Profile ID: ${claim.artistId}`} subject="profile ID" muted />
                  </ReviewDetailItem>
                  <ReviewDetailItem label="Claimant">
                    <CopyableValue value={claim.claimantUserId} subject="claimant user ID" />
                  </ReviewDetailItem>
                </ReviewDetails>

                <ReviewEvidence headingId={`claim-evidence-${claim.id}`} text={claim.evidence} />

                <ReviewDecisionFooter
                  idPrefix="claim"
                  itemId={claim.id}
                  selfReviewMessage={isSelfReview
                    ? "Your account submitted this claim. An independent operator must review it."
                    : null}
                  notices={competingNotice ? <ReviewNotice tone="warning">{competingNotice}</ReviewNotice> : null}
                  note={reviewNotes[claim.id] ?? ""}
                  onNoteChange={(value) => onReviewNoteChange(claim.id, value)}
                  error={reviewErrors[claim.id]}
                  approveLabel="Approve claim"
                  rejectLabel="Reject claim"
                  inFlightDecision={isReviewingThis ? reviewingDecision : null}
                  disabled={reviewingClaimId !== null}
                  onApprove={() => onRequestApproval(claim)}
                  onReject={() => onRequestRejection(claim)}
                />
              </ReviewCard>
            );
          })}
        </ReviewQueueList>
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
    </ReviewQueuePage>
  );
}
