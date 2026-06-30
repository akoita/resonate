import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildTierRows,
  LicenseTiersPanel,
  StemHero,
  type StemIdentity,
} from "./StemDetailSections";

function identity(overrides: Partial<StemIdentity> = {}): StemIdentity {
  return {
    tokenId: "79",
    name: "Guitar Stem",
    stemType: "guitar",
    artworkUrl: "https://example.test/art.png",
    trackTitle: "How We Do",
    artistName: "The Game",
    releaseId: "rel-1",
    creatorAddress: "0xF6917C09aabbccddeeff00112233445278De998a",
    isAiGenerated: true,
    remixable: true,
    listingExpiresAt: "2026-06-17T11:00:00Z",
    ...overrides,
  };
}

describe("StemHero", () => {
  it("renders identity, attribution link, badges, and countdown", () => {
    const html = renderToStaticMarkup(
      <StemHero
        identity={identity()}
        onTogglePreview={() => {}}
        now={new Date("2026-06-10T12:00:00Z")}
      />,
    );
    expect(html).toContain("Guitar Stem");
    expect(html).toContain("How We Do");
    expect(html).toContain("The Game");
    expect(html).toContain('href="/release/rel-1"');
    expect(html).toContain("🤖 AI");
    expect(html).toContain("Remixable");
    expect(html).toContain("Token #79");
    expect(html).toContain("0xF691…998a");
    expect(html).toContain("6d 23h left");
    // Melody theme accent (guitar routes to melody).
    expect(html).toContain("236, 72, 153");
    expect(html).toContain("Play preview");
  });

  it("falls back to a typed display name and hides preview without wiring", () => {
    const html = renderToStaticMarkup(
      <StemHero
        identity={identity({ name: null, artworkUrl: null, listingExpiresAt: null })}
      />,
    );
    expect(html).toContain("Guitar Stem"); // derived from type
    expect(html).not.toContain("Play preview");
    expect(html).not.toContain("left");
  });

  it("uses the fallback artwork source when the primary is missing", () => {
    const html = renderToStaticMarkup(
      <StemHero
        identity={identity({ artworkUrl: null })}
        fallbackArtworkUrl="https://example.test/release-art.png"
      />,
    );
    expect(html).toContain("https://example.test/release-art.png");
  });

  it("renders the themed placeholder when no artwork source exists", () => {
    const html = renderToStaticMarkup(
      <StemHero identity={identity({ artworkUrl: null })} />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("\u{1F3B9}"); // guitar routes to the melody theme emoji
  });

  it("never renders the bare token fallback when a type exists", () => {
    const html = renderToStaticMarkup(
      <StemHero identity={identity({ name: null })} />,
    );
    expect(html).not.toContain("Stem #79</h1>");
  });
});

describe("buildTierRows + LicenseTiersPanel", () => {
  it("marks listed tiers and carries catalog prices", () => {
    const rows = buildTierRows({
      listedTiers: { personal: true, remix: true },
      pricing: { basePlayPriceUsd: 0.05, remixLicenseUsd: 5, commercialLicenseUsd: 25 },
    });
    expect(rows.map((r) => [r.tier, r.listed])).toEqual([
      ["personal", true],
      ["remix", true],
      ["commercial", false],
    ]);

    const html = renderToStaticMarkup(
      <LicenseTiersPanel rows={rows} stemType="vocals" />,
    );
    expect(html).toContain("License tiers");
    expect(html).toContain("unlocks Remix Studio");
    expect(html).toContain("$5.00");
    expect(html).toContain("Not listed");
    expect((html.match(/>Listed</g) ?? []).length).toBe(2);
  });

  it("renders gracefully without catalog pricing", () => {
    const rows = buildTierRows({ listedTiers: {}, pricing: null });
    const html = renderToStaticMarkup(<LicenseTiersPanel rows={rows} />);
    expect(html).toContain("Not listed");
    expect(html).not.toContain("$");
  });

  it("shows the live listing price on listed tiers, not the catalog default", () => {
    const rows = buildTierRows({
      listedTiers: { personal: true },
      pricing: { basePlayPriceUsd: 0.05, remixLicenseUsd: 5 },
      listedPriceLabels: { personal: "0.01 USDC" },
    });
    expect(rows[0].listedPriceLabel).toBe("0.01 USDC");
    expect(rows[1].listedPriceLabel).toBeNull();

    const html = renderToStaticMarkup(<LicenseTiersPanel rows={rows} />);
    // Listed personal tier: live price replaces the $0.05 default.
    expect(html).toContain("0.01 USDC");
    expect(html).not.toContain("$0.05");
    // Unlisted remix tier keeps the default, marked as such.
    expect(html).toContain("$5.00");
    expect(html).toContain("default");
  });

  it("keeps the catalog price on a listed tier when no live label is known", () => {
    const rows = buildTierRows({
      listedTiers: { remix: true },
      pricing: { remixLicenseUsd: 5 },
    });
    const html = renderToStaticMarkup(<LicenseTiersPanel rows={rows} />);
    expect(html).toContain("$5.00");
    expect((html.match(/>Listed</g) ?? []).length).toBe(1);
  });

  it("renders a Buy button only on listed tiers when onBuyTier is provided", () => {
    const rows = buildTierRows({
      listedTiers: { remix: true },
      pricing: { remixLicenseUsd: 5, commercialLicenseUsd: 25 },
    });
    const html = renderToStaticMarkup(
      <LicenseTiersPanel rows={rows} onBuyTier={() => {}} />,
    );
    // Listed remix tier offers a Buy action; unlisted tiers do not.
    expect(html).toContain("Buy remix");
    expect(html).toContain('aria-label="Buy Remix license"');
    expect(html).not.toContain("Buy commercial");
    expect(html).not.toContain("Buy personal");
  });

  it("omits Buy buttons for a seller viewing their own listing (no onBuyTier)", () => {
    const rows = buildTierRows({
      listedTiers: { personal: true, remix: true },
      pricing: { basePlayPriceUsd: 0.05, remixLicenseUsd: 5 },
    });
    const html = renderToStaticMarkup(<LicenseTiersPanel rows={rows} />);
    expect(html).not.toContain("license-tiers-panel__buy");
  });
});
