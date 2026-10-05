import {
  computeTasteDrift,
  listeningGenre,
  LISTENING_MIN_POSITIVE_SIGNALS,
  STALE_BOOST_MIN_AGE_DAYS,
  topLearned,
} from "../modules/recommendations/taste_drift";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-06T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

const profile = (overrides: Record<string, unknown> = {}) => ({
  positiveSignals: 10,
  genreWeights: { techno: 9, house: 5, ambient: 3, disco: 2, funk: 1.5, jazz: 0.2 } as Record<string, number>,
  moodWeights: { dark: 4, calm: 2 } as Record<string, number>,
  ...overrides,
});

const boost = (
  id: string,
  signalType: string,
  value: string,
  ageDays: number,
  action = "boosted",
) => ({ id, signalType, value, action, createdAt: daysAgo(ageDays) });

describe("topLearned", () => {
  it("keeps positive finite weights, highest first, ties by label", () => {
    expect(
      topLearned({ b: 2, a: 2, c: 5, neg: -1, zero: 0, nan: Number.NaN, inf: Infinity }, 10),
    ).toEqual(["c", "a", "b"]);
    expect(topLearned({ a: 1, b: 2, c: 3 }, 2)).toEqual(["c", "b"]);
    expect(topLearned(undefined, 3)).toEqual([]);
  });
});

describe("listeningGenre", () => {
  it("is null below the evidence floor", () => {
    expect(
      listeningGenre(profile({ positiveSignals: LISTENING_MIN_POSITIVE_SIGNALS - 1 }), []),
    ).toBeNull();
    expect(
      listeningGenre(profile({ positiveSignals: LISTENING_MIN_POSITIVE_SIGNALS }), []),
    ).toBe("techno");
    expect(listeningGenre(null, [])).toBeNull();
  });

  it("is null when the top learned genre is already declared", () => {
    expect(listeningGenre(profile(), ["techno"])).toBeNull();
  });

  it("compares case-insensitively and ignores padding", () => {
    expect(listeningGenre(profile(), ["  TECHNO "])).toBeNull();
    expect(listeningGenre(profile({ genreWeights: { Techno: 9 } }), ["techno"])).toBeNull();
  });

  it("returns the top genre when only other genres are declared", () => {
    expect(listeningGenre(profile(), ["jazz", "house"])).toBe("techno");
  });

  it("skips genres the listener asked for less of (declared over behavioral)", () => {
    expect(listeningGenre(profile(), [], ["Techno"])).toBe("house");
    expect(listeningGenre(profile(), ["house"], ["techno"])).toBeNull();
  });

  it("is null when nothing positive was learned", () => {
    expect(listeningGenre(profile({ genreWeights: { techno: -3 } }), [])).toBeNull();
  });
});

describe("computeTasteDrift", () => {
  it("is null below the evidence floor even with an old stale boost", () => {
    expect(
      computeTasteDrift({
        profile: profile({ positiveSignals: LISTENING_MIN_POSITIVE_SIGNALS - 1 }),
        controls: [boost("c1", "genre", "polka", 60)],
        now: NOW,
      }),
    ).toBeNull();
  });

  it("is null without any boost", () => {
    expect(computeTasteDrift({ profile: profile(), controls: [], now: NOW })).toBeNull();
  });

  it("treats a boost as stale from exactly 14 days, not at 13", () => {
    expect(STALE_BOOST_MIN_AGE_DAYS).toBe(14);
    expect(
      computeTasteDrift({
        profile: profile(),
        controls: [boost("c1", "genre", "polka", 13)],
        now: NOW,
      }),
    ).toBeNull();
    const drift = computeTasteDrift({
      profile: profile(),
      controls: [boost("c1", "genre", "polka", 14)],
      now: NOW,
    });
    expect(drift?.staleBoosts).toEqual([
      { controlId: "c1", signalType: "genre", value: "polka", boostedAt: daysAgo(14) },
    ]);
  });

  it("does not flag a boost that is still among the top 5 learned genres", () => {
    // funk is 5th, jazz is 6th.
    expect(
      computeTasteDrift({
        profile: profile(),
        controls: [boost("c1", "genre", "Funk", 90)],
        now: NOW,
      }),
    ).toBeNull();
    const drift = computeTasteDrift({
      profile: profile(),
      controls: [boost("c1", "genre", "jazz", 90)],
      now: NOW,
    });
    expect(drift?.staleBoosts.map((entry) => entry.controlId)).toEqual(["c1"]);
  });

  it("ignores non-boost actions and other signal types", () => {
    expect(
      computeTasteDrift({
        profile: profile(),
        controls: [
          boost("c1", "genre", "polka", 90, "hidden"),
          boost("c2", "genre", "polka", 90, "downranked"),
          boost("c3", "artist", "polka", 90),
        ],
        now: NOW,
      }),
    ).toBeNull();
  });

  it("excludes boosted values from the listening genres and keeps up to 3", () => {
    const drift = computeTasteDrift({
      profile: profile(),
      controls: [boost("c1", "genre", "polka", 30), boost("c2", "genre", "TECHNO", 30)],
      now: NOW,
    })!;
    expect(drift.staleBoosts.map((entry) => entry.controlId)).toEqual(["c1"]);
    expect(drift.listeningGenres).toEqual(["house", "ambient", "disco"]);
  });

  it("never suggests more of a genre or mood the listener downranked or hid", () => {
    const drift = computeTasteDrift({
      profile: profile(),
      controls: [
        boost("c1", "genre", "polka", 30),
        boost("d1", "genre", "techno", 1, "downranked"),
        boost("h1", "genre", "house", 1, "hidden"),
        boost("d2", "mood", "dark", 1, "downranked"),
      ],
      now: NOW,
    })!;
    expect(drift.listeningGenres).toEqual(["ambient", "disco", "funk"]);
    expect(drift.listeningMoods).toEqual(["calm"]);
  });

  it("covers moods separately from genres", () => {
    const drift = computeTasteDrift({
      profile: profile(),
      controls: [boost("m1", "mood", "euphoric", 20), boost("m2", "mood", "Dark", 20)],
      now: NOW,
    })!;
    expect(drift.staleBoosts).toEqual([
      { controlId: "m1", signalType: "mood", value: "euphoric", boostedAt: daysAgo(20) },
    ]);
    expect(drift.listeningMoods).toEqual(["calm"]);
    expect(drift.listeningGenres).toEqual(["techno", "house", "ambient"]);
  });

  it("reports a mood boost as stale only against learned moods", () => {
    expect(
      computeTasteDrift({
        profile: profile({ moodWeights: undefined }),
        controls: [boost("m1", "mood", "calm", 20)],
        now: NOW,
      })?.staleBoosts,
    ).toHaveLength(1);
  });
});
