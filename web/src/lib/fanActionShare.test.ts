import { describe, expect, it } from "vitest";
import {
  LICENSE_SALE_CLAIM,
  LICENSE_SHARE_CAMPAIGN,
  REMIX_SHARE_CAMPAIGN,
  isArtistSale,
  licenseShareAnalytics,
  licenseShareMessage,
  licenseShareUrl,
  remixShareAnalytics,
  remixShareMessage,
  remixShareUrl,
  type LicenseShareInput,
} from "./fanActionShare";
import { REDDIT_TITLE_MAX_LENGTH, X_MAX_LENGTH, xPostLength, type ShareChannel } from "./listeningShare";

const ORIGIN = "https://music.example.test";
const CHANNELS: ShareChannel[] = ["x", "facebook", "reddit", "native", "copy"];
const FORBIDDEN = /\$|usd|usdc|price|paid|0x[0-9a-f]{6,}|wallet|receipt|transaction|yield|income|invest|royalt|return|appreciat|earn/i;

const sale: LicenseShareInput = {
  stemType: "vocals",
  trackTitle: "Night Drive",
  artistName: "Nadia Okoro",
  licenseType: "personal",
  artistSale: true,
};

function allText(message: { title: string; text: string }) {
  return `${message.title}\n${message.text}`;
}

