/**
 * Home v3 Stem Lab — real mixer stems only: filtering, dedupe, channel order,
 * per-channel solo links, and nothing rendered when no release qualifies.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MIXER_STEM_ORDER, StemLab, selectStemLabEntries, stemMeterBars } from "./StemLab";
import type { Release, Track } from "../../lib/api";

type Stem = NonNullable<Track["stems"]>[number];

function stem(id: string, type: string): Stem {
  return { id, trackId: "trk", type, uri: `/stems/${id}` };
}

function track(id: string, stems: Stem[]): Track {
  return {
    id,
    releaseId: "rel",
    title: `Track ${id}`,
    position: 1,
    explicit: false,
    createdAt: "2026-09-01T00:00:00Z",
    stems,
  };
}

function release(id: string, tracks: Track[], overrides: Partial<Release> = {}): Release {
  return {
    id,
    artistId: "art_1",
    title: `Release ${id}`,
    status: "ready",
    type: "SINGLE",
    explicit: false,
    createdAt: "2026-09-01T00:00:00Z",
    primaryArtist: "Stem Artist",
    tracks,
    ...overrides,
  };
}

const renderArt = (r: Release) => <span className="art">{r.id}</span>;

describe("selectStemLabEntries", () => {
  it("keeps only real mixer stem types, dedupes them, and sorts by channel order", () => {
    const entries = selectStemLabEntries(
      [
        release("rel_1", [
          track("trk_1", [
            stem("s_master", "master"),
            stem("s_drums", "Drums"),
            stem("s_original", "original"),
            stem("s_vocals", "vocals"),
            stem("s_drums_2", "drums"),
            stem("s_synth", "synth"),
            stem("s_bass", " BASS "),
          ]),
        ]),
      ],
      3,
      renderArt,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].releaseId).toBe("rel_1");
    expect(entries[0].trackId).toBe("trk_1");
    expect(entries[0].artist).toBe("Stem Artist");
    // First stem of a type wins; order follows the mixer channel strip.
    expect(entries[0].stems).toEqual([
      { id: "s_vocals", type: "vocals" },
      { id: "s_drums", type: "drums" },
      { id: "s_bass", type: "bass" },
    ]);
  });

  it("takes the first track per release with at least two mixer stems", () => {
    const entries = selectStemLabEntries(
      [
        release("rel_1", [
          track("trk_single", [stem("a", "vocals")]),
          track("trk_pair", [stem("b", "piano"), stem("c", "guitar")]),
          track("trk_later", [stem("d", "vocals"), stem("e", "drums")]),
        ]),
      ],
      3,
      renderArt,
    );
    expect(entries.map((entry) => entry.trackId)).toEqual(["trk_pair"]);
  });

  it("walks releases in order and stops at the limit", () => {
    const pair = (prefix: string) => [stem(`${prefix}_v`, "vocals"), stem(`${prefix}_d`, "drums")];
    const entries = selectStemLabEntries(
      [
        release("rel_a", [track("a", pair("a"))]),
        release("rel_skip", [track("s", [stem("only", "other")])]),
        release("rel_b", [track("b", pair("b"))]),
        release("rel_c", [track("c", pair("c"))]),
      ],
      2,
      renderArt,
    );
    expect(entries.map((entry) => entry.releaseId)).toEqual(["rel_a", "rel_b"]);
  });

  it("returns [] when no release has real mixer stems", () => {
    expect(
      selectStemLabEntries(
        [
          release("rel_1", [track("t", [stem("m", "master"), stem("o", "original")])]),
          release("rel_2", [], {}),
          release("rel_3", [track("u", [])]),
        ],
        3,
        renderArt,
      ),
    ).toEqual([]);
  });

  it("covers exactly the release mixer channels", () => {
    expect([...MIXER_STEM_ORDER]).toEqual(["vocals", "drums", "bass", "piano", "guitar", "other"]);
  });
});

describe("stemMeterBars", () => {
  it("is deterministic and shaped per stem type", () => {
    expect(stemMeterBars("stem-1", "drums")).toEqual(stemMeterBars("stem-1", "drums"));
    const drums = stemMeterBars("stem-1", "drums");
    expect(drums).toHaveLength(12);
    // On-beat kicks tower over the ghost notes between them.
    expect(drums[0]).toBeGreaterThan(drums[1]);
    expect(drums[4]).toBeGreaterThan(drums[3]);
    for (const height of stemMeterBars("stem-2", "vocals")) {
      expect(height).toBeGreaterThanOrEqual(12);
      expect(height).toBeLessThanOrEqual(100);
    }
  });
});

describe("StemLab", () => {
  it("renders nothing when there are no entries", () => {
    expect(renderToStaticMarkup(<StemLab entries={[]} />)).toBe("");
  });

  it("renders a channel strip whose links solo each real stem in the mixer", () => {
    const entries = selectStemLabEntries(
      [release("rel_1", [track("trk_1", [stem("s_d", "drums"), stem("s_v", "vocals")])])],
      3,
      renderArt,
    );
    const html = renderToStaticMarkup(<StemLab entries={entries} />);
    expect(html).toContain("Stem Lab");
    expect(html).toContain("Pull a song apart");
    expect(html).toContain('data-testid="stem-lab"');
    expect(html).toContain('href="/release/rel_1?mixer=true&amp;stem=vocals"');
    expect(html).toContain('href="/release/rel_1?mixer=true&amp;stem=drums"');
    expect(html).toContain('aria-label="Solo Vocals of Release rel_1 in the mixer"');
    expect(html).toContain('data-stem="vocals"');
    expect(html).toContain(">Vocals<");
    expect(html).toContain(">Drums<");
    expect(html).toContain("2 stems");
    expect(html).toContain("Open mixer");
    expect(html).toContain('href="/catalog"');
    // Vocals precede drums on the channel strip.
    expect(html.indexOf('data-stem="vocals"')).toBeLessThan(html.indexOf('data-stem="drums"'));
  });
});
