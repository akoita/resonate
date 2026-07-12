import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  centsToPriceDollars,
  formatEditionLabel,
  formatPriceCents,
  maskSensitiveLyric,
  newestDraft,
  parsePriceDollarsToCents,
  publishedDrops,
  selectPunchlineView,
  totalEditions,
  validateMomentInput,
  type MomentInputFields,
} from "./punchlineDropHelpers";
import {
  PunchlineCollectibleCard,
  lyricPosterClass,
} from "./PunchlineCollectibleCard";
import { PunchlinePublishReviewContent } from "./PunchlinePublishReviewDialog";
import type { PunchlineDrop, PunchlineMoment } from "../../lib/api";

const BOUNDS = { minMs: 2000, maxMs: 15000 };

function fields(overrides: Partial<MomentInputFields> = {}): MomentInputFields {
  return {
    title: "Hook",
    lyricText: "The punchline",
    artworkUrl: "",
    editionSize: "100",
    priceDollars: "1.50",
    startMs: 1000,
    endMs: 6000,
    ...overrides,
  };
}

function moment(overrides: Partial<PunchlineMoment> = {}): PunchlineMoment {
  return {
    id: "m1",
    title: "Hook",
    lyricText: "The punchline",
    artworkUrl: null,
    sourceStemType: "vocals",
    startMs: 1000,
    endMs: 6000,
    clipAssetUri: null,
    editionSize: 100,
    priceCents: 150,
    rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
    collectedCount: 0,
    ...overrides,
  };
}

function drop(overrides: Partial<PunchlineDrop> = {}): PunchlineDrop {
  return {
    id: "d1",
    trackId: "t1",
    artistId: "a1",
    status: "draft",
    title: "Drop",
    description: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    publishedAt: null,
    rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
    rightsSummary:
      "Personal collectible for playback and profile display only — no commercial use, no remix or sampling rights, and no transfer of copyright or master ownership.",
    moments: [moment()],
    ...overrides,
  };
}

describe("parsePriceDollarsToCents", () => {
  it("parses dollars and cents inside the band", () => {
    expect(parsePriceDollarsToCents("1.50")).toEqual({ ok: true, cents: 150 });
    expect(parsePriceDollarsToCents(" 0 ")).toEqual({ ok: true, cents: 0 });
    // Band endpoints: $0.50 and $9.99.
    expect(parsePriceDollarsToCents("0.50")).toEqual({ ok: true, cents: 50 });
    expect(parsePriceDollarsToCents("9.99")).toEqual({ ok: true, cents: 999 });
  });

  it("rejects blank, malformed, negative, and over-precise input", () => {
    for (const bad of ["", "  ", "abc", "-1", "1.234", "$2", "1,50"]) {
      const result = parsePriceDollarsToCents(bad);
      expect(result.ok).toBe(false);
    }
  });

  it("enforces the canonical $0.50–$9.99 price band (#1462), free excepted", () => {
    // Below the band (but non-zero) and above it are both rejected.
    expect(parsePriceDollarsToCents("0.05").ok).toBe(false);
    expect(parsePriceDollarsToCents("0.49").ok).toBe(false);
    expect(parsePriceDollarsToCents("10.00").ok).toBe(false);
    expect(parsePriceDollarsToCents("12").ok).toBe(false);
    // Free and the band endpoints are allowed.
    expect(parsePriceDollarsToCents("0").ok).toBe(true);
    expect(parsePriceDollarsToCents("0.50").ok).toBe(true);
    expect(parsePriceDollarsToCents("9.99").ok).toBe(true);
  });
});

describe("price formatting", () => {
  it("formats cents as dollars and 0 as free", () => {
    expect(formatPriceCents(150)).toBe("$1.50");
    expect(formatPriceCents(0)).toBe("Free to claim");
  });

  it("round-trips stored cents into the edit form", () => {
    expect(centsToPriceDollars(150)).toBe("1.50");
    expect(centsToPriceDollars(0)).toBe("0");
  });
});

