import { describe, expect, it } from "vitest";
import {
  REDDIT_TITLE_MAX_LENGTH,
  RELEASE_DESCRIPTION_MAX_LENGTH,
  X_MAX_LENGTH,
  hasMixerStems,
  listeningShareMessage,
  listeningShareUrl,
  releaseShareDescription,
  xPostLength,
  type ShareChannel,
  type ShareableTrack,
} from "./listeningShare";

const ORIGIN = "https://music.example.test";

const track: ShareableTrack = {
  title: "Love Will Find You",
  artist: "Felicia Farerre",
  releaseId: "rel_123",
  catalogTrackId: "trk_456",
  trackId: "trk_456",
  hasStems: false,
};

const CHANNELS: ShareChannel[] = ["x", "facebook", "reddit", "native", "copy"];
const long = (seed: string) => `${seed} `.repeat(40).slice(0, 200);

describe("listeningShareUrl", () => {
  it("returns null for tracks without a public release page", () => {
    for (const channel of CHANNELS) {
      expect(listeningShareUrl(ORIGIN, { ...track, releaseId: null }, channel)).toBeNull();
      expect(listeningShareUrl(ORIGIN, { title: "Local file" }, channel)).toBeNull();
      expect(listeningShareUrl(ORIGIN, { ...track, releaseId: "  " }, channel)).toBeNull();
    }
  });

  it("deep-links the release page with per-channel UTM attribution", () => {
    expect(listeningShareUrl(`${ORIGIN}/`, track, "x")).toBe(
      `${ORIGIN}/release/rel_123?utm_source=x&utm_medium=social&utm_campaign=listening_share`,
    );
    expect(listeningShareUrl(ORIGIN, track, "facebook")).toContain("utm_source=facebook&utm_medium=social");
    expect(listeningShareUrl(ORIGIN, track, "reddit")).toContain("utm_source=reddit&utm_medium=social");
    expect(listeningShareUrl(ORIGIN, track, "copy")).toContain("utm_source=copy&utm_medium=share");
    expect(listeningShareUrl(ORIGIN, track, "native")).toContain("utm_source=native&utm_medium=share");
  });

  it("encodes the release id", () => {
    expect(listeningShareUrl(ORIGIN, { ...track, releaseId: "a/b" }, "copy")).toMatch(
      /^https:\/\/music\.example\.test\/release\/a%2Fb\?/,
    );
  });
});

