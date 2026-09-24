"use client";

import Link from "next/link";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import {
  CopyableValue,
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
  oldestCreatedAt,
} from "../../../components/admin/review-queue/ReviewQueue";
import type { ManagementRecoveryDecision, ManagementRecoveryRequest } from "../../../lib/api";

export type ManagementRecoveryQueueState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; requests: ManagementRecoveryRequest[] };

type ManagementRecoveryQueueViewProps = {
  state: ManagementRecoveryQueueState;
  reviewNotes: Record<string, string>;
  reviewErrors: Record<string, string>;
  reviewingRequestId: string | null;
  reviewingDecision: ManagementRecoveryDecision | null;
  approvalRequest: ManagementRecoveryRequest | null;
  rejectionRequest: ManagementRecoveryRequest | null;
  successMessage: string | null;
  onRetry: () => void;
  onReviewNoteChange: (requestId: string, value: string) => void;
  onRequestApproval: (request: ManagementRecoveryRequest) => void;
  onRequestRejection: (request: ManagementRecoveryRequest) => void;
  onCancelApproval: () => void;
  onConfirmApproval: () => Promise<void>;
  onCancelRejection: () => void;
  onConfirmRejection: () => Promise<void>;
};

type ResourceType = ManagementRecoveryRequest["resourceType"];

function resourceNoun(type: ResourceType, count: number) {
  const noun = type === "artist_profile" ? "profile" : "release";
  return count === 1 ? noun : `${noun}s`;
}

/** Public page for a resource affected by a recovery request. */
export function resourceHref(type: ResourceType, id: string) {
  return type === "artist_profile"
    ? `/artist/${encodeURIComponent(id)}`
    : `/release/${encodeURIComponent(id)}`;
}

function resourceName(type: ResourceType, name: string) {
  return name.trim() || (type === "artist_profile" ? "Unnamed profile" : "Untitled release");
}

/** Heading above the affected-resource list, e.g. "Affected releases (2)". */
export function getAffectedResourcesLabel(request: ManagementRecoveryRequest) {
  const count = request.resources.length;
  const label = `Affected ${resourceNoun(request.resourceType, count)}`;
  return count > 1 ? `${label} (${count})` : label;
}

function affectedResourcesPhrase(request: ManagementRecoveryRequest) {
  const count = request.resources.length;
  return count === 1
    ? `this ${resourceNoun(request.resourceType, 1)}`
    : `${count} ${resourceNoun(request.resourceType, count)}`;
}

/** Consequences of approval, shown on every card above the review note. */
export function getImpactNotice(request: ManagementRecoveryRequest) {
  return `Approving returns management of ${affectedResourcesPhrase(request)} to the requester, revokes the current manager’s access grants on them, and cancels pending management transfers. Credits, rights, and payouts do not change.`;
}

export function getApprovalMessage(request: ManagementRecoveryRequest) {
  const resources = request.resources
    .map((resource) => `• ${resourceName(request.resourceType, resource.name)}`)
    .join("\n");
  return `Resources affected:\n${resources}\n\nApproving will restore the original proposer’s management authority. The current manager will be displaced, their management grants revoked, and pending management transfers for these resources cancelled. Credits, rights, and payouts will not change.`;
}

export function getRejectionMessage() {
  return "Reject this recovery request? Management stays with the current manager. The requester can submit a new request with more evidence if the transfer is still eligible. Your review note is recorded with the decision.";
}

function EmailValue({ email, subject }: { email: string | null; subject: string }) {
  const value = email?.trim();
  if (!value) return <span className="review-queue-text review-queue-text--muted">Email unavailable</span>;
  return <CopyableValue value={value} subject={subject} plain />;
}

