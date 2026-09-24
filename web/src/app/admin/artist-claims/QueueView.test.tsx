import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ArtistClaimsQueueView, {
  countClaimsByArtist,
  formatRequestedAt,
  getApprovalMessage,
  getRejectionMessage,
  reviewerIsClaimant,
} from "./QueueView";
import type { PendingArtistClaim } from "../../../lib/api";

const claim: PendingArtistClaim = {
  id: "claim-1",
  artistId: "artist-42",
  claimantUserId: "0xAbCd1234",
  evidence: "I am the credited artist. My official site links to this profile.",
  status: "pending",
  createdAt: "2026-09-20T10:15:00.000Z",
  artist: { id: "artist-42", displayName: "Nova" },
};

function renderQueue(overrides: Partial<React.ComponentProps<typeof ArtistClaimsQueueView>> = {}) {
  return renderToStaticMarkup(
    <ArtistClaimsQueueView
      state={{ status: "ready", claims: [claim] }}
      reviewerUserId="0x9876"
      reviewNotes={{}}
      reviewErrors={{}}
      reviewingClaimId={null}
      reviewingDecision={null}
      approvalClaim={null}
      rejectionClaim={null}
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

describe("ArtistClaimsQueueView", () => {
  it("shows loading and role-denied states without rendering claim evidence", () => {
    const loading = renderQueue({ state: { status: "loading" } });
    const forbidden = renderQueue({ state: { status: "forbidden" } });

    expect(loading).toContain("Loading pending artist claims");
    expect(loading).not.toContain(claim.evidence);
    expect(forbidden).toContain("Only operators and administrators");
    expect(forbidden).not.toContain(claim.evidence);
  });

  it("shows retryable errors and the empty queue state", () => {
    const error = renderQueue({ state: { status: "error", message: "Service unavailable" } });
    const empty = renderQueue({ state: { status: "ready", claims: [] } });

    expect(error).toContain("Service unavailable");
    expect(error).toContain("Try again");
    expect(empty).toContain("No pending artist claims");
    expect(empty).toContain("Refresh queue");
  });

  it("shows the exact profile, claimant, request time, evidence, and required note", () => {
    const html = renderQueue({ successMessage: "Artist claim approved." });

    expect(html).toContain('href="/artist/artist-42"');
    expect(html).toContain("Profile ID: artist-42");
    expect(html).toContain(claim.claimantUserId);
    expect(html).toContain("Requested");
    expect(html).toContain(claim.evidence);
    expect(html).toContain("Review note");
    expect(html).toMatch(/required/i);
    expect(html).toContain("Open Nova profile");
    expect(html).toContain("Artist claim approved.");
  });

  it("shows only the independent-review notice when the current reviewer is the claimant", () => {
    const html = renderQueue({ reviewerUserId: "0xaBcD1234" });

    expect(reviewerIsClaimant("0xaBcD1234", claim.claimantUserId)).toBe(true);
    expect(html).toContain("Your account submitted this claim");
    expect(html).toContain("An independent operator must review it");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Approve claim");
    expect(html).not.toContain("Reject claim");
  });

  it("allows a reviewer account distinct from the claimant to act", () => {
    const html = renderQueue({ reviewerUserId: "0x9876" });

    expect(reviewerIsClaimant("0x9876", claim.claimantUserId)).toBe(false);
    expect(html).toContain("<textarea");
    expect(html).toContain("Approve claim");
    expect(html).toContain("Reject claim");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("labels only the in-flight decision and disables every decision while a review is saving", () => {
    const other: PendingArtistClaim = { ...claim, id: "claim-2", artistId: "artist-7", artist: { id: "artist-7", displayName: "Orbit" } };
    const html = renderQueue({
      state: { status: "ready", claims: [claim, other] },
      reviewingClaimId: claim.id,
      reviewingDecision: "reject",
    });

    expect(html).toContain("Rejecting…");
    expect(html).not.toContain("Approving…");
    expect(html.match(/Approve claim/g)).toHaveLength(2);
    expect(html.match(/disabled=""/g)).toHaveLength(4);
  });

  it("summarizes the queue with a pending count and a refresh control", () => {
    const other: PendingArtistClaim = { ...claim, id: "claim-2", artistId: "artist-7", artist: { id: "artist-7", displayName: "Orbit" } };
    const html = renderQueue({ state: { status: "ready", claims: [claim, other] } });

    expect(html).toContain("2 pending");
    expect(html).toContain("Oldest requested");
    expect(html).toContain("Refresh");
  });

  it("flags competing pending claims for the same artist profile", () => {
    const competing: PendingArtistClaim = { ...claim, id: "claim-2", claimantUserId: "0xFeed" };
    const flagged = renderQueue({ state: { status: "ready", claims: [claim, competing] } });
    const single = renderQueue();

    expect(flagged.match(/2 claims for this profile/g)).toHaveLength(2);
    expect(flagged).toContain("Approving this claim automatically rejects the other pending claim for this profile.");
    expect(single).not.toContain("claims for this profile");
    expect(single).not.toContain("automatically rejects");
    expect(countClaimsByArtist([claim, competing]).get("artist-42")).toBe(2);
  });

  it("explains competing-claim auto-rejection in the approval confirmation", () => {
    expect(getApprovalMessage(claim)).not.toContain("automatically rejects");
    expect(getApprovalMessage(claim, 2)).toContain("automatically rejects the other pending claim for this profile");
    expect(getApprovalMessage(claim, 3)).toContain("automatically rejects the other 2 pending claims for this profile");
    expect(getRejectionMessage(claim)).toContain("“Nova” profile (profile ID artist-42)");
  });

  it("formats request times as relative and absolute labels", () => {
    const now = Date.parse("2026-09-21T10:15:00.000Z");

    expect(formatRequestedAt(claim.createdAt, now)?.relative).toBe("1 day ago");
    expect(formatRequestedAt(claim.createdAt, now)?.iso).toBe(claim.createdAt);
    expect(formatRequestedAt("not-a-date", now)).toBeNull();
  });
});