describe("listeningShareMessage", () => {
  it("builds the X post with headline, one hook, and hashtags", () => {
    const { text } = listeningShareMessage(track, "x");
    const [head, hookLine, tags] = text.split("\n\n");
    expect(head).toBe('🎧 Now playing: "Love Will Find You" by Felicia Farerre');
    expect(hookLine).toContain("the artist keeps at least 85% of every sale");
    expect(tags).toBe("#NowPlaying #Resonate");
    expect(xPostLength(text)).toBeLessThanOrEqual(X_MAX_LENGTH);
  });

  it("keeps X posts within the limit for 200-char title and artist", () => {
    for (const hasStems of [false, true]) {
      for (const id of ["a", "b", "c", "d"]) {
        const { text } = listeningShareMessage(
          { ...track, catalogTrackId: id, title: long("Title"), artist: long("Artist"), hasStems },
          "x",
        );
        expect(xPostLength(text)).toBeLessThanOrEqual(X_MAX_LENGTH);
        expect(text).toContain("…");
        expect(text).toContain("85% of every sale");
        expect(text.endsWith("#NowPlaying #Resonate")).toBe(true);
      }
    }
  });

  it("mentions stems and the mixer only when the track has mixer stems", () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      for (const channel of CHANNELS) {
        const plain = listeningShareMessage({ ...track, catalogTrackId: id, hasStems: false }, channel);
        expect(`${plain.title} ${plain.text}`).not.toMatch(/stem|mixer/i);
      }
      const stems = listeningShareMessage({ ...track, catalogTrackId: id, hasStems: true }, "x");
      expect(stems.text).toMatch(/stem by stem/);
    }
  });

  it("omits the artist gracefully", () => {
    for (const artist of [null, "", "  ", "Unknown"]) {
      const x = listeningShareMessage({ ...track, artist }, "x");
      expect(x.text.startsWith('🎧 Now playing: "Love Will Find You"\n\n')).toBe(true);
      expect(x.text).not.toMatch(/ by |Unknown|undefined|null/);
      expect(listeningShareMessage({ ...track, artist }, "native").title).toBe('"Love Will Find You" on Resonate');
      expect(listeningShareMessage({ ...track, artist }, "reddit").title).toBe(
        '"Love Will Find You" — listen on Resonate (artists keep at least 85% of every sale)',
      );
    }
  });

  it("builds Reddit and native copy", () => {
    const reddit = listeningShareMessage(track, "reddit");
    expect(reddit.title).toBe(
      '"Love Will Find You" by Felicia Farerre — listen on Resonate (artists keep at least 85% of every sale)',
    );
    expect(reddit.title).not.toContain("\n");
    const longReddit = listeningShareMessage({ ...track, title: long("T"), artist: long("A") }, "reddit");
    expect(longReddit.title.length).toBeLessThanOrEqual(REDDIT_TITLE_MAX_LENGTH);

    const native = listeningShareMessage(track, "native");
    expect(native.title).toBe('"Love Will Find You" by Felicia Farerre on Resonate');
    expect(native.text).not.toContain("#");
    expect(listeningShareMessage(track, "x").text.startsWith(native.text)).toBe(true);
  });

  it("picks the hook deterministically from the track id", () => {
    const first = listeningShareMessage(track, "x").text;
    expect(listeningShareMessage(track, "x").text).toBe(first);
    const hooks = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map(
        (id) => listeningShareMessage({ ...track, catalogTrackId: id }, "x").text.split("\n\n")[1],
      ),
    );
    expect(hooks.size).toBeGreaterThan(1);
  });

  it("never makes claims outside the sanctioned set", () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      for (const hasStems of [false, true]) {
        for (const channel of CHANNELS) {
          const { title, text } = listeningShareMessage({ ...track, catalogTrackId: id, hasStems }, channel);
          const copy = `${title} ${text}`;
          expect(copy).not.toMatch(/\bfree\b|per (listen|stream)|royalt|best|only platform/i);
          expect(copy.match(/\d+/g)?.filter((n) => n !== "85") ?? []).toEqual([]);
        }
      }
    }
  });
});

describe("hasMixerStems", () => {
  it("ignores original and master renditions", () => {
    expect(hasMixerStems(undefined)).toBe(false);
    expect(hasMixerStems([{ type: "ORIGINAL" }, { type: "master" }])).toBe(false);
    expect(hasMixerStems([{ type: "original" }, { type: "vocals" }])).toBe(true);
  });
});

describe("releaseShareDescription", () => {
  it("adds the remix clause only for releases with mixer stems", () => {
    expect(
      releaseShareDescription({ title: "Love Will Find You", artist: "Felicia Farerre", details: "single · soul", hasStems: true }),
    ).toBe(
      'Listen to "Love Will Find You" by Felicia Farerre on Resonate — single · soul. Stream it or remix the stems; the artist keeps at least 85% of every sale.',
    );
    expect(
      releaseShareDescription({ title: "Love Will Find You", artist: "Felicia Farerre", details: "single", hasStems: false }),
    ).toBe(
      'Listen to "Love Will Find You" by Felicia Farerre on Resonate — single. The artist keeps at least 85% of every sale.',
    );
  });

  it("drops details before shortening the title to stay within budget", () => {
    const withLongDetails = releaseShareDescription({
      title: "Love Will Find You",
      artist: "Felicia Farerre",
      details: long("detail"),
      hasStems: true,
    });
    expect(withLongDetails).toContain('"Love Will Find You" by Felicia Farerre on Resonate.');
    expect(withLongDetails.length).toBeLessThanOrEqual(RELEASE_DESCRIPTION_MAX_LENGTH);

    const allLong = releaseShareDescription({ title: long("T"), artist: long("A"), details: "single", hasStems: true });
    expect(allLong.length).toBeLessThanOrEqual(RELEASE_DESCRIPTION_MAX_LENGTH);
    expect(allLong).toContain("85% of every sale");
  });
});