export default function ManagementRecoveryQueueView({
  state,
  reviewNotes,
  reviewErrors,
  reviewingRequestId,
  reviewingDecision,
  approvalRequest,
  rejectionRequest,
  successMessage,
  onRetry,
  onReviewNoteChange,
  onRequestApproval,
  onRequestRejection,
  onCancelApproval,
  onConfirmApproval,
  onCancelRejection,
  onConfirmRejection,
}: ManagementRecoveryQueueViewProps) {
  const requests = state.status === "ready" ? state.requests : [];

  return (
    <ReviewQueuePage className="management-recovery-admin">
      <ReviewQueueHeader
        eyebrow="Operator review"
        title="Management transfer recovery"
        description="Review the evidence before approving or rejecting a recovery request. Submitting a request does not reverse management access automatically. These decisions do not move credits, rights, or payouts."
        summary={requests.length > 0
          ? { pendingCount: requests.length, oldest: oldestCreatedAt(requests), onRefresh: onRetry }
          : null}
      />

      <ReviewQueueSuccess message={successMessage} />

      {state.status === "loading" ? <ReviewQueueLoading statusText="Loading pending requests…" /> : null}

      {state.status === "forbidden" ? (
        <ReviewQueueStatePanel
          variant="forbidden"
          heading="Access denied"
          body="Only operators and administrators can review management recovery requests."
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

      {state.status === "ready" && requests.length === 0 ? (
        <ReviewQueueStatePanel
          variant="empty"
          heading="No pending requests"
          body="New management recovery requests will appear here for review."
          actionLabel="Refresh queue"
          onAction={onRetry}
        />
      ) : null}

      {requests.length > 0 ? (
        <ReviewQueueList label="Pending management recovery requests">
          {requests.map((request) => {
            const isReviewingThis = reviewingRequestId === request.id;
            const resourcesLabelId = `recovery-resources-${request.id}`;

            return (
              <ReviewCard
                key={request.id}
                titleId={`recovery-title-${request.id}`}
                title={request.resourceType === "artist_profile"
                  ? "Profile management transfer"
                  : "Release management transfer"}
                requestedAt={request.createdAt}
                badges={<ReviewPill tone="pending">Pending</ReviewPill>}
              >
                <section className="review-queue-resources" aria-labelledby={resourcesLabelId}>
                  <h3 id={resourcesLabelId} className="review-queue-resources__label">
                    {getAffectedResourcesLabel(request)}
                  </h3>
                  <ul>
                    {request.resources.map((resource) => (
                      <li key={resource.id}>
                        <Link className="review-queue-chip" href={resourceHref(request.resourceType, resource.id)}>
                          {resourceName(request.resourceType, resource.name)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>

                <ReviewDetails>
                  <ReviewDetailItem label="Requester (original proposer)">
                    <EmailValue email={request.requesterEmail} subject="requester email" />
                  </ReviewDetailItem>
                  <ReviewDetailItem label="Current manager (transfer recipient)">
                    <EmailValue email={request.recipientEmail} subject="current manager email" />
                  </ReviewDetailItem>
                </ReviewDetails>
                <ReviewDetails>
                  <ReviewDetailItem label="Transfer ID">
                    <CopyableValue value={request.transferId} subject="transfer ID" />
                  </ReviewDetailItem>
                </ReviewDetails>

                <ReviewEvidence headingId={`recovery-evidence-${request.id}`} text={request.evidence} />

                <ReviewDecisionFooter
                  idPrefix="recovery"
                  itemId={request.id}
                  notices={<ReviewNotice tone="warning">{getImpactNotice(request)}</ReviewNotice>}
                  note={reviewNotes[request.id] ?? ""}
                  onNoteChange={(value) => onReviewNoteChange(request.id, value)}
                  error={reviewErrors[request.id]}
                  approveLabel="Approve recovery"
                  rejectLabel="Reject recovery"
                  inFlightDecision={isReviewingThis ? reviewingDecision : null}
                  disabled={reviewingRequestId !== null}
                  onApprove={() => onRequestApproval(request)}
                  onReject={() => onRequestRejection(request)}
                />
              </ReviewCard>
            );
          })}
        </ReviewQueueList>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(approvalRequest)}
        title="Approve management recovery?"
        message={approvalRequest ? getApprovalMessage(approvalRequest) : ""}
        confirmLabel="Approve recovery"
        variant="warning"
        onCancel={onCancelApproval}
        onConfirm={onConfirmApproval}
      />

      <ConfirmDialog
        isOpen={Boolean(rejectionRequest)}
        title="Reject management recovery?"
        message={rejectionRequest ? getRejectionMessage() : ""}
        confirmLabel="Reject recovery"
        variant="warning"
        onCancel={onCancelRejection}
        onConfirm={onConfirmRejection}
      />
    </ReviewQueuePage>
  );
}