describe("license share links", () => {
  it("links the public stem page with license_share attribution", () => {
    const url = new URL(licenseShareUrl(`${ORIGIN}/`, "42", "x"));
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/stem/42`);
    expect(url.searchParams.get("utm_campaign")).toBe(LICENSE_SHARE_CAMPAIGN);
    expect(url.searchParams.get("utm_campaign")).toBe("license_share");
    expect(url.searchParams.get("utm_source")).toBe("x");
    expect(url.searchParams.get("utm_medium")).toBe("social");
    expect(new URL(licenseShareUrl(ORIGIN, "42", "copy")).searchParams.get("utm_medium")).toBe("share");
  });
});

describe("license share copy", () => {
  it("names the stem, track and artist", () => {
    const { text } = licenseShareMessage(sale, "native");
    expect(text).toContain('I licensed the vocals stem of "Night Drive" by Nadia Okoro on Resonate.');
  });

  it("says what the license is for", () => {
    expect(licenseShareMessage({ ...sale, licenseType: "remix" }, "copy").text).toContain("on Resonate to remix it.");
    expect(licenseShareMessage({ ...sale, licenseType: "commercial" }, "copy").text).toContain(
      "on Resonate for commercial use.",
    );
  });

  it("makes the 85% claim only for a sale by the stem's creator", () => {
    for (const channel of CHANNELS) {
      expect(allText(licenseShareMessage(sale, channel)).toLowerCase()).toContain(LICENSE_SALE_CLAIM);
      expect(allText(licenseShareMessage({ ...sale, artistSale: false }, channel))).not.toMatch(/85%/);
    }
  });

  it("never states a price, payment detail, wallet, or yield wording", () => {
    for (const channel of CHANNELS) {
      for (const artistSale of [true, false]) {
        const text = allText(licenseShareMessage({ ...sale, artistSale }, channel));
        expect(text).not.toMatch(FORBIDDEN);
      }
    }
  });

  it("falls back to a generic stem and skips unknown artists", () => {
    const { text } = licenseShareMessage(
      { stemType: "other", trackTitle: "Night Drive", artistName: "Unknown Artist", artistSale: false },
      "copy",
    );
    expect(text).toBe('I licensed a stem of "Night Drive" on Resonate.');
  });

  it("fits X (links as 23) and the Reddit title budget with long names", () => {
    const long = {
      ...sale,
      licenseType: "commercial",
      trackTitle: "A".repeat(200),
      artistName: "B".repeat(200),
      stemType: "C".repeat(80),
    };
    const x = licenseShareMessage(long, "x").text;
    expect(xPostLength(x)).toBeLessThanOrEqual(X_MAX_LENGTH);
    expect(x).toContain("I licensed");
    expect(licenseShareMessage(long, "reddit").title.length).toBeLessThanOrEqual(REDDIT_TITLE_MAX_LENGTH);
    expect(xPostLength(licenseShareMessage(sale, "x").text)).toBeLessThanOrEqual(X_MAX_LENGTH);
    expect(licenseShareMessage(sale, "x").text).toContain("#Resonate #Stems");
  });

  it("builds a one-line Reddit title with the claim in brackets", () => {
    expect(licenseShareMessage(sale, "reddit")).toEqual({
      title: `I licensed the vocals stem of "Night Drive" by Nadia Okoro on Resonate (${LICENSE_SALE_CLAIM})`,
      text: "",
    });
  });
});

describe("isArtistSale", () => {
  const creator = "0x1111111111111111111111111111111111111111";
  it("counts x402 checkout (paid to the artist) and the creator's own listing", () => {
    expect(isArtistSale({ method: "x402" })).toBe(true);
    expect(isArtistSale({ method: "onchain", seller: creator.toUpperCase().replace("0X", "0x"), creator })).toBe(true);
  });
  it("never counts a resale or unknown addresses", () => {
    expect(isArtistSale({ method: "onchain", seller: "0x2222222222222222222222222222222222222222", creator })).toBe(false);
    expect(isArtistSale({ method: "onchain", seller: creator, creator: null })).toBe(false);
    expect(isArtistSale({ method: "onchain", seller: null, creator })).toBe(false);
    const zero = "0x0000000000000000000000000000000000000000";
    expect(isArtistSale({ method: "onchain", seller: zero, creator: zero })).toBe(false);
  });
});

describe("license share analytics", () => {
  it("sends compact ids and enums only", () => {
    expect(licenseShareAnalytics({ tokenId: "42", listingId: "7" }, "x")).toEqual({
      source: "buy_modal",
      subjectType: "stem_token",
      subjectId: "42",
      payload: { tokenId: "42", listingId: "7", channel: "x", trigger: "after_purchase" },
    });
    expect(licenseShareAnalytics({ tokenId: "42", listingId: "not-an-id" }, "copy").payload).toEqual({
      tokenId: "42",
      channel: "copy",
      trigger: "after_purchase",
    });
  });
});

describe("remix share", () => {
  const remix = { remixTitle: "Night Drive (Dawn Edit)", sourceTrackTitle: "Night Drive", sourceArtistName: "Nadia Okoro" };

  it("links the remix release with remix_share attribution", () => {
    const url = new URL(remixShareUrl(ORIGIN, "rel_1", "facebook"));
    expect(url.pathname).toBe("/release/rel_1");
    expect(url.searchParams.get("utm_campaign")).toBe(REMIX_SHARE_CAMPAIGN);
    expect(url.searchParams.get("utm_campaign")).toBe("remix_share");
  });

  it("names the remix and its source, with no money claim", () => {
    const { text } = remixShareMessage(remix, "native");
    expect(text).toBe(
      'I just published "Night Drive (Dawn Edit)", my remix of "Night Drive" by Nadia Okoro, on Resonate.\n\nHave a listen.',
    );
    for (const channel of CHANNELS) {
      const all = allText(remixShareMessage(remix, channel));
      expect(all).not.toMatch(/85%/);
      expect(all).not.toMatch(FORBIDDEN);
    }
  });

  it("reads well without a title or source", () => {
    expect(remixShareMessage({}, "copy").text).toBe("I just published my remix on Resonate.\n\nHave a listen.");
    expect(remixShareMessage({ remixTitle: "Dawn" }, "reddit").title).toBe('I just published "Dawn", my remix, on Resonate');
  });

  it("fits X and Reddit budgets with long names", () => {
    const long = { remixTitle: "R".repeat(200), sourceTrackTitle: "T".repeat(200), sourceArtistName: "A".repeat(200) };
    expect(xPostLength(remixShareMessage(long, "x").text)).toBeLessThanOrEqual(X_MAX_LENGTH);
    expect(remixShareMessage(long, "reddit").title.length).toBeLessThanOrEqual(REDDIT_TITLE_MAX_LENGTH);
    expect(remixShareMessage(remix, "x").text).toContain("#Remix #Resonate");
  });

  it("sends compact ids and enums only", () => {
    expect(remixShareAnalytics({ releaseId: "rel_1", projectId: "prj_1" }, "reddit")).toEqual({
      source: "remix_studio",
      subjectType: "release",
      subjectId: "rel_1",
      payload: { releaseId: "rel_1", projectId: "prj_1", channel: "reddit", trigger: "after_publish" },
    });
  });
});
