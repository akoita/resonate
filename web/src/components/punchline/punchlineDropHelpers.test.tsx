import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  centsToPriceDollars,
  formatEditionLabel,
  formatPriceCents,
  newestDraft,
  parsePriceDollarsToCents,
  publishedDrops,
  selectPunchlineView,
  totalEditions,
  validateMomentInput,
  type MomentInputFields,
} from "./punchlineDropHelpers";
import { PunchlineCollectibleCard } from "./PunchlineCollectibleCard";
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
  it("parses dollars and cents", () => {
    expect(parsePriceDollarsToCents("1.50")).toEqual({ ok: true, cents: 150 });
    expect(parsePriceDollarsToCents("12")).toEqual({ ok: true, cents: 1200 });
    expect(parsePriceDollarsToCents(" 0 ")).toEqual({ ok: true, cents: 0 });
    expect(parsePriceDollarsToCents("0.05")).toEqual({ ok: true, cents: 5 });
  });

  it("rejects blank, malformed, negative, and over-precise input", () => {
    for (const bad of ["", "  ", "abc", "-1", "1.234", "$2", "1,50"]) {
      const result = parsePriceDollarsToCents(bad);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects prices above the backend maximum", () => {
    expect(parsePriceDollarsToCents("10000.01").ok).toBe(false);
    expect(parsePriceDollarsToCents("10000").ok).toBe(true);
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
  });
});
