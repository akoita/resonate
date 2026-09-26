import { describe, expect, it } from "vitest";
import {
  REDDIT_TITLE_MAX_LENGTH,
  RELEASE_DESCRIPTION_MAX_LENGTH,
  X_MAX_LENGTH,
  hasMixerStems,
  listeningCampaignUrl,
  listeningShareMessage,
  listeningShareUrl,
  releaseShareDescription,
  xPostLength,
  xWeightedLength,
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

const forSaleTrack: ShareableTrack = { ...track, forSale: true };
const campaign = { title: "Felicia Farerre in Lisbon", url: "/shows/felicia-lisbon" };

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
    const { text } = listeningShareMessage(forSaleTrack, "x");
    const [head, hookLine, tags] = text.split("\n\n");
    expect(head).toBe('🎧 Now playing: "Love Will Find You" by Felicia Farerre');
    expect(hookLine).toContain("the artist keeps at least 85% of every sale");
    expect(tags).toBe("#NowPlaying #Resonate");
    expect(xPostLength(text)).toBeLessThanOrEqual(X_MAX_LENGTH);
  });

  it("makes no sale or support claim when nothing is for sale", () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      for (const hasStems of [false, true]) {
        for (const channel of CHANNELS) {
          const { title, text } = listeningShareMessage({ ...track, catalogTrackId: id, hasStems }, channel);
          const copy = `${title} ${text}`;
          expect(copy).not.toMatch(/85%|every sale|support/i);
        }
      }
    }
    expect(listeningShareMessage(track, "native").text).toBe(
      '🎧 Now playing: "Love Will Find You" by Felicia Farerre\n\nListen on Resonate.',
    );
    expect(listeningShareMessage({ ...track, hasStems: true }, "native").text).toBe(
      '🎧 Now playing: "Love Will Find You" by Felicia Farerre\n\nListen on Resonate, or pull it apart stem by stem in the mixer.',
    );
  });

  it("makes the 85% claim when the track is for sale", () => {
    for (const channel of ["x", "native", "reddit"] as ShareChannel[]) {
      const { title, text } = listeningShareMessage(forSaleTrack, channel);
      expect(`${title} ${text}`).toContain("85% of every sale");
    }
  });

  it("invites fans to back a live show campaign with an attributable link", () => {
    const withCampaign = { ...track, campaign };
    const native = listeningShareMessage(withCampaign, "native", { origin: ORIGIN });
    expect(native.text).toContain(
      `Back Felicia Farerre's show campaign "Felicia Farerre in Lisbon": ${ORIGIN}/shows/felicia-lisbon?utm_source=native&utm_medium=share&utm_campaign=listening_share`,
    );
    expect(native.text).not.toMatch(/85%/);

    const x = listeningShareMessage(withCampaign, "x", { origin: ORIGIN });
    expect(x.text).toContain(`${ORIGIN}/shows/felicia-lisbon?utm_source=x&utm_medium=social`);
    expect(x.text.endsWith("#NowPlaying #Resonate")).toBe(true);
    expect(xPostLength(x.text)).toBeLessThanOrEqual(X_MAX_LENGTH);

    // Without an origin a relative campaign path cannot be shared.
    expect(listeningShareMessage(withCampaign, "native").text).not.toContain("show campaign");
  });

  it("keeps campaign X posts within the limit for long titles, artists, and campaigns", () => {
    for (const hasStems of [false, true]) {
      for (const forSale of [false, true]) {
        for (const id of ["a", "b", "c", "d"]) {
          const { text } = listeningShareMessage(
            {
              ...track,
              catalogTrackId: id,
              title: long("Title"),
              artist: long("Artist"),
              hasStems,
              forSale,
              campaign: { title: long("Campaign"), url: `${ORIGIN}/shows/${"x".repeat(200)}` },
            },
            "x",
            { origin: ORIGIN },
          );
          expect(xPostLength(text)).toBeLessThanOrEqual(X_MAX_LENGTH);
          expect(text).toContain(`${ORIGIN}/shows/`);
        }
      }
    }
  });

  it("keeps X posts within the limit for 200-char title and artist", () => {
    for (const hasStems of [false, true]) {
      for (const id of ["a", "b", "c", "d"]) {
        const { text } = listeningShareMessage(
          { ...forSaleTrack, catalogTrackId: id, title: long("Title"), artist: long("Artist"), hasStems },
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
        '"Love Will Find You" — listen on Resonate',
      );
      expect(listeningShareMessage({ ...forSaleTrack, artist }, "reddit").title).toBe(
        '"Love Will Find You" — listen on Resonate (artists keep at least 85% of every sale)',
      );
    }
  });

  it("builds Reddit and native copy", () => {
    const reddit = listeningShareMessage(forSaleTrack, "reddit");
    expect(reddit.title).toBe(
      '"Love Will Find You" by Felicia Farerre — listen on Resonate (artists keep at least 85% of every sale)',
    );
    expect(listeningShareMessage(track, "reddit").title).toBe(
      '"Love Will Find You" by Felicia Farerre — listen on Resonate',
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
    const first = listeningShareMessage(forSaleTrack, "x").text;
    expect(listeningShareMessage(forSaleTrack, "x").text).toBe(first);
    const hooks = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map(
        (id) => listeningShareMessage({ ...forSaleTrack, catalogTrackId: id }, "x").text.split("\n\n")[1],
      ),
    );
    expect(hooks.size).toBeGreaterThan(1);
  });

  it("never makes claims outside the sanctioned set", () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      for (const hasStems of [false, true]) {
        for (const channel of CHANNELS) {
          const { title, text } = listeningShareMessage({ ...forSaleTrack, catalogTrackId: id, hasStems }, channel);
          const copy = `${title} ${text}`;
          expect(copy).not.toMatch(/\bfree\b|per (listen|stream)|royalt|yield|income|best|only platform/i);
          expect(copy.match(/\d+/g)?.filter((n) => n !== "85") ?? []).toEqual([]);
        }
      }
    }
  });
});

