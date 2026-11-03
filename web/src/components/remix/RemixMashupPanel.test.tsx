import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RemixMashupPanel,
  candidateRightsText,
  mashupFromDraft,
} from "./RemixMashupPanel";
import type { RemixProjectSource } from "../../lib/api";

const noop = () => undefined;
const secondary: RemixProjectSource = {
  trackId: "B",
  trackTitle: "Low Tide",
  releaseId: "rel-b",
  releaseTitle: "Low Tide EP",
  artistName: "Artist B",
  rightsRoute: "STANDARD_ESCROW",
  contentStatus: "clean",
};
const base = {
  leadTitle: "Night Drive",
  leadBpm: 120,
  leadKey: { tonic: "A", mode: "minor" as const },
  secondary: null,
  secondaryBpm: null,
  secondaryKey: null,
  saved: null,
  skipped: null,
  secondaryExportBlocked: false,
  maxOffsetBars: 33,
  loadCandidates: async () => [],
  onAttach: noop,
  onRemove: noop,
  onSave: noop,
};

describe("RemixMashupPanel (#2560)", () => {
  it("offers a second track while the draft has one source", () => {
    const html = renderToStaticMarkup(<RemixMashupPanel {...base} />);
    expect(html).toContain('aria-label="Mashup"');
    expect(html).toContain("Add a second track");
    expect(html).toContain("“Night Drive”");
  });

  it("shows B's controls, the suggestions and the export note once B is attached", () => {
    const html = renderToStaticMarkup(
      <RemixMashupPanel
        {...base}
        secondary={secondary}
        secondaryBpm={100}
        secondaryKey={{ tonic: "G", mode: "minor" }}
        saved={{
          schemaVersion: "remix-mashup/v1",
          secondary: { tempoRatio: 1, semitones: 0, offsetBars: 4 },
        }}
        secondaryExportBlocked
      />,
    );
    expect(html).toContain("Track B “Low Tide” by Artist B");
    expect(html).toContain("Remove track B");
    expect(html).toContain("B 100 BPM → 100 BPM (A is 120 BPM)");
    expect(html).toContain("Match tempo (1.2)");
    expect(html).toContain("A is A minor, B is G minor");
    expect(html).toContain("Suggested: +2");
    expect(html).toContain('value="4"');
    expect(html).toContain("(0–32)");
    expect(html).toContain("Track B needs a commercial license to export.");
    // Nothing changed yet: Apply waits.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Apply/);
  });

  it("says when the two tempos are too far apart, and when B plays as it is", () => {
    const html = renderToStaticMarkup(
      <RemixMashupPanel
        {...base}
        leadBpm={100}
        secondary={secondary}
        secondaryBpm={145}
        saved={{
          schemaVersion: "remix-mashup/v1",
          secondary: { tempoRatio: 0.75, semitones: 0, offsetBars: 0 },
        }}
        skipped="no_lead_grid"
      />,
    );
    expect(html).toContain("too far apart in tempo to match");
    expect(html).not.toContain("Match tempo");
    expect(html).toContain("Track A has no bar grid");
  });

  it("reads a draft into the recipe, refusing out-of-range values", () => {
    expect(
      mashupFromDraft({ tempoRatio: "1.2", semitones: -2, offsetBars: "4", firstBeatSec: "" }),
    ).toEqual({
      schemaVersion: "remix-mashup/v1",
      secondary: { tempoRatio: 1.2, semitones: -2, offsetBars: 4 },
    });
    expect(
      mashupFromDraft({ tempoRatio: "1", semitones: 0, offsetBars: "0", firstBeatSec: "0.25" })
        ?.secondary.firstBeatSec,
    ).toBe(0.25);
    expect(mashupFromDraft({ tempoRatio: "1.5", semitones: 0, offsetBars: "0", firstBeatSec: "" })).toBeNull();
    expect(mashupFromDraft({ tempoRatio: "1", semitones: 0, offsetBars: "1.5", firstBeatSec: "" })).toBeNull();
    expect(mashupFromDraft({ tempoRatio: "1", semitones: 0, offsetBars: "0", firstBeatSec: "500" })).toBeNull();
  });

  it("states what a candidate track allows", () => {
    expect(candidateRightsText({ allowedActions: ["private_draft", "publish_resonate", "export"] })).toBe(
      "Draft, release and export",
    );
    expect(candidateRightsText({ allowedActions: ["private_draft", "publish_resonate"] })).toContain(
      "export needs a commercial license",
    );
    expect(candidateRightsText({ allowedActions: ["private_draft"] })).toBe("Private draft only");
  });
});
