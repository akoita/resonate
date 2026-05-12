import { describe, expect, it } from "vitest";
import type { Release, TrustedSourceArtistLinkRecord } from "../api";
import { buildReleaseRightsOnboardingContext } from "../rightsOnboarding";

const release = {
  id: "rel-1",
  artistId: "artist-1",
  title: "Signal Track",
  status: "ready",
  type: "SINGLE",
  primaryArtist: "Signal Artist",
  label: "Signal Label",
  explicit: false,
  createdAt: "2026-05-12T00:00:00.000Z",
  rightsRoute: "LIMITED_MONITORING",
  artist: {
    id: "artist-1",
    displayName: "Signal Artist",
    userId: "0xartist",
  },
} satisfies Release;

function trustedLink(
  overrides: Partial<TrustedSourceArtistLinkRecord> = {},
): TrustedSourceArtistLinkRecord {
  return {
    id: "link-1",
    artistId: "artist-1",
    trustedSourceId: "source-1",
    status: "active",
    trustLevel: "high",
    sourceType: "distributor",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    trustedSource: {
      id: "source-1",
      type: "distributor",
      name: "Distributor Portal",
      sourceKey: "distributor-portal",
      trustLevel: "high",
      reviewState: "active",
      domain: "distributor.example",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("rightsOnboarding", () => {
  it("uses an active high-trust source link for guided fast-path onboarding", () => {
    const context = buildReleaseRightsOnboardingContext({
      release,
      releaseProtection: { humanVerificationStatus: "human_verified" } as never,
      trustedSourceLinks: [trustedLink()],
    });

    expect(context.mode).toBe("guided_trusted_source");
    if (context.mode !== "guided_trusted_source") return;

    expect(context.recommendedRoute).toBe("TRUSTED_FAST_PATH");
    expect(context.prefill.evidenceKind).toBe("trusted_catalog_reference");
    expect(context.prefill.sourceUrl).toBe("https://distributor.example");
    expect(context.prefill.claimedRightsholder).toBe("Signal Label");
    expect(context.reasons).toContain("Human verification is present as a supporting anti-sybil signal");
  });

  it("routes standard-trust links to standard escrow", () => {
    const context = buildReleaseRightsOnboardingContext({
      release,
      trustedSourceLinks: [
        trustedLink({
          trustLevel: "standard",
          trustedSource: {
            ...trustedLink().trustedSource!,
            trustLevel: "standard",
          },
        }),
      ],
    });

    expect(context.mode).toBe("guided_trusted_source");
    if (context.mode !== "guided_trusted_source") return;
    expect(context.recommendedRoute).toBe("STANDARD_ESCROW");
  });

  it("falls back to manual onboarding without an active trusted source", () => {
    const context = buildReleaseRightsOnboardingContext({
      release,
      trustedSourceLinks: [trustedLink({ status: "revoked" })],
    });

    expect(context).toEqual({
      mode: "manual",
      fallbackReason: "No active trusted-source link is available for guided onboarding.",
    });
  });

  it("does not offer guided onboarding for blocked releases", () => {
    const context = buildReleaseRightsOnboardingContext({
      release: { ...release, rightsRoute: "BLOCKED" },
      trustedSourceLinks: [trustedLink()],
    });

    expect(context).toEqual({
      mode: "manual",
      fallbackReason: "Blocked releases require manual rights review before marketplace access.",
    });
  });
});
