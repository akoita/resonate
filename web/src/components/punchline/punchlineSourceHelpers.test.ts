import { describe, expect, it } from "vitest";
import type { PunchlineEligibility, Track } from "../../lib/api";
import {
  availableMomentSources,
  clipBoundsForLayer,
  defaultSourceLayer,
  isMissingSourceReason,
  momentSourceOptions,
  sourceLayerForStemType,
  sourceLayerLabel,
  tracksWithMomentSource,
  setBonusSourceLayer,
} from "./punchlineSourceHelpers";

function makeTrack(id: string, stemTypes: string[]): Track {
  return {
    id,
    releaseId: "rel_1",
    title: `Track ${id}`,
    position: 1,
    explicit: false,
    createdAt: new Date().toISOString(),
    stems: stemTypes.map((type, i) => ({
      id: `${id}_stem_${i}`,
      trackId: id,
      type,
      uri: `local://${id}-${type}`,
      durationSeconds: 180,
    })),
  } as Track;
}

describe("punchline source helpers (#1476)", () => {
  it("maps the stored full-mix rows to the full layer", () => {
    expect(sourceLayerForStemType("original")).toBe("full");
    expect(sourceLayerForStemType("MASTER")).toBe("full");
    expect(sourceLayerForStemType("Drums")).toBe("drums");
    expect(sourceLayerForStemType("mystery")).toBeNull();
    expect(sourceLayerLabel("full")).toBe("Full mix");
  });

  it("lists sources vocals first and full mix last, one per layer", () => {
    const options = momentSourceOptions(
      makeTrack("a", ["original", "drums", "vocals", "vocals"]),
    );
    expect(options.map((o) => o.layer)).toEqual(["vocals", "drums", "full"]);
    expect(options[0].stemId).toBe("a_stem_2");
  });

  it("keeps tracks with any source, not only a vocals stem", () => {
    const tracks = [
      makeTrack("a", ["vocals"]),
      makeTrack("b", ["original"]),
      makeTrack("c", ["mystery"]),
      makeTrack("d", []),
    ];
    expect(tracksWithMomentSource(tracks).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("filters to what the server reports available, vocals-only for an old server", () => {
    const options = momentSourceOptions(makeTrack("a", ["vocals", "original"]));
    expect(
      availableMomentSources(options, { availableSourceLayers: ["full"] }).map(
        (o) => o.layer,
      ),
    ).toEqual(["full"]);
    expect(availableMomentSources(options, {}).map((o) => o.layer)).toEqual([
      "vocals",
    ]);
  });

  it("defaults to vocals, else the first source", () => {
    const withVocals = momentSourceOptions(makeTrack("a", ["original", "vocals"]));
    expect(defaultSourceLayer(withVocals)).toBe("vocals");
    const instrumental = momentSourceOptions(makeTrack("b", ["original", "piano"]));
    expect(defaultSourceLayer(instrumental)).toBe("piano");
    expect(defaultSourceLayer([])).toBeNull();
  });

  it("reads per-layer bounds and falls back to the stem bounds", () => {
    const eligibility = {
      clipBoundsMs: { minMs: 2000, maxMs: 15000 },
      clipBoundsMsByLayer: { full: { minMs: 2000, maxMs: 10000 } },
    } as Pick<PunchlineEligibility, "clipBoundsMs" | "clipBoundsMsByLayer">;
    expect(clipBoundsForLayer(eligibility, "full").maxMs).toBe(10000);
    expect(clipBoundsForLayer(eligibility, "drums").maxMs).toBe(15000);
  });

  it("treats the old and new missing-source codes the same", () => {
    expect(isMissingSourceReason("no_source_stem")).toBe(true);
    expect(isMissingSourceReason("no_vocals_stem")).toBe(true);
    expect(isMissingSourceReason("content_removed")).toBe(false);
  });
});

describe("setBonusSourceLayer (#2522)", () => {
  it("mirrors the backend rule: majority, then vocals, then earliest", () => {
    expect(setBonusSourceLayer(["full", "full", "drums"])).toBe("full");
    expect(setBonusSourceLayer(["drums", "vocals"])).toBe("vocals");
    expect(setBonusSourceLayer(["drums", "full"])).toBe("drums");
    expect(setBonusSourceLayer([])).toBe("vocals");
  });
});