describe("validateMomentInput", () => {
  it("accepts a fully valid moment and returns the API input", () => {
    const result = validateMomentInput(fields(), BOUNDS);
    expect(result).toEqual({
      ok: true,
      value: {
        title: "Hook",
        lyricText: "The punchline",
        artworkUrl: null,
        startMs: 1000,
        endMs: 6000,
        editionSize: 100,
        priceCents: 150,
      },
    });
  });

  it("flags each invalid field with its own message", () => {
    const result = validateMomentInput(
      fields({
        title: "",
        lyricText: "x".repeat(501),
        artworkUrl: "not-a-url",
        editionSize: "0",
        priceDollars: "-2",
        startMs: 5000,
        endMs: 5000,
      }),
      BOUNDS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        "artworkUrl",
        "editionSize",
        "lyricText",
        "price",
        "range",
        "title",
      ]);
    }
  });

  it("enforces the clip bounds from the server", () => {
    const tooShort = validateMomentInput(
      fields({ startMs: 0, endMs: 1000 }),
      BOUNDS,
    );
    expect(tooShort.ok).toBe(false);
    const tooLong = validateMomentInput(
      fields({ startMs: 0, endMs: 20000 }),
      BOUNDS,
    );
    expect(tooLong.ok).toBe(false);
    const missing = validateMomentInput(
      fields({ startMs: null, endMs: null }),
      BOUNDS,
    );
    expect(missing.ok).toBe(false);
  });

  it("accepts ipfs artwork and trims free text", () => {
    const result = validateMomentInput(
      fields({ title: "  Hook  ", artworkUrl: "ipfs://abc" }),
      BOUNDS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Hook");
      expect(result.value.artworkUrl).toBe("ipfs://abc");
    }
  });
});

describe("builder view selection", () => {
  const base = {
    selectedTrackId: "t1" as string | null,
    activeDraft: null as PunchlineDrop | null,
    loading: false,
    error: false,
    eligible: true as boolean | null,
  };

  it("an active draft always wins", () => {
    expect(selectPunchlineView({ ...base, activeDraft: drop() })).toBe(
      "builder",
    );
  });

  it("walks select-track → loading → error/ineligible → overview", () => {
    expect(selectPunchlineView({ ...base, selectedTrackId: null })).toBe(
      "select-track",
    );
    expect(selectPunchlineView({ ...base, loading: true })).toBe("loading");
    expect(selectPunchlineView({ ...base, eligible: null })).toBe("loading");
    expect(selectPunchlineView({ ...base, error: true })).toBe("error");
    expect(selectPunchlineView({ ...base, eligible: false })).toBe(
      "ineligible",
    );
    expect(selectPunchlineView(base)).toBe("overview");
  });
});

describe("drop list helpers", () => {
  it("picks the newest draft and filters published drops", () => {
    const draft = drop({ id: "newest", status: "draft" });
    const published = drop({ id: "pub", status: "published" });
    expect(newestDraft([draft, published])?.id).toBe("newest");
    expect(newestDraft([published])).toBeNull();
    expect(publishedDrops([draft, published]).map((d) => d.id)).toEqual([
      "pub",
    ]);
  });

  it("sums total editions across moments", () => {
    const d = drop({
      moments: [moment({ editionSize: 100 }), moment({ id: "m2", editionSize: 25 })],
    });
    expect(totalEditions(d)).toBe(125);
  });
});

describe("PunchlineCollectibleCard", () => {
  it("renders title, lyric, edition, price, and rights chip", () => {
    const html = renderToStaticMarkup(
      <PunchlineCollectibleCard
        title="Hook"
        lyricText="The punchline"
        artworkUrl={null}
        durationMs={5000}
        editionSize={100}
        priceCents={150}
        rightsLabel="NON_COMMERCIAL_COLLECTIBLE"
      />,
    );
    expect(html).toContain("Hook");
    expect(html).toContain("The punchline");
    expect(html).toContain("Limited edition of 100");
    expect(html).toContain("$1.50");
    expect(html).toContain("NON_COMMERCIAL_COLLECTIBLE");
    expect(html).toContain("5.0s");
  });

  it("renders the free label and the artwork image when provided", () => {
    const html = renderToStaticMarkup(
      <PunchlineCollectibleCard
        title="Hook"
        lyricText="Line"
        artworkUrl="https://example.com/art.png"
        durationMs={4000}
        editionSize={1}
        priceCents={0}
        rightsLabel="NON_COMMERCIAL_COLLECTIBLE"
      />,
    );
    expect(html).toContain("Free to claim");
    expect(html).toContain("https://example.com/art.png");
  });

  it("scales the poster lyric to xl for a short slogan", () => {
    const html = renderToStaticMarkup(
      <PunchlineCollectibleCard
        title="Hook"
        lyricText="Every word counts"
        artworkUrl={null}
        durationMs={5000}
        editionSize={100}
        priceCents={150}
        rightsLabel="NON_COMMERCIAL_COLLECTIBLE"
      />,
    );
    expect(html).toContain("punchline-card-art-lyric--xl");
  });

  it("truncates an over-long lyric to 180 chars plus an ellipsis", () => {
    const longLyric = "a".repeat(200);
    const html = renderToStaticMarkup(
      <PunchlineCollectibleCard
        title="Hook"
        lyricText={longLyric}
        artworkUrl={null}
        durationMs={5000}
        editionSize={100}
        priceCents={150}
        rightsLabel="NON_COMMERCIAL_COLLECTIBLE"
      />,
    );
    expect(html).toContain(`${"a".repeat(180)}…`);
    expect(html).not.toContain("a".repeat(181));
  });
});

