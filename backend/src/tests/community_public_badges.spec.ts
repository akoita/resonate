import { publicProfileDto } from "../modules/community/community.service";
import {
  PUBLIC_BADGE_CAP_PER_TYPE,
  publicCredentialId,
  toDtos,
} from "../modules/community/community_public_badges";

const date = new Date("2026-06-01T00:00:00.000Z");
const profile = {
  id: "profile-1",
  userId: "user-1",
  displayName: "Ada",
  bio: null,
  avatarUrl: null,
  profileVisibility: "public",
  createdAt: date,
  updatedAt: date,
};

describe("public supporter/collector badge helpers (#1106)", () => {
  it("collapses proofs to one badge per artist with the strongest proof and open-ended expiry", () => {
    const later = new Date("2026-09-01T00:00:00.000Z");
    const dtos = toDtos("user-1", "artist_supporter", [
      { artistId: "a1", artistDisplayName: " Nova ", issuedAt: later, expiresAt: later, proofMethod: "manual_grant" },
      { artistId: "a1", artistDisplayName: "Nova", issuedAt: date, expiresAt: null, proofMethod: "campaign_support" },
      { artistId: null, artistDisplayName: "Unlinked Artist", issuedAt: date, expiresAt: later, proofMethod: "campaign_support" },
      { artistId: null, artistDisplayName: "  ", issuedAt: date, expiresAt: null, proofMethod: "campaign_support" },
    ]);

    expect(dtos).toHaveLength(2);
    expect(dtos[0]).toEqual({
      schemaVersion: "public-community-credential/v1",
      credentialId: publicCredentialId("user-1", "artist_supporter", "a1"),
      credentialType: "artist_supporter",
      displayLabel: "Supporter of Nova",
      artistId: "a1",
      artistDisplayName: "Nova",
      tier: "supporter",
      status: "active",
      visibility: "public_profile",
      issuedAt: date.toISOString(),
      expiresAt: null,
      proofMethod: "campaign_support",
    });
    expect(dtos[1]).toMatchObject({ artistId: null, displayLabel: "Supporter of Unlinked Artist" });
  });

  it("caps the number of public badges per type", () => {
    const candidates = Array.from({ length: PUBLIC_BADGE_CAP_PER_TYPE + 5 }, (_, i) => ({
      artistId: `a${i}`,
      artistDisplayName: `Artist ${String(i).padStart(2, "0")}`,
      issuedAt: null,
      expiresAt: null,
      proofMethod: "indexed_ownership" as const,
    }));
    expect(toDtos("user-1", "artist_collector", candidates)).toHaveLength(PUBLIC_BADGE_CAP_PER_TYPE);
  });

  it("derives opaque credential ids that differ per user and type", () => {
    const id = publicCredentialId("user-1", "artist_collector", "a1");
    expect(id).toMatch(/^cred_[0-9a-f]{24}$/);
    expect(id).not.toBe(publicCredentialId("user-2", "artist_collector", "a1"));
    expect(id).not.toBe(publicCredentialId("user-1", "artist_supporter", "a1"));
  });

  it("redacts badge sections by default and omits badge arrays entirely", () => {
    const dto = publicProfileDto({
      profile,
      visibility: null,
      supporterBadges: toDtos("user-1", "artist_supporter", [
        { artistId: "a1", artistDisplayName: "Nova", issuedAt: date, expiresAt: null, proofMethod: "campaign_support" },
      ]),
    });
    expect(dto.showcase.supporterBadgesVisible).toBe(false);
    expect(dto.showcase.collectorBadgesVisible).toBe(false);
    expect(dto.showcase).not.toHaveProperty("supporterBadges");
    expect(dto.showcase).not.toHaveProperty("collectorBadges");
    expect(dto.redactions).toEqual(expect.arrayContaining(["supporter_badges_hidden", "collector_badges_hidden"]));
  });

  it("emits only the opted-in badge type", () => {
    const dto = publicProfileDto({
      profile,
      visibility: { showCollectorBadges: true },
      supporterBadges: [],
      collectorBadges: toDtos("user-1", "artist_collector", [
        { artistId: "a2", artistDisplayName: "Nova", issuedAt: null, expiresAt: null, proofMethod: "indexed_ownership" },
      ]),
    });
    expect(dto.showcase).not.toHaveProperty("supporterBadges");
    expect(dto.showcase.collectorBadges).toEqual([expect.objectContaining({ displayLabel: "Collector of Nova" })]);
    expect(dto.redactions).toContain("supporter_badges_hidden");
    expect(dto.redactions).not.toContain("collector_badges_hidden");
  });
});
