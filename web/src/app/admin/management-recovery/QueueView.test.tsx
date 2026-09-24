import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ManagementRecoveryQueueView, {
  getAffectedResourcesLabel,
  getApprovalMessage,
  getImpactNotice,
  getRejectionMessage,
  resourceHref,
} from "./QueueView";
import type { ManagementRecoveryRequest } from "../../../lib/api";

const releaseRequest: ManagementRecoveryRequest = {
  id: "rec-1",
  transferId: "transfer-8f21",
  resourceType: "release",
  resources: [
    { id: "rel-1", name: "First Light" },
    { id: "rel 2", name: "Night Drive" },
  ],
  requesterEmail: "aya@example.com",
  recipientEmail: null,
  evidence: "Our management agreement ended and the transfer was never meant to be permanent.",
  createdAt: "2026-09-20T10:15:00.000Z",
};

const profileRequest: ManagementRecoveryRequest = {
  id: "rec-2",
  transferId: "transfer-2",
  resourceType: "artist_profile",
  resources: [{ id: "artist-42", name: "Nova" }],
  requesterEmail: null,
  recipientEmail: "label@example.com",
  evidence: "Transfer was made by mistake.",
  createdAt: "2026-09-21T10:15:00.000Z",
};

function renderQueue(overrides: Partial<React.ComponentProps<typeof ManagementRecoveryQueueView>> = {}) {
  return renderToStaticMarkup(
    <ManagementRecoveryQueueView
      state={{ status: "ready", requests: [releaseRequest] }}
      reviewNotes={{}}
      reviewErrors={{}}
      reviewingRequestId={null}
      reviewingDecision={null}
      approvalRequest={null}
      rejectionRequest={null}
      successMessage={null}
      onRetry={vi.fn()}
      onReviewNoteChange={vi.fn()}
      onRequestApproval={vi.fn()}
      onRequestRejection={vi.fn()}
      onCancelApproval={vi.fn()}
      onConfirmApproval={vi.fn()}
      onCancelRejection={vi.fn()}
      onConfirmRejection={vi.fn()}
      {...overrides}
    />,
  );
}

describe("ManagementRecoveryQueueView", () => {
  it("shows loading and role-denied states without rendering request evidence", () => {
    const loading = renderQueue({ state: { status: "loading" } });
    const forbidden = renderQueue({ state: { status: "forbidden" } });

    expect(loading).toContain("Loading pending requests");
    expect(loading).not.toContain(releaseRequest.evidence);
    expect(forbidden).toContain("Access denied");
    expect(forbidden).toContain("Only operators and administrators can review management recovery requests.");
    expect(forbidden).not.toContain(releaseRequest.evidence);
  });

  it("shows retryable errors and the empty queue state", () => {
    const error = renderQueue({ state: { status: "error", message: "Service unavailable" } });
    const empty = renderQueue({ state: { status: "ready", requests: [] } });

    expect(error).toContain("Service unavailable");
    expect(error).toContain("Try again");
    expect(empty).toContain("No pending requests");
    expect(empty).toContain("New management recovery requests will appear here for review.");
    expect(empty).toContain("Refresh queue");
  });

  it("shows affected resources, parties, transfer, evidence, impact, and the required note", () => {
    const html = renderQueue({
      state: { status: "ready", requests: [releaseRequest, profileRequest] },
      successMessage: "Recovery approved.",
    });

    expect(html).toContain("Release management transfer");
    expect(html).toContain("Profile management transfer");
    expect(html).toContain("Affected releases (2)");
    expect(html).toContain("Affected profile<");
    expect(html).toContain('href="/release/rel-1"');
    expect(html).toContain('href="/release/rel%202"');
    expect(html).toContain('href="/artist/artist-42"');
    expect(html).toContain("Requester (original proposer)");
    expect(html).toContain("Current manager (transfer recipient)");
    expect(html).toContain("aya@example.com");
    expect(html).toContain("label@example.com");
    expect(html.match(/Email unavailable/g)).toHaveLength(2);
    expect(html).toContain("transfer-8f21");
    expect(html).toContain(releaseRequest.evidence);
    expect(html).toContain("Submitted evidence");
    expect(html).toContain("Review note");
    expect(html).toContain("Required");
    expect(html).toContain("Approving returns management of 2 releases to the requester");
    expect(html).toContain("Approving returns management of this profile to the requester");
    expect(html).toContain("Approve recovery");
    expect(html).toContain("Reject recovery");
    expect(html).toContain("Recovery approved.");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("surfaces a review error on the card", () => {
    const html = renderQueue({ reviewErrors: { [releaseRequest.id]: "Transfer participants cannot review this request." } });

    expect(html).toContain("Transfer participants cannot review this request.");
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
  });

  it("labels only the in-flight decision and disables every decision while a review is saving", () => {
    const html = renderQueue({
      state: { status: "ready", requests: [releaseRequest, profileRequest] },
      reviewingRequestId: releaseRequest.id,
      reviewingDecision: "approve",
    });

    expect(html).toContain("Approving…");
    expect(html).not.toContain("Rejecting…");
    expect(html.match(/Approve recovery/g)).toHaveLength(1);
    expect(html.match(/Reject recovery/g)).toHaveLength(2);
    expect(html.match(/disabled=""/g)).toHaveLength(4);
  });

  it("summarizes the queue with a pending count and a refresh control", () => {
    const html = renderQueue({ state: { status: "ready", requests: [releaseRequest, profileRequest] } });

    expect(html).toContain("2 pending");
    expect(html).toContain("Oldest requested");
    expect(html).toContain("Refresh");
  });

  it("builds resource links, labels, and impact text for each resource type", () => {
    expect(resourceHref("release", "a/b")).toBe("/release/a%2Fb");
    expect(resourceHref("artist_profile", "artist-42")).toBe("/artist/artist-42");
    expect(getAffectedResourcesLabel(releaseRequest)).toBe("Affected releases (2)");
    expect(getAffectedResourcesLabel(profileRequest)).toBe("Affected profile");
    expect(getImpactNotice(profileRequest)).toContain("Credits, rights, and payouts do not change.");
  });

  it("explains the consequences in the approval and rejection confirmations", () => {
    const approval = getApprovalMessage(releaseRequest);
    expect(approval).toContain("Resources affected:\n• First Light\n• Night Drive");
    expect(approval).toContain("restore the original proposer’s management authority");
    expect(approval).toContain("management grants revoked");
    expect(approval).toContain("pending management transfers for these resources cancelled");
    expect(approval).toContain("Credits, rights, and payouts will not change.");

    expect(getRejectionMessage()).toBe(
      "Reject this recovery request? Management stays with the current manager. The requester can submit a new request with more evidence if the transfer is still eligible. Your review note is recorded with the decision.",
    );
  });
});
