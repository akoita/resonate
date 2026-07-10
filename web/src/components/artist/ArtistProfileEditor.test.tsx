import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ArtistProfile } from "../../lib/api";
import { ArtistProfileEditor } from "./ArtistProfileEditor";
import { ArtistSocialLinksRow } from "./ArtistSocialLinksRow";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ token: "jwt-token" }),
}));
vi.mock("../ui/Toast", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

function artist(overrides: Partial<ArtistProfile> = {}): ArtistProfile {
  return {
    id: "artist-1",
    displayName: "Aya Lune",
    imageUrl: null,
    summary: null,
    website: null,
    socialLinks: null,
    ...overrides,
  };
}

describe("ArtistProfileEditor owner-only affordance (#1419)", () => {
  it("shows the Edit profile button for the owner", () => {
    const html = renderToStaticMarkup(
      <ArtistProfileEditor artist={artist()} isOwner={true} onSaved={() => {}} />,
    );
    expect(html).toContain("Edit profile");
    expect(html).toContain("artist-edit-profile-btn");
  });

  it("renders nothing at all for a non-owner (signed out or a different artist)", () => {
    const html = renderToStaticMarkup(
      <ArtistProfileEditor artist={artist()} isOwner={false} onSaved={() => {}} />,
    );
    expect(html).toBe("");
    expect(html).not.toContain("Edit profile");
  });
});

describe("ArtistSocialLinksRow (#1419)", () => {
  it("renders the website and social links as real anchors with safe rel", () => {
    const html = renderToStaticMarkup(
      <ArtistSocialLinksRow
        website="https://ayalune.example"
        socialLinks={{ instagram: "https://instagram.com/ayalune", x: "https://x.com/ayalune" }}
      />,
    );
    expect(html).toContain('href="https://ayalune.example"');
    expect(html).toContain("Website");
    expect(html).toContain('href="https://instagram.com/ayalune"');
    expect(html).toContain("Instagram");
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('target="_blank"');
  });

  it("renders nothing when there is no website and no social links", () => {
    expect(renderToStaticMarkup(<ArtistSocialLinksRow website={null} socialLinks={null} />)).toBe(
      "",
    );
    expect(
      renderToStaticMarkup(<ArtistSocialLinksRow website={undefined} socialLinks={undefined} />),
    ).toBe("");
  });
});
