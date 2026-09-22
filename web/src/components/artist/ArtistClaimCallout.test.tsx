import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiRequestError, type ArtistClaim } from "../../lib/api";
import { ArtistClaimCallout, claimSubmitErrorMessage } from "./ArtistClaimCallout";

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

function render(token: string | null, current: ArtistClaim | null = null) {
  return renderToStaticMarkup(
    <ArtistClaimCallout
      artistId="artist-1"
      artistName="Aya Lune"
      token={token}
      claim={current}
      onSignIn={() => {}}
      onSubmitted={() => {}}
    />,
  );
}

describe("ArtistClaimCallout (#1492)", () => {
  it("offers a sign-in action to signed-out visitors, with no form", () => {
    const html = render(null);
    expect(html).toContain("Are you Aya Lune?");
    expect(html).toContain("Sign in to claim");
    expect(html).toContain("<button");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("style=");
  });

  it("is collapsed by default for signed-in listeners", () => {
    const html = render("jwt-token");
    expect(html).toContain("Claim this profile");
    expect(html).toContain("hasn&#x27;t been claimed yet");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Sign in to claim");
  });

  it("shows a pending status with no action while a claim is under review", () => {
    const html = render("jwt-token", claim("pending"));
    expect(html).toContain("Pending review");
    expect(html).toContain("nothing on this page changes");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<textarea");
  });

  it("invites new evidence after a rejected claim", () => {
    const html = render("jwt-token", claim("rejected"));
    expect(html).toContain("Submit new evidence");
    expect(html).toContain("Your previous claim wasn&#x27;t approved");
    expect(html).not.toContain("Claim this profile");
  });

  it("invites new evidence after revoked access", () => {
    const html = render("jwt-token", claim("revoked"));
    expect(html).toContain("Submit new evidence");
    expect(html).toContain("Your earlier access to this profile was revoked");
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
      "Too many attempts. Wait a few minutes and try again.",
    );
  });

  it("falls back to a generic message for other failures", () => {
    const fallback = "We couldn't submit your claim. Check your connection and try again.";
    expect(claimSubmitErrorMessage(apiError(500, "Internal server error"))).toBe(fallback);
    expect(claimSubmitErrorMessage(new TypeError("Failed to fetch"))).toBe(fallback);
    expect(claimSubmitErrorMessage("nope")).toBe(fallback);
  });
});
