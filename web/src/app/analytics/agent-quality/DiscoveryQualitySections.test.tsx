import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DiscoveryQualitySections, { DISCOVERY_ROW_LIMIT } from "./DiscoveryQualitySections";
import type {
  DiscoverySurfaceRow,
  DiscoveryVariantComparison,
  ResonantDiscoveriesSummary,
} from "../../../lib/api";

const counts = { impressions: 0, clicks: 0, plays: 0, completions: 0, skips: 0, saves: 0 };
const rates = { clickThroughRate: 0, skipRate: 0, completionRate: 0, saveRate: 0 };

const homeRow: DiscoverySurfaceRow = {
  surface: "home:because_genre",
  ...counts,
  impressions: 16,
  clicks: 3,
  plays: 6,
  skips: 2,
  saves: 1,
  completions: 3,
  clickThroughRate: 0.1875,
  skipRate: 0.3333,
  completionRate: 0.5,
  saveRate: 0.1667,
};
const djRow: DiscoverySurfaceRow = {
  surface: "dj",
  ...counts,
  ...rates,
  impressions: 12,
  plays: 10,
  skips: 3,
  saves: 2,
  completions: 5,
  skipRate: 0.3,
  completionRate: 0.5,
  saveRate: 0.2,
};

const comparisonRow: DiscoveryVariantComparison = {
  experimentKey: "ranker_v2",
  surface: "dj",
  variant: "candidate",
  baselineVariant: "baseline",
  sampleSize: { baselineImpressions: 40, variantImpressions: 21, baselinePlays: 33, variantPlays: 18 },
  deltas: { clickThroughRate: 0, skipRate: -0.05, completionRate: 0.0834, saveRate: 0.012 },
};

const resonant: ResonantDiscoveriesSummary = {
  total: 14,
  distinctNewArtists: 9,
  perActiveListener: 0.7,
  activeListeners: 20,
  status: "ok",
};

function render(data: React.ComponentProps<typeof DiscoveryQualitySections>["data"]) {
  return renderToStaticMarkup(<DiscoveryQualitySections data={data} />);
}

describe("DiscoveryQualitySections", () => {
  it("renders surface rates with sample sizes, resonant discoveries and the variant comparison", () => {
    const html = render({
      surfaceBreakdown: [djRow, homeRow],
      variantExposure: [
        { experimentKey: "ranker_v2", surface: "dj", variant: "candidate", generations: 57 },
        { experimentKey: "ranker_v2", surface: "dj", variant: "baseline", generations: 91 },
      ],
      comparison: { baselineVariant: "baseline", note: "Descriptive differences only.", rows: [comparisonRow] },
      resonantDiscoveries: resonant,
    });

    expect(html).toContain("Resonant Discoveries");
    expect(html).toContain(">14<");
    expect(html).toContain(">9<");
    expect(html).toContain("0.70");
    expect(html).toContain("20 active listeners");

    expect(html).toContain("Surface Outcomes");
    expect(html).toContain("AI DJ");
    expect(html).toContain("Home · because_genre");
    expect(html).toContain("18.8%"); // Home click rate
    expect(html).toContain("30.0%"); // DJ skip rate
    expect(html).toContain("n/a"); // DJ has no click rate

    expect(html).toContain("Ranker Variant Comparison");
    expect(html).toContain("AI DJ · candidate (ranker_v2)");
    expect(html).toContain(">57<"); // candidate exposures only
    expect(html).toContain("21 / 18"); // variant impressions / plays
    expect(html).toContain("-5.0 pp");
    expect(html).toContain("+8.3 pp");
    expect(html).toContain("Descriptive differences only.");
    expect(html).not.toContain("Truncated");
  });

  it("renders empty states without fake metrics", () => {
    const html = render({
      surfaceBreakdown: [],
      variantExposure: [],
      comparison: { baselineVariant: "baseline", note: "n", rows: [] },
      resonantDiscoveries: { ...resonant, total: 0, distinctNewArtists: 0, perActiveListener: 0, activeListeners: 0, status: "no_data" },
    });

    expect(html).toContain("No discovery-surface events in this window.");
    expect(html).toContain("No variant comparison yet");
    expect(html).toContain("No active listeners in this window");
    expect(html).not.toContain("pp</");
  });

  it("says unavailable when sections are absent or the resonant source failed", () => {
    const absent = render({});
    expect(absent).toContain("Resonant discovery counts are unavailable");
    expect(absent).toContain("Per-surface discovery quality is unavailable");
    expect(absent).toContain("Variant comparison is unavailable");

    const failed = render({
      surfaceBreakdown: [homeRow],
      resonantDiscoveries: { ...resonant, status: "unavailable" },
    });
    expect(failed).toContain("Resonant discovery counts are unavailable");
    expect(failed).toContain("Home · because_genre");
  });

  it("flags truncated resonant counts and capped row lists", () => {
    const manyRows = Array.from({ length: DISCOVERY_ROW_LIMIT }, (_, index) => ({
      ...homeRow,
      surface: `home:rail_${index}`,
    }));
    const html = render({
      surfaceBreakdown: manyRows,
      comparison: {
        baselineVariant: "baseline",
        note: "n",
        rows: Array.from({ length: DISCOVERY_ROW_LIMIT }, (_, index) => ({
          ...comparisonRow,
          variant: `v${index}`,
        })),
      },
      resonantDiscoveries: { ...resonant, status: "truncated" },
    });

    expect(html).toContain("the read hit its cap");
    expect(html).toContain(`showing the first ${DISCOVERY_ROW_LIMIT} surfaces`);
    expect(html).toContain(`showing the first ${DISCOVERY_ROW_LIMIT} comparisons`);
    // Counts are still shown next to the warning.
    expect(html).toContain(">14<");
  });

  it("contains no listener identity fields", () => {
    const html = render({
      surfaceBreakdown: [homeRow],
      resonantDiscoveries: resonant,
    });
    expect(html).not.toMatch(/userId|actorId|wallet/i);
  });
});
