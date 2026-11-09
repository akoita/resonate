import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PayoutSplitView } from "./PayoutSplitPreview";
import { artistNetUsd, formatSplitUsd, parseStemSaleSplit } from "../../lib/stemSaleSplit";

const serverSplit = {
  minArtistBps: 8500,
  tiers: {
    personal: { platformFeeBps: 1500, artistBps: 8500 },
    remix: { platformFeeBps: 1000, artistBps: 9000 },
    commercial: { platformFeeBps: 1000, artistBps: 9000 },
  },
};
const prices = { personal: 0.05, remix: 5, commercial: 25 };

describe("PayoutSplitView (#2599)", () => {
  it("shows what the artist keeps per licence tier from the server split", () => {
    const html = renderToStaticMarkup(
      <PayoutSplitView prices={prices} state={{ status: "ready", split: parseStemSaleSplit(serverSplit)! }} />,
    );
    expect(html).toContain("You keep 85%");
    expect(html).toContain("You keep 90%");
    expect(html).toContain("$4.50 of $5.00 · platform fee 10%");
    expect(html).toContain("$22.50 of $25.00 · platform fee 10%");
    expect(html).toContain("$0.0425 of $0.05 · platform fee 15%");
    expect(html).toContain("at least 85%");
  });

  it("never shows the old hardcoded split or a remixer slice", () => {
    const html = renderToStaticMarkup(
      <PayoutSplitView prices={prices} state={{ status: "ready", split: parseStemSaleSplit(serverSplit)! }} />,
    );
    expect(html).not.toContain("70%");
    expect(html).not.toContain("20%");
    expect(html).not.toMatch(/Mixer|Remixer/);
  });

  it("shows no numbers while loading or when the split cannot be loaded", () => {
    for (const status of ["loading", "error"] as const) {
      const html = renderToStaticMarkup(<PayoutSplitView prices={prices} state={{ status }} />);
      expect(html).not.toMatch(/\d+%/);
      expect(html).not.toContain("$");
    }
    expect(renderToStaticMarkup(<PayoutSplitView prices={prices} state={{ status: "error" }} />))
      .toContain("no numbers are shown");
  });
});

describe("parseStemSaleSplit (#2599)", () => {
  it("accepts a split that adds up and respects the floor", () => {
    expect(parseStemSaleSplit(serverSplit)).toEqual(serverSplit);
  });

  it("rejects an artist share under the floor (ADR-BM-4)", () => {
    expect(
      parseStemSaleSplit({
        ...serverSplit,
        tiers: { ...serverSplit.tiers, remix: { platformFeeBps: 3000, artistBps: 7000 } },
      }),
    ).toBeNull();
  });

  it("rejects shares that do not add up to the whole price, and malformed answers", () => {
    expect(
      parseStemSaleSplit({
        ...serverSplit,
        tiers: { ...serverSplit.tiers, personal: { platformFeeBps: 1000, artistBps: 8500 } },
      }),
    ).toBeNull();
    expect(parseStemSaleSplit({ minArtistBps: 8500, tiers: { personal: serverSplit.tiers.personal } })).toBeNull();
    expect(parseStemSaleSplit(null)).toBeNull();
    expect(parseStemSaleSplit({})).toBeNull();
  });
});

describe("artistNetUsd (#2599)", () => {
  it("rounds down, never up, and gives nothing for a free or invalid price", () => {
    expect(artistNetUsd(5, 9000)).toBe(4.5);
    expect(artistNetUsd(0.05, 8500)).toBe(0.0425);
    expect(artistNetUsd(0.01, 8500)).toBe(0.0085);
    expect(formatSplitUsd(4.5)).toBe("$4.50");
    expect(formatSplitUsd(0.0425)).toBe("$0.0425");
    expect(formatSplitUsd(0.085)).toBe("$0.085");
    expect(artistNetUsd(0, 9000)).toBeNull();
    expect(artistNetUsd(Number.NaN, 9000)).toBeNull();
  });
});