describe("listeningCampaignUrl", () => {
  it("absolutizes campaign paths with per-channel UTM attribution", () => {
    expect(listeningCampaignUrl(ORIGIN, "/shows/a", "x")).toBe(
      `${ORIGIN}/shows/a?utm_source=x&utm_medium=social&utm_campaign=listening_share`,
    );
    expect(listeningCampaignUrl(undefined, "https://other.test/shows/b", "copy")).toBe(
      "https://other.test/shows/b?utm_source=copy&utm_medium=share&utm_campaign=listening_share",
    );
    expect(listeningCampaignUrl(undefined, "/shows/a", "x")).toBeNull();
    expect(listeningCampaignUrl(ORIGIN, "javascript:alert(1)", "x")).toBeNull();
    expect(listeningCampaignUrl(ORIGIN, "  ", "x")).toBeNull();
  });
});

describe("xWeightedLength", () => {
  it("counts every link in the text as a t.co URL", () => {
    expect(xWeightedLength(`a https://example.test/${"x".repeat(100)} b`)).toBe(4 + 23);
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
      releaseShareDescription({ title: "Love Will Find You", artist: "Felicia Farerre", details: "single · soul", hasStems: true, forSale: true }),
    ).toBe(
      'Listen to "Love Will Find You" by Felicia Farerre on Resonate — single · soul. Stream it or remix the stems; the artist keeps at least 85% of every sale.',
    );
    expect(
      releaseShareDescription({ title: "Love Will Find You", artist: "Felicia Farerre", details: "single", hasStems: false, forSale: true }),
    ).toBe(
      'Listen to "Love Will Find You" by Felicia Farerre on Resonate — single. The artist keeps at least 85% of every sale.',
    );
  });

  it("makes the sale claim only when something is for sale", () => {
    expect(
      releaseShareDescription({ title: "Love Will Find You", artist: "Felicia Farerre", details: "single", hasStems: true }),
    ).toBe('Listen to "Love Will Find You" by Felicia Farerre on Resonate — single. Stream it or remix the stems.');
    expect(
      releaseShareDescription({ title: "Love Will Find You", artist: "Felicia Farerre", details: "single" }),
    ).toBe('Listen to "Love Will Find You" by Felicia Farerre on Resonate — single.');
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

    const allLong = releaseShareDescription({ title: long("T"), artist: long("A"), details: "single", hasStems: true, forSale: true });
    expect(allLong.length).toBeLessThanOrEqual(RELEASE_DESCRIPTION_MAX_LENGTH);
    expect(allLong).toContain("85% of every sale");
  });
});
