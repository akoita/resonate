import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_SITE_URL,
  DEFAULT_SOCIAL_IMAGE,
  PRIVATE_ROBOTS,
  SITE_NAME,
  SITE_TAGLINE,
  canonicalPath,
  canonicalUrl,
  configuredChainId,
  normalizeSiteUrl,
  privateMetadata,
  publicMetadata,
  resolveImageUrl,
  safeText,
  socialImageUrl,
} from "./seo";

describe("SEO metadata primitives", () => {
  it("normalizes configured site URLs and falls back for unsafe values", () => {
    expect(normalizeSiteUrl(" https://music.example.test///?preview=1#home ")).toBe(
      "https://music.example.test",
    );
    expect(normalizeSiteUrl("https://music.example.test/resonate/")).toBe(
      "https://music.example.test/resonate",
    );
    expect(normalizeSiteUrl("ftp://music.example.test")).toBe(DEFAULT_SITE_URL);
    expect(normalizeSiteUrl("not a URL")).toBe(DEFAULT_SITE_URL);
    expect(normalizeSiteUrl()).toBe(DEFAULT_SITE_URL);
  });

  it("encodes dynamic path segments and resolves canonical URLs", () => {
    const path = canonicalPath("artist", "A/B & C", 42);
    expect(path).toBe("/artist/A%2FB%20%26%20C/42");
    expect(canonicalUrl(path, "https://music.example.test/")).toBe(
      "https://music.example.test/artist/A%2FB%20%26%20C/42",
    );
    expect(canonicalUrl("/release/a title#ignored", "https://music.example.test")).toBe(
      "https://music.example.test/release/a%20title",
    );
    expect(canonicalUrl("https://other.example.test/elsewhere", "https://music.example.test")).toBe(
      "https://music.example.test/elsewhere",
    );
  });

  it("trims text and uses bounded, defensive fallbacks", () => {
    expect(safeText("  an   artist\nname  ", "fallback")).toBe("an artist name");
    expect(safeText(null, "  fallback copy  ")).toBe("fallback copy");
    expect(safeText({ unexpected: true }, "fallback")).toBe("fallback");
    expect(safeText("abcdefghijklmnopqrstuvwxyz", "fallback", 10)).toBe("abcdefghi…");
  });

  it("handles relative/external images and falls back to the default cover", () => {
    const siteUrl = "https://music.example.test";
    expect(resolveImageUrl("/covers/artist.png", siteUrl)).toBe(
      "https://music.example.test/covers/artist.png",
    );
    expect(resolveImageUrl("covers/artist.png", siteUrl)).toBe(
      "https://music.example.test/covers/artist.png",
    );
    expect(resolveImageUrl("https://cdn.example.test/artist.png", siteUrl)).toBe(
      "https://cdn.example.test/artist.png",
    );
    expect(resolveImageUrl("javascript:alert(1)", siteUrl)).toBeUndefined();
    expect(socialImageUrl(undefined, siteUrl)).toBe(
      `https://music.example.test${DEFAULT_SOCIAL_IMAGE}`,
    );
  });

  it("builds complete public Open Graph and Twitter metadata", () => {
    const metadata = publicMetadata({
      title: "  Artist Name  ",
      description: "  A public artist profile. ",
      path: canonicalPath("artist", "artist id"),
      image: "https://cdn.example.test/profile.png",
      siteUrl: "https://music.example.test/",
    });

    expect(metadata.title).toBe("Artist Name");
    expect(metadata.description).toBe("A public artist profile.");
    expect(metadata.alternates?.canonical).toBe(
      "https://music.example.test/artist/artist%20id",
    );
    expect(metadata.robots).toEqual({
      index: true,
      follow: true,
      noarchive: false,
      noimageindex: false,
      nosnippet: false,
    });
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      siteName: SITE_NAME,
      title: "Artist Name",
      description: "A public artist profile.",
      url: "https://music.example.test/artist/artist%20id",
      images: [{ url: "https://cdn.example.test/profile.png", alt: "Artist Name" }],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Artist Name",
      description: "A public artist profile.",
      images: ["https://cdn.example.test/profile.png"],
    });
  });

  it("uses site defaults and a complete fallback image for sparse public metadata", () => {
    const metadata = publicMetadata({ siteUrl: "https://music.example.test" });
    expect(metadata.title).toBe(SITE_NAME);
    expect(metadata.description).toBe(SITE_TAGLINE);
    expect(metadata.openGraph).toMatchObject({
      images: [{ url: `https://music.example.test${DEFAULT_SOCIAL_IMAGE}` }],
    });
    expect(metadata.twitter).toMatchObject({
      images: [`https://music.example.test${DEFAULT_SOCIAL_IMAGE}`],
    });
  });

  it("marks private metadata as noindex, nofollow, and noarchive", () => {
    const metadata = privateMetadata({ title: " Settings ", description: " Private area " });
    expect(metadata.title).toBe("Settings");
    expect(metadata.description).toBe("Private area");
    expect(metadata.robots).toEqual(PRIVATE_ROBOTS);
    expect(metadata.alternates).toBeNull();
    expect(metadata.openGraph).toBeNull();
    expect(metadata.twitter).toBeNull();
  });

  it("clears inherited public metadata from private routes", () => {
    const metadata = privateMetadata({ title: "Wallet" });
    expect(metadata.description).toBeNull();
    expect(metadata.alternates).toBeNull();
    expect(metadata.openGraph).toBeNull();
    expect(metadata.twitter).toBeNull();
  });

  it("matches the frontend's configured chain defaults for public token metadata", () => {
    expect(configuredChainId()).toBe(DEFAULT_CHAIN_ID);
    expect(configuredChainId("84532")).toBe(84532);
    expect(configuredChainId("31337")).toBe(31337);
    expect(configuredChainId("unknown")).toBe(DEFAULT_CHAIN_ID);
  });
});
