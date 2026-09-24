import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ArtistClaimsQueueView, { reviewerIsClaimant } from "./QueueView";
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
      approvalClaim={null}
      successMessage={null}
      onRetry={vi.fn()}
      onReviewNoteChange={vi.fn()}
      onRequestApproval={vi.fn()}
      onReject={vi.fn()}
      onCancelApproval={vi.fn()}
      onConfirmApproval={vi.fn()}
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
    expect(html).toContain("required");
    expect(html).toContain("Artist claim approved.");
  });

  it("disables both decisions when the current reviewer is the claimant", () => {
    const html = renderQueue({ reviewerUserId: "0xaBcD1234" });

    expect(reviewerIsClaimant("0xaBcD1234", claim.claimantUserId)).toBe(true);
    expect(html).toContain("Your account submitted this claim");
    expect(html).toContain("An independent operator must review it");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("allows a reviewer account distinct from the claimant to act", () => {
    const html = renderQueue({ reviewerUserId: "0x9876" });

    expect(reviewerIsClaimant("0x9876", claim.claimantUserId)).toBe(false);
    expect(html).not.toContain("disabled=\"\"");
  });
});
