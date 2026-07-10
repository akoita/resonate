import { describe, expect, it } from "vitest";
import {
  artistProfileFormStateFromProfile,
  buildArtistProfileUpdatePayload,
  isArtistProfileOwner,
  isValidHttpUrl,
  normalizeSocialUrl,
  type ArtistProfileFormState,
} from "./artistProfileForm";

describe("isArtistProfileOwner (#1419)", () => {
  it("is true only when the signed-in profile id matches the viewed artist's id", () => {
    expect(isArtistProfileOwner({ id: "a1" }, { id: "a1" })).toBe(true);
  });

  it("is false for a different artist, or when either side is missing", () => {
    expect(isArtistProfileOwner({ id: "a1" }, { id: "a2" })).toBe(false);
    expect(isArtistProfileOwner(null, { id: "a1" })).toBe(false);
    expect(isArtistProfileOwner({ id: "a1" }, null)).toBe(false);
    expect(isArtistProfileOwner(undefined, undefined)).toBe(false);
  });
});

describe("isValidHttpUrl", () => {
  it("accepts absolute http(s) URLs", () => {
    expect(isValidHttpUrl("https://example.com")).toBe(true);
    expect(isValidHttpUrl("http://example.com/path?x=1")).toBe(true);
  });

  it("rejects non-http(s) schemes and malformed input", () => {
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl("")).toBe(false);
  });
});

describe("normalizeSocialUrl (#1419)", () => {
  it("passes through a well-formed https URL", () => {
    expect(normalizeSocialUrl("https://instagram.com/artist")).toBe(
      "https://instagram.com/artist",
    );
  });

  it("adds an https scheme to a bare domain", () => {
    expect(normalizeSocialUrl("instagram.com/artist")).toBe(
      "https://instagram.com/artist",
    );
  });

  it("trims surrounding whitespace before validating", () => {
    expect(normalizeSocialUrl("  https://x.com/artist  ")).toBe(
      "https://x.com/artist",
    );
  });

  it("rejects javascript: and data: schemes", () => {
    expect(normalizeSocialUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeSocialUrl("javascript://alert(1)")).toBeNull();
    expect(normalizeSocialUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("returns null for blank input", () => {
    expect(normalizeSocialUrl("")).toBeNull();
    expect(normalizeSocialUrl("   ")).toBeNull();
    expect(normalizeSocialUrl(null)).toBeNull();
    expect(normalizeSocialUrl(undefined)).toBeNull();
  });
});

describe("artistProfileFormStateFromProfile", () => {
  it("hydrates form state from a profile, defaulting missing fields to empty strings", () => {
    expect(
      artistProfileFormStateFromProfile({
        imageUrl: "https://img",
        summary: "bio",
        website: "https://site.example",
        socialLinks: { instagram: "https://instagram.com/artist" },
      }),
    ).toEqual({
      imageUrl: "https://img",
      summary: "bio",
      website: "https://site.example",
      x: "",
      instagram: "https://instagram.com/artist",
      tiktok: "",
      youtube: "",
      soundcloud: "",
    });
  });

  it("handles a profile with no image/bio/website/social links at all", () => {
    expect(artistProfileFormStateFromProfile({})).toEqual({
      imageUrl: "",
      summary: "",
      website: "",
      x: "",
      instagram: "",
      tiktok: "",
      youtube: "",
      soundcloud: "",
    });
  });
});

describe("buildArtistProfileUpdatePayload (#1419)", () => {
  const baseForm: ArtistProfileFormState = {
    imageUrl: "https://img.example/a.png",
    summary: "  A great artist.  ",
    website: "site.example",
    x: "https://x.com/artist",
    instagram: "",
    tiktok: "",
    youtube: "",
    soundcloud: "",
  };

  it("normalizes and trims a valid form into the PATCH body", () => {
    const result = buildArtistProfileUpdatePayload(baseForm);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toEqual({
      imageUrl: "https://img.example/a.png",
      summary: "A great artist.",
      website: "https://site.example",
      socialLinks: { x: "https://x.com/artist" },
    });
  });

  it("omits blank social fields from the socialLinks object", () => {
    const result = buildArtistProfileUpdatePayload({ ...baseForm, x: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.socialLinks).toEqual({});
  });

  it("rejects the whole submission with an honest error when a social URL is invalid", () => {
    const result = buildArtistProfileUpdatePayload({
      ...baseForm,
      instagram: "javascript:alert(1)",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Instagram");
  });

  it("rejects an invalid website URL", () => {
    const result = buildArtistProfileUpdatePayload({ ...baseForm, website: "javascript:x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("website");
  });

  it("allows an empty website (clearing it) without error", () => {
    const result = buildArtistProfileUpdatePayload({ ...baseForm, website: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.website).toBe("");
  });
});