describe("lyricPosterClass", () => {
  it("returns xl at and below 70 trimmed chars", () => {
    expect(lyricPosterClass("a".repeat(70))).toBe(
      "punchline-card-art-lyric--xl",
    );
    expect(lyricPosterClass(`  ${"a".repeat(70)}  `)).toBe(
      "punchline-card-art-lyric--xl",
    );
  });

  it("returns lg between 71 and 130 trimmed chars", () => {
    expect(lyricPosterClass("a".repeat(71))).toBe(
      "punchline-card-art-lyric--lg",
    );
    expect(lyricPosterClass("a".repeat(130))).toBe(
      "punchline-card-art-lyric--lg",
    );
  });

  it("returns md above 130 trimmed chars", () => {
    expect(lyricPosterClass("a".repeat(131))).toBe(
      "punchline-card-art-lyric--md",
    );
  });
});

describe("PunchlinePublishReviewContent", () => {
  it("lists every moment and renders the rights warning verbatim", () => {
    const d = drop({
      moments: [
        moment({ title: "First hook", editionSize: 100, priceCents: 150 }),
        moment({ id: "m2", title: "Second hook", editionSize: 25, priceCents: 0 }),
      ],
    });
    const html = renderToStaticMarkup(<PunchlinePublishReviewContent drop={d} />);
    expect(html).toContain("First hook");
    expect(html).toContain("Second hook");
    expect(html).toContain("125");
    expect(html).toContain(d.rightsLabel);
    expect(html).toContain(d.rightsSummary);
    expect(html).toContain("Published drops can’t be edited.");
    expect(html).toContain("No set bonus configured");
  });

  it("notes the set bonus when the drop has an unlock (#488)", () => {
    const withBonus = drop({
      unlock: { unlockType: "complete_set" },
    });
    const html = renderToStaticMarkup(
      <PunchlinePublishReviewContent drop={withBonus} />,
    );
    expect(html).toContain("unlock your set bonus");
  });
});

describe("maskSensitiveLyric (display-only masking)", () => {
  it("masks the weighted word in all common variants, keeping first/last letters", () => {
    expect(maskSensitiveLyric("you don't want none, nigga better run")).toBe(
      "you don't want none, n***a better run",
    );
    expect(maskSensitiveLyric("Nigga, please")).toBe("N***a, please");
    expect(maskSensitiveLyric("my niggas")).toBe("my n****s");
    expect(maskSensitiveLyric("NIGGER")).toBe("N****R");
  });

  it("respects word boundaries — no false positives inside other words", () => {
    expect(maskSensitiveLyric("Niger river sniggering")).toBe(
      "Niger river sniggering",
    );
  });

  it("is idempotent and leaves clean text untouched", () => {
    const clean = "Fresh like, uh, Impala, uh Chrome hydraulics";
    expect(maskSensitiveLyric(clean)).toBe(clean);
    const once = maskSensitiveLyric("nigga");
    expect(maskSensitiveLyric(once)).toBe(once);
  });

  it("the collectible card renders the masked lyric, never the raw word", () => {
    const html = renderToStaticMarkup(
      <PunchlineCollectibleCard
        title="Hook"
        lyricText="You don't want none, nigga better run"
        durationMs={9900}
        editionSize={100}
        priceCents={200}
        rightsLabel="NON_COMMERCIAL_COLLECTIBLE"
      />,
    );
    expect(html).not.toContain("nigga");
    expect(html).toContain("n***a");
  });
});
