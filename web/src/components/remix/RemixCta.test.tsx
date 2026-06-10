import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemixEligibilityResponse, RemixProject } from "../../lib/api";
import { findReusableDraft, RemixCta, resolveRemixCtaState } from "./RemixCta";

const mockUseAuth = vi.fn(() => ({ token: "jwt-token", login: vi.fn() }));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock("../ui/Toast", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function eligibility(
  overrides: Partial<RemixEligibilityResponse> = {},
): RemixEligibilityResponse {
  return {
    allowed: true,
    requiredLicense: null,
    allowedActions: ["private_draft"],
    reasons: [],
    policyVersion: "test.v1",
    source: {
      trackId: "track-1",
      rightsRoute: "STANDARD_ESCROW",
      contentStatus: "clean",
    },
    stems: [{ stemId: "stem-1", remixable: true, licensed: true }],
    ...overrides,
  };
}

describe("resolveRemixCtaState", () => {
  it("asks signed-out users to sign in instead of fetching eligibility", () => {
    const state = resolveRemixCtaState({
      signedIn: false,
      loading: false,
      eligibility: null,
    });
    expect(state.kind).toBe("signed_out");
  });

  it("hides the CTA while loading and when eligibility is unknown", () => {
    expect(
      resolveRemixCtaState({ signedIn: true, loading: true, eligibility: null })
        .kind,
    ).toBe("hidden");
    expect(
      resolveRemixCtaState({ signedIn: true, loading: false, eligibility: null })
        .kind,
    ).toBe("hidden");
  });

  it("enables remix for allowed sources", () => {
    const state = resolveRemixCtaState({
      signedIn: true,
      loading: false,
      eligibility: eligibility(),
    });
    expect(state).toEqual({ kind: "remix", label: "Remix" });
  });

  it("routes to license purchase when a remix license is required", () => {
    const state = resolveRemixCtaState({
      signedIn: true,
      loading: false,
      eligibility: eligibility({
        allowed: false,
        requiredLicense: "remix",
        allowedActions: [],
        reasons: [
          { code: "license_required", message: "A remix license is required." },
        ],
      }),
    });
    expect(state.kind).toBe("license_required");
    expect(state).toMatchObject({ label: "Get remix license" });
  });

  it("shows the first policy reason for blocked sources", () => {
    const state = resolveRemixCtaState({
      signedIn: true,
      loading: false,
      eligibility: eligibility({
        allowed: false,
        requiredLicense: null,
        allowedActions: [],
        reasons: [
          { code: "source_blocked", message: "This source is blocked by rights policy." },
          { code: "stem_not_remixable", message: "Stem stem-1 was minted without remix rights." },
        ],
      }),
    });
    expect(state.kind).toBe("blocked");
    expect(state).toMatchObject({
      label: "Remix unavailable",
      reason: "This source is blocked by rights policy.",
    });
  });

  it("falls back to generic copy when no reasons are provided", () => {
    const state = resolveRemixCtaState({
      signedIn: true,
      loading: false,
      eligibility: eligibility({
        allowed: false,
        requiredLicense: null,
        allowedActions: [],
        reasons: [],
      }),
    });
    expect(state).toMatchObject({
      kind: "blocked",
      reason: "Remixing is not available for this source.",
    });
  });
});

describe("RemixCta rendering", () => {
  it("renders an enabled Remix chip for allowed sources", () => {
    const html = renderToStaticMarkup(
      <RemixCta trackId="track-1" initialEligibility={eligibility()} />,
    );
    expect(html).toContain("remix-cta--remix");
    expect(html).toContain("Remix");
    expect(html).not.toContain("disabled");
  });

  it("renders a license CTA when a remix license is required", () => {
    const html = renderToStaticMarkup(
      <RemixCta
        trackId="track-1"
        initialEligibility={eligibility({
          allowed: false,
          requiredLicense: "remix",
          allowedActions: [],
          reasons: [
            { code: "license_required", message: "A remix license is required." },
          ],
        })}
      />,
    );
    expect(html).toContain("remix-cta--license_required");
    expect(html).toContain("Get remix license");
    expect(html).toContain("A remix license unlocks Remix Studio");
  });

  it("renders the license CTA inert with the reason when no remix listing exists", () => {
    const html = renderToStaticMarkup(
      <RemixCta
        trackId="track-1"
        initialEligibility={eligibility({
          allowed: false,
          requiredLicense: "remix",
          allowedActions: [],
          reasons: [
            { code: "license_required", message: "A remix license is required." },
          ],
        })}
        licenseUnavailableReason="The seller hasn't listed a remix license for this stem yet."
      />,
    );
    expect(html).toContain("Get remix license");
    expect(html).toContain("aria-disabled");
    expect(html).toContain("listed a remix license");
  });

  it("renders nothing in license_required state when hidden by the caller", () => {
    const html = renderToStaticMarkup(
      <RemixCta
        trackId="track-1"
        initialEligibility={eligibility({
          allowed: false,
          requiredLicense: "remix",
          allowedActions: [],
          reasons: [
            { code: "license_required", message: "A remix license is required." },
          ],
        })}
        hideWhenLicenseRequired
      />,
    );
    expect(html).toBe("");
  });

  it("still renders the Remix state when hideWhenLicenseRequired is set", () => {
    const html = renderToStaticMarkup(
      <RemixCta
        trackId="track-1"
        initialEligibility={eligibility()}
        hideWhenLicenseRequired
      />,
    );
    expect(html).toContain("remix-cta--remix");
  });

  it("stays interactive when the caller provides a license purchase path", () => {
    const html = renderToStaticMarkup(
      <RemixCta
        trackId="track-1"
        initialEligibility={eligibility({
          allowed: false,
          requiredLicense: "remix",
          allowedActions: [],
          reasons: [
            { code: "license_required", message: "A remix license is required." },
          ],
        })}
        onGetLicense={() => {}}
        licenseUnavailableReason="ignored when a purchase path exists"
      />,
    );
    expect(html).toContain("Get remix license");
    expect(html).not.toContain("aria-disabled");
    expect(html).not.toContain("ignored when a purchase path exists");
  });

  it("renders a disabled chip with the policy reason for blocked sources", () => {
    const html = renderToStaticMarkup(
      <RemixCta
        trackId="track-1"
        initialEligibility={eligibility({
          allowed: false,
          requiredLicense: null,
          allowedActions: [],
          reasons: [
            { code: "source_quarantined", message: "This source is quarantined pending rights review." },
          ],
        })}
      />,
    );
    expect(html).toContain("remix-cta--blocked");
    expect(html).toContain("Remix unavailable");
    expect(html).toContain("This source is quarantined pending rights review.");
    // aria-disabled (not disabled) keeps the reason keyboard-reachable.
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/<button[^>]* disabled[ >=""]*>/);
  });

  it("renders nothing while eligibility is unknown", () => {
    const html = renderToStaticMarkup(
      <RemixCta trackId="track-1" initialEligibility={null} />,
    );
    expect(html).toBe("");
  });

  it("renders a sign-in chip for signed-out users", () => {
    mockUseAuth.mockReturnValueOnce({ token: null as unknown as string, login: vi.fn() });
    const html = renderToStaticMarkup(<RemixCta trackId="track-1" />);
    expect(html).toContain("remix-cta--signed_out");
    expect(html).toContain("Sign in to check remix availability");
  });

  it("renders the button variant with primary styling when allowed", () => {
    const html = renderToStaticMarkup(
      <RemixCta
        trackId="track-1"
        variant="button"
        initialEligibility={eligibility()}
      />,
    );
    expect(html).toContain("ui-btn-primary");
    expect(html).toContain("remix-cta--remix");
  });
});

