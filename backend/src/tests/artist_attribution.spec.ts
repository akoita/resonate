/**
 * Canonical credited-artist name resolution — pure unit (#1492 Phase A).
 *
 * Covers the resolution ORDER of the shared helper plus a SOURCE-SCAN guard
 * that keeps discovery/serializer surfaces routed through it. This bug class —
 * surfaces showing the uploader account's `Artist.displayName` ("Bouba",
 * "proof") where the CREDITED artist belongs — regressed repeatedly (#1419,
 * #1492), so the guard fails loudly the moment a serializer re-inlines the raw
 * `a || b || c.artist?.displayName` chain instead of calling the helper.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import {
  MAIN_ARTIST_CREDIT_ROLES,
  normalizeCreditName,
  resolveCreditedArtistName,
} from "../modules/shared/artist_attribution";

describe("resolveCreditedArtistName resolution order (#1492)", () => {
  it("prefers the track artist scalar over everything else", () => {
    expect(
      resolveCreditedArtistName({
        trackArtist: "  Track   Credit ",
        credits: [{ role: "main", displayName: "Credit Artist" }],
        primaryArtist: "Primary Artist",
        accountDisplayName: "Manager Account",
      }),
    ).toBe("Track Credit"); // normalized whitespace, trackArtist wins
  });

  it("joins main-role credits when there is no track artist", () => {
    expect(
      resolveCreditedArtistName({
        credits: [
          { role: "main", displayName: "First" },
          { role: "featured", displayName: "Guest" }, // excluded
          { role: "primary", displayName: "Second" },
        ],
        primaryArtist: "Primary Artist",
        accountDisplayName: "Manager Account",
      }),
    ).toBe("First, Second");
  });

  it("falls back to primaryArtist when no track artist or main credits", () => {
    expect(
      resolveCreditedArtistName({
        credits: [{ role: "featured", displayName: "Guest" }],
        primaryArtist: "Primary Artist",
        accountDisplayName: "Manager Account",
      }),
    ).toBe("Primary Artist");
  });

  it("falls back to the account display name only as a last resort", () => {
    expect(
      resolveCreditedArtistName({
        accountDisplayName: "Manager Account",
      }),
    ).toBe("Manager Account");
  });

  it("returns null when nothing credits an artist", () => {
    expect(resolveCreditedArtistName({})).toBeNull();
    expect(
      resolveCreditedArtistName({
        trackArtist: "   ",
        credits: [],
        primaryArtist: null,
        accountDisplayName: "",
      }),
    ).toBeNull();
  });

  it("treats whitespace-only main credits as empty and moves on", () => {
    expect(
      resolveCreditedArtistName({
        credits: [{ role: "main", displayName: "   " }],
        primaryArtist: "Primary Artist",
      }),
    ).toBe("Primary Artist");
  });

  it("exposes the shared main-role set and normalizer", () => {
    expect(MAIN_ARTIST_CREDIT_ROLES.has("main")).toBe(true);
    expect(MAIN_ARTIST_CREDIT_ROLES.has("primary")).toBe(true);
    expect(MAIN_ARTIST_CREDIT_ROLES.has("featured")).toBe(false);
    expect(normalizeCreditName("  a   b ")).toBe("a b");
  });
});

/**
 * Regression guard: serializers must ROUTE through the helper, not re-inline
 * the account-displayName fallback chain. Kept intentionally simple — a file
 * read + two assertions — because the value is that it runs in the fast unit
 * suite on every change.
 */
describe("credited-artist serializers stay routed through the helper (#1492)", () => {
  const MODULES = resolve(__dirname, "../modules");

  // Every serializer that resolves a credited artist name for a public/
  // discovery surface must import the shared helper.
  const ROUTED_FILES = [
    "catalog/discovery-popularity.service.ts",
    "catalog/catalog.service.ts",
    "punchline/punchline-drop.service.ts",
    "punchline/punchline-collect.service.ts",
    "punchline/punchline-unlock.service.ts",
    "recommendations/recommendations.service.ts",
    "recommendations/home-feed.service.ts",
    "agents/agent_selector.service.ts",
  ];

  // Files where a raw `|| something.artist?.displayName` fallback would be the
  // exact regression this issue fixes. The pattern matches an OR-chain ending
  // in `<expr>.artist?.displayName` (the uploader/manager account label).
  const NO_RAW_FALLBACK = [
    "catalog/discovery-popularity.service.ts",
    "punchline/punchline-drop.service.ts",
    "recommendations/recommendations.service.ts",
    "recommendations/home-feed.service.ts",
  ];
  const RAW_FALLBACK_PATTERN = /\|\|\s*\w+(\.\w+)*\.artist\?\.displayName/;

  it.each(ROUTED_FILES)("%s imports resolveCreditedArtistName", (relative) => {
    const source = readFileSync(resolve(MODULES, relative), "utf8");
    expect(source).toContain("resolveCreditedArtistName");
  });

  it.each(NO_RAW_FALLBACK)(
    "%s no longer inlines the account-displayName fallback chain",
    (relative) => {
      const source = readFileSync(resolve(MODULES, relative), "utf8");
      expect(source).not.toMatch(RAW_FALLBACK_PATTERN);
    },
  );
});
