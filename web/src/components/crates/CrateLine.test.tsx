import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CrateLine, type CrateLineProps } from "./CrateLine";
import type { CrateItemDto } from "../../lib/crates";

function item(overrides: Partial<CrateItemDto> = {}): CrateItemDto {
  return {
    position: 0,
    locked: false,
    trackId: "t1",
    title: "Night Drive",
    artistId: "a1",
    artistName: "Nova",
    available: true,
    tempoBpm: 124,
    camelot: "8A",
    energy: 0.72,
    stemTypes: ["vocals", "drums"],
    listedLicenseTypes: ["remix", "commercial"],
    indicativePriceUsd: { remix: 12.5 },
    linePriceUsd: 12.5,
    verifiedHuman: true,
    aiDisclosureLevel: "NONE",
    transitionToNext: null,
    originalStemId: "s1",
    stems: [
      { type: "vocals", qualityScore: 82 },
      { type: "drums", qualityScore: null },
    ],
    licenseOptions: [
      {
        licenseType: "remix",
        listed: true,
        indicativePriceUsd: 12.5,
        standardTerms: true,
        grants: ["Use in a remix you release", "Credit the original artist"],
      },
      {
        licenseType: "commercial",
        listed: true,
        indicativePriceUsd: null,
        standardTerms: false,
        grants: [],
      },
      {
        licenseType: "sync",
        listed: false,
        indicativePriceUsd: null,
        standardTerms: true,
        grants: ["Use in video"],
      },
    ],
    ...overrides,
  };
}

function render(overrides: Partial<CrateLineProps> = {}) {
  return renderToStaticMarkup(
    <ol>
      <CrateLine
        item={item()}
        index={0}
        canMoveUp={false}
        canMoveDown
        onMove={vi.fn()}
        onToggleLock={vi.fn()}
        onSwap={vi.fn()}
        onRemove={vi.fn()}
        {...overrides}
      />
    </ol>,
  );
}

describe("CrateLine", () => {
  it("shows tempo, key, energy and stems with quality", () => {
    const html = render();
    expect(html).toContain("124 BPM");
    expect(html).toContain("Key 8A");
    expect(html).toContain("Energy 72%");
    expect(html).toContain("Vocals");
    expect(html).toContain("quality 82/100");
    expect(html).toContain("quality not scored");
  });

  it("lists what each license grants and the indicative price note", () => {
    const html = render();
    expect(html).toContain("Use in a remix you release");
    expect(html).toContain("Credit the original artist");
    expect(html).toContain("about $12.50");
    expect(html).toContain("Not listed");
    expect(html).toContain("Price is indicative; the quote sets the final price");
  });

  it("says when a license has no standard terms", () => {
    const html = render();
    expect(html).toContain("No standard terms yet");
    expect(html).toContain("check the listing before buying");
  });

  it("marks an unavailable line", () => {
    const html = render({ item: item({ available: false }) });
    expect(html).toContain("Unavailable");
    expect(html).toContain("crates-line--unavailable");
    expect(html).toContain("no longer available");
  });

  it("labels the move, lock, swap and remove buttons for assistive tech", () => {
    const html = render();
    expect(html).toContain('aria-label="Move &quot;Night Drive&quot; up"');
    expect(html).toContain('aria-label="Move &quot;Night Drive&quot; down"');
    expect(html).toContain('aria-label="Lock &quot;Night Drive&quot; in place"');
    expect(html).toContain('aria-label="Swap &quot;Night Drive&quot; for a similar track"');
    expect(html).toContain('aria-label="Remove &quot;Night Drive&quot; from the crate"');
  });

  it("disables unavailable moves and reflects the lock state", () => {
    const html = render({ item: item({ locked: true }) });
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Unlock &quot;Night Drive&quot;"');
    expect(html).toContain("crates-line--locked");
    // Move up is disabled on the first line.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Move &quot;Night Drive&quot; up"/);
  });

  it("offers a transition preview only when one is available", () => {
    const facts = { harmonic: "same" as const, bpmDelta: 2, energyDelta: 0.1 };
    const without = render({ nextTitle: "Next One", transition: facts });
    expect(without).toContain("Into &quot;Next One&quot;: Same key, +2 BPM, energy +10%");
    expect(without).not.toContain("Preview transition");

    const withPreview = render({ nextTitle: "Next One", transition: facts, previewState: "idle" });
    expect(withPreview).toContain("Preview transition");
    expect(withPreview).toContain("Preview the transition from");

    const playing = render({ nextTitle: "Next One", transition: facts, previewState: "playing" });
    expect(playing).toContain("Stop preview");
  });
});
