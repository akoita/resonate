import { describe, expect, it } from "vitest";
import type { Track } from "../../lib/api";
import { tracksWithVocalsStem } from "./PunchlineDropsPanel";

// Minimal Track factory — only the fields the filter reads matter.
function makeTrack(
  id: string,
  stemTypes: string[],
): Track {
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
    })),
  } as Track;
}

describe("tracksWithVocalsStem (any source layer since #1476)", () => {
  it("keeps tracks that have any clippable stem or the full mix", () => {
    const tracks = [
      makeTrack("a", ["vocals", "drums"]),
      makeTrack("b", ["drums", "bass"]),
      makeTrack("e", ["unknown"]),
      makeTrack("c", ["VOCALS"]), // case-insensitive
      makeTrack("d", []),
    ];
    const result = tracksWithVocalsStem(tracks);
    expect(result.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list when no track has a clippable source", () => {
    expect(tracksWithVocalsStem([makeTrack("a", ["unknown"])])).toEqual([]);
  });

  it("handles tracks with no stems array", () => {
    const track = { ...makeTrack("a", []), stems: undefined } as Track;
    expect(tracksWithVocalsStem([track])).toEqual([]);
  });
});