function draft(overrides: Partial<RemixProject> = {}): RemixProject {
  return {
    id: "proj-1",
    creatorUserId: "user-1",
    sourceTrackId: "track-1",
    title: "Draft",
    status: "draft",
    mode: "stem_mix",
    licenseType: "remix",
    licenseId: null,
    prompt: null,
    generationProvider: null,
    generationJobId: null,
    generationMetadata: null,
    attribution: null,
    exportPolicy: null,
    policyVersion: "test.v1",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    source: {
      trackId: "track-1",
      trackTitle: "Track",
      releaseId: "rel-1",
      releaseTitle: "Release",
      artistName: null,
      rightsRoute: "STANDARD_ESCROW",
      contentStatus: "clean",
    },
    stems: [
      {
        stemId: "stem-1",
        type: "vocals",
        title: null,
        role: null,
        gainDb: null,
        muted: false,
        arrangement: null,
      },
    ],
    ...overrides,
  };
}

describe("findReusableDraft", () => {
  it("opens the most recent draft for the same track", () => {
    const older = draft({ id: "old", createdAt: "2026-06-01T00:00:00.000Z" });
    const newer = draft({ id: "new", createdAt: "2026-06-09T00:00:00.000Z" });
    expect(findReusableDraft([older, newer], "track-1")?.id).toBe("new");
  });

  it("ignores archived projects and other tracks", () => {
    const archived = draft({ id: "archived", status: "archived" });
    const otherTrack = draft({ id: "other", sourceTrackId: "track-2" });
    expect(findReusableDraft([archived, otherTrack], "track-1")).toBeNull();
  });

  it("requires an exact stem set when the CTA is stem-scoped", () => {
    const single = draft({ id: "single" });
    const double = draft({
      id: "double",
      stems: [
        ...draft().stems,
        {
          stemId: "stem-2",
          type: "drums",
          title: null,
          role: null,
          gainDb: null,
          muted: false,
          arrangement: null,
        },
      ],
    });
    expect(findReusableDraft([single, double], "track-1", ["stem-1"])?.id).toBe(
      "single",
    );
    expect(
      findReusableDraft([single], "track-1", ["stem-1", "stem-2"]),
    ).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(findReusableDraft([], "track-1")).toBeNull();
  });
});
