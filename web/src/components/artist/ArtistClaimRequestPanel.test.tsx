import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiRequestError, type ArtistClaim } from "../../lib/api";
import { ArtistClaimRequestPanel, claimSubmitErrorMessage } from "./ArtistClaimRequestPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, submitArtistClaim: vi.fn() };
});
vi.mock("../ui/Toast", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

function claim(status: ArtistClaim["status"]): ArtistClaim {
  return {
    id: "claim-1",
    artistId: "artist-1",
    status,
    createdAt: "2026-09-20T10:00:00.000Z",
  };
}

function render(current: ArtistClaim | null = null) {
  return renderToStaticMarkup(
    <ArtistClaimRequestPanel
      artistId="artist-1"
      artistName="Aya Lune"
      token="jwt-token"
      claim={current}
      onSubmitted={() => {}}
    />,
  );
}

describe("ArtistClaimRequestPanel (#1856)", () => {
  it("starts with an evidence step in the signed-in workspace", () => {
    const html = render();
    expect(html).toContain("Request access to Aya Lune");
    expect(html).toContain("Continue to evidence");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Sign in to claim");
  });

  it("shows a pending status with no action while a claim is under review", () => {
    const html = render(claim("pending"));
    expect(html).toContain("Pending review");
    expect(html).toContain("only after approval");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<textarea");
  });

  it("invites new evidence after a rejected claim", () => {
    const html = render(claim("rejected"));
    expect(html).toContain("Submit new evidence");
    expect(html).toContain("Your previous request wasn&#x27;t approved");
    expect(html).not.toContain("Continue to evidence");
  });

  it("invites new evidence after revoked access", () => {
    const html = render(claim("revoked"));
    expect(html).toContain("Submit new evidence");
    expect(html).toContain("Your earlier access to this profile was revoked");
  });

  it("shows approved scope without another request action", () => {
    const html = render(claim("approved"));
    expect(html).toContain("Approved");
    expect(html).toContain("Release management, rights, payouts, and private analytics remain separate");
    expect(html).not.toContain("<button");
  });
});

describe("claimSubmitErrorMessage", () => {
  const apiError = (status: number, message: string) =>
    new ApiRequestError(`API ${status}: ${message}`, status, { message, statusCode: status });

  it("explains a claim that is already pending", () => {
    expect(
      claimSubmitErrorMessage(apiError(409, "A pending claim already exists for this artist")),
    ).toBe("You already have a claim under review for this profile.");
  });

  it("detects a pending conflict from the parsed body alone", () => {
    const error = new ApiRequestError("API 409: Conflict", 409, {
      message: "A pending claim already exists for this artist",
    });
    expect(claimSubmitErrorMessage(error)).toBe(
      "You already have a claim under review for this profile.",
    );
  });

  it("explains an ineligible profile", () => {
    expect(
      claimSubmitErrorMessage(apiError(409, "Artist profile is not eligible for a claim")),
    ).toBe(
      "This profile can't be claimed right now. It may already be claimed, or it has no confirmed releases yet.",
    );
  });

  it("explains the concurrent pending-request cap", () => {
    expect(claimSubmitErrorMessage(apiError(409, "A claimant may have at most 5 pending artist claims")))
      .toBe("You can have up to five profile requests under review at once. Wait for a decision before sending another.");
  });

  it("explains invalid evidence length", () => {
    expect(
      claimSubmitErrorMessage(apiError(400, "evidence must be between 20 and 4000 characters")),
    ).toBe("Evidence must be between 20 and 4,000 characters.");
  });

  it("explains an expired session", () => {
    expect(claimSubmitErrorMessage(apiError(401, "Unauthorized"))).toBe(
      "Your session expired. Sign in again, then resubmit.",
    );
  });

  it("explains a missing artist", () => {
    expect(claimSubmitErrorMessage(apiError(404, "Artist not found"))).toBe(
      "This artist profile no longer exists.",
    );
  });

  it("explains rate limiting", () => {
    expect(claimSubmitErrorMessage(apiError(429, "Too Many Requests"))).toBe(
      "Too many requests. Wait up to an hour before trying again.",
    );
  });

  it("falls back to a generic message for other failures", () => {
    const fallback = "We couldn't submit your claim. Check your connection and try again.";
    expect(claimSubmitErrorMessage(apiError(500, "Internal server error"))).toBe(fallback);
    expect(claimSubmitErrorMessage(new TypeError("Failed to fetch"))).toBe(fallback);
    expect(claimSubmitErrorMessage("nope")).toBe(fallback);
  });
});
