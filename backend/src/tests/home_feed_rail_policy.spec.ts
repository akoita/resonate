/**
 * Home feed rails pass the shared policy stage (#1456, ADR-TE-2,
 * docs/rfc/taste-engine.md §3.4) — pure unit tests of `applyRailPolicy`.
 *
 * The ranked `because_genre` rail already ran the policy inside
 * `getRecommendations`; these cover the rails composed outside it
 * (new from artists you play, trending, fresh drops, catalog signal).
 */
import { DISCOVERY_EXPLANATIONS } from "../modules/recommendations/discovery-explanations";
import {
  applyRailPolicy,
  type RawItem,
} from "../modules/recommendations/home-feed.service";
import type { TasteMemoryPolicy } from "../modules/recommendations/taste_memory.service";
import type { AiDisclosureRecord } from "../modules/catalog/ai-disclosure.policy";

function disclosure(level: string): AiDisclosureRecord {
  return { level, containsAI: null, facets: [], label: level } as unknown as AiDisclosureRecord;
}

function item(id: string, extra: Partial<RawItem> = {}): RawItem {
  return {
    id,
    title: `Title ${id}`,
    artist: `Artist of ${id}`,
    artistId: `artist-${id}`,
    releaseId: `release-${id}`,
    releaseTitle: `Release ${id}`,
    genre: "house",
    moods: [],
    aiDisclosure: disclosure("none"),
    reasons: ["artist:followed-by-plays"],
    ...extra,
  };
}

function tastePolicy(hidden: Record<string, string[]>): TasteMemoryPolicy {
  return {
    settings: {
      socialMatchingEnabled: false,
      citySceneDiscoveryEnabled: false,
      agentPlaybackTrainingEnabled: true,
      recommendationExplanationPreference: "balanced",
      resetAt: null,
    },
    hidden: new Map(
      Object.entries(hidden).map(([type, values]) => [
        type,
        new Set(values.map((value) => value.toLowerCase())),
      ]),
    ) as TasteMemoryPolicy["hidden"],
    downranked: new Map() as TasteMemoryPolicy["downranked"],
    boosted: new Map() as TasteMemoryPolicy["boosted"],
  };
}

const ids = (items: Array<{ id: string }>) => items.map((entry) => entry.id);

describe("Home feed rails pass the policy stage (#1456)", () => {
  it("removes items the listener hid by artist, genre or mood (rule 1)", () => {
    const result = applyRailPolicy(
      "new_from_artists",
      [
        item("keep"),
        item("hidden-artist-id", { artistId: "artist-muted" }),
        item("hidden-artist-name", { artist: "Muted Band" }),
        item("hidden-genre", { genre: "Polka" }),
        item("hidden-mood", { moods: ["Dark"] }),
      ],
      new Set(),
      tastePolicy({
        artist: ["artist-muted", "Muted Band"],
        genre: ["polka"],
        mood: ["dark"],
      }),
    );
    expect(ids(result)).toEqual(["keep"]);
  });

  it("removes fully AI-generated tracks (rule 2)", () => {
    const result = applyRailPolicy(
      "trending_genre",
      [
        item("human", { aiDisclosure: disclosure("none") }),
        item("partly", { aiDisclosure: disclosure("partly") }),
        item("all-ai", { aiDisclosure: disclosure("all") }),
      ],
      new Set(),
      undefined,
    );
    expect(ids(result)).toEqual(["human", "partly"]);
  });

  it("keeps the rail order and caps each artist at two (rule 4)", () => {
    const result = applyRailPolicy(
      "exploration",
      [
        // The cap counts the credited artist (#2092), not the uploading profile.
        item("a1", { artistId: "same", artist: "Same Artist" }),
        item("b1"),
        item("a2", { artistId: "other-profile", artist: "Same Artist" }),
        item("a3", { artistId: "same", artist: "same artist" }),
        item("c1"),
      ],
      new Set(),
      undefined,
    );
    expect(ids(result)).toEqual(["a1", "b1", "a2", "c1"]);
  });

  it("gives every item a vocabulary reason and never a discovery label (rule 5)", () => {
    const artists = applyRailPolicy("new_from_artists", [item("x")], new Set(), undefined);
    const trending = applyRailPolicy("trending_genre", [item("y")], new Set(), undefined);
    expect(artists[0].reasonCode).toBe("listening_pattern");
    expect(artists[0].explanations).toEqual([DISCOVERY_EXPLANATIONS.listening_pattern]);
    expect(trending[0].reasonCode).toBe("catalog");
    expect(trending[0].explanations).toEqual([DISCOVERY_EXPLANATIONS.catalog]);
  });

  it("keeps the ranking core's reason on ranked items", () => {
    const [ranked] = applyRailPolicy(
      "because_genre",
      [
        item("ranked", {
          reasonCode: "learned_taste",
          explanations: [DISCOVERY_EXPLANATIONS.learned_taste],
        }),
      ],
      new Set(),
      undefined,
    );
    expect(ranked.reasonCode).toBe("learned_taste");
    expect(ranked.explanations).toEqual([DISCOVERY_EXPLANATIONS.learned_taste]);
  });

  it("dedupes across rails and fills the rail after drops", () => {
    const used = new Set(["taken"]);
    const result = applyRailPolicy(
      "catalog_signal",
      [item("taken"), item("all-ai", { aiDisclosure: disclosure("all") }), item("a"), item("b"), item("c")],
      used,
      undefined,
      2,
    );
    expect(ids(result)).toEqual(["a", "b"]);
    expect([...used].sort()).toEqual(["a", "b", "taken"]);
  });
});
