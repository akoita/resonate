import { describe, expect, it } from "vitest";
import {
  buildMomentShareUrl,
  buildOgIngredients,
  editionsRemaining,
  hueFromSeed,
  isShareCancel,
  momentSeedHue,
  momentShareDescription,
  momentShareText,
  momentShareTitle,
  ogLyricFontPx,
  performMomentShare,
  truncate,
  type PublicMomentShare,
} from "./momentShare";

function makeShare(overrides: Partial<PublicMomentShare["moment"]> = {}): PublicMomentShare {
  return {
    moment: {
      id: "m1",
      title: "The hook",
      lyricText: "This is the punchline everyone quotes",
      artworkUrl: null,
      sourceStemType: "vocals",
      startMs: 1000,
      endMs: 6000,
      clipAssetUri: "https://cdn.example/clip.mp3",
      editionSize: 100,
      priceCents: 0,
      rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
      collectedCount: 3,
      ...overrides,
    },
    drop: { id: "d1", title: "Drop One" },
    track: { id: "t1", title: "Track One" },
    release: { id: "r1", title: "Release One", artworkMimeType: "image/png" },
    artistName: "Real Artist",
  };
}

describe("momentShare — lyric masking (CRITICAL, must match in-app cards)", () => {
  it("masks socially-weighted words in the OG lyric ingredient", () => {
    const share = makeShare({ lyricText: "my nigga we up" });
    const ing = buildOgIngredients(share);
    expect(ing.lyric).toContain("n***a");
    expect(ing.lyric).not.toContain("nigga");
  });

  it("masks socially-weighted words in the share title and share text", () => {
    const share = makeShare({ lyricText: "my nigga we up" });
    expect(momentShareTitle(share)).not.toContain("nigga");
    expect(momentShareText({ lyricText: "my nigga we up", artistName: "X" })).not.toContain(
      "nigga",
    );
  });
});

describe("momentShare — OG ingredients", () => {
  it("uses the same seeded hue as the in-app card seed (title + raw lyric)", () => {
    const share = makeShare();
    const expected = hueFromSeed("The hook" + "This is the punchline everyone quotes");
    expect(momentSeedHue(share.moment)).toBe(expected);
    expect(buildOgIngredients(share).hue).toBe(expected);
  });

  it("steps lyric size down as the lyric grows (mirrors lyricPosterClass)", () => {
    expect(ogLyricFontPx("short slogan")).toBe(76);
    expect(ogLyricFontPx("x".repeat(100))).toBe(56);
    expect(ogLyricFontPx("x".repeat(200))).toBe(40);
  });

  it("uses the generic serial without an edition, and the pride serial with one", () => {
    const share = makeShare({ editionSize: 50 });
    expect(buildOgIngredients(share).serialLabel).toBe("№ 1–50");
    expect(buildOgIngredients(share, { editionNumber: 7 }).serialLabel).toBe("№ 7");
  });

  it("shows editions left, price, artist · track, and rights", () => {
    const ing = buildOgIngredients(makeShare({ editionSize: 100, collectedCount: 3, priceCents: 150 }));
    expect(ing.editionsLabel).toBe("97 of 100 left");
    expect(ing.priceLabel).toBe("$1.50");
    expect(ing.artistLine).toBe("Real Artist · Track One");
    expect(ing.rightsLabel).toBe("NON_COMMERCIAL_COLLECTIBLE");
  });

  it("marks a sold-out moment and truncates a long lyric to the 180-char budget", () => {
    const long = "l".repeat(400);
    const ing = buildOgIngredients(makeShare({ lyricText: long, editionSize: 5, collectedCount: 5 }));
    expect(ing.editionsLabel).toBe("Sold out");
    expect(ing.lyric.endsWith("…")).toBe(true);
    expect(ing.lyric.length).toBeLessThanOrEqual(181);
  });

  it("returns a branded fallback for a missing moment", () => {
    const ing = buildOgIngredients(null);
    expect(ing.wordmark).toBe("RESONATE · DROPS");
    expect(ing.lyric.length).toBeGreaterThan(0);
  });
});

describe("momentShare — metadata text", () => {
  it("title is a masked lyric excerpt then artist", () => {
    const title = momentShareTitle(makeShare());
    expect(title).toBe("“This is the punchline everyone quotes” — Real Artist");
  });

  it("truncates the title lyric excerpt to 60 chars", () => {
    const share = makeShare({ lyricText: "w".repeat(100) });
    const title = momentShareTitle(share);
    expect(title).toContain("…”");
    expect(title.includes("w".repeat(61))).toBe(false);
  });

  it("description carries track, editions left, price, and rights", () => {
    const desc = momentShareDescription(makeShare({ editionSize: 100, collectedCount: 3, priceCents: 0 }));
    expect(desc).toContain("Track One");
    expect(desc).toContain("97 of 100 editions left");
    expect(desc).toContain("Free");
    expect(desc).toContain("Non-commercial collectible");
  });

  it("prepends the edition-pride line when an edition is present", () => {
    const desc = momentShareDescription(makeShare(), {
      editionNumber: 4,
      collectorDisplayName: "Fan McFan",
      acquiredAt: null,
    });
    expect(desc.startsWith("№ 4 of 100, collected by Fan McFan")).toBe(true);
  });
});

describe("momentShare — share URL + method", () => {
  it("builds a plain permalink without a collectible id", () => {
    expect(buildMomentShareUrl("m1")).toBe("http://localhost:3001/moments/m1");
  });

  it("appends ?c= for the edition (pride) view", () => {
    expect(buildMomentShareUrl("m1", "col-9")).toBe(
      "http://localhost:3001/moments/m1?c=col-9",
    );
  });

  it("prefers the Web Share sheet when available", async () => {
    const calls: unknown[] = [];
    const method = await performMomentShare(
      { url: "u", title: "t", text: "x" },
      { share: async (data) => void calls.push(data) },
    );
    expect(method).toBe("web_share");
    expect(calls).toHaveLength(1);
  });

  it("falls back to clipboard when Web Share is unavailable", async () => {
    let copied = "";
    const method = await performMomentShare(
      { url: "the-url", title: "t", text: "x" },
      { clipboard: { writeText: async (v: string) => void (copied = v) } },
    );
    expect(method).toBe("clipboard");
    expect(copied).toBe("the-url");
  });

  it("recognises a cancelled native share", () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    expect(isShareCancel(abort)).toBe(true);
    expect(isShareCancel(new Error("boom"))).toBe(false);
  });
});

describe("momentShare — small helpers", () => {
  it("editionsRemaining floors at zero", () => {
    expect(editionsRemaining({ editionSize: 3, collectedCount: 5 })).toBe(0);
    expect(editionsRemaining({ editionSize: 10, collectedCount: 4 })).toBe(6);
  });

  it("truncate adds an ellipsis only past the limit", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("abcdefghij", 5)).toBe("abcde…");
  });
});
