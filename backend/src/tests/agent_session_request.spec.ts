import { defaultCrateFilters } from "../modules/crates/crate_filters";
import type { CrateFilters, CrateParseResult } from "../modules/crates/crate.types";
import {
  computeRequestCoverage,
  describeCoverageGaps,
  describeTempoRange,
  hasRequestFilters,
  listeningRequestFromCrateParse,
  requestRankingPreferences,
  sanitizeSessionRequest,
  type AgentSessionRequest,
} from "../modules/agents/agent_session_request";

function parsed(filters: Partial<CrateFilters>, extra: Partial<CrateParseResult> = {}): CrateParseResult {
  return {
    filters: { ...defaultCrateFilters(), ...filters },
    unparsed: [],
    strategy: "deterministic",
    ...extra,
  };
}

function request(overrides: Partial<AgentSessionRequest> = {}): AgentSessionRequest {
  return { genres: [], moods: [], energy: null, bpm: null, ...overrides };
}

describe("listeningRequestFromCrateParse", () => {
  it("copies genres, moods and bpm, and carries unparsed and strategy", () => {
    const result = listeningRequestFromCrateParse(
      parsed(
        { genres: ["Deep House"], moods: ["Dark"], bpm: { min: 120, max: 125 } },
        { unparsed: ["for the commute"], strategy: "model-assisted" },
      ),
    );
    expect(result).toEqual({
      request: { genres: ["Deep House"], moods: ["Dark"], energy: null, bpm: { min: 120, max: 125 } },
      unparsed: ["for the commute"],
      ignored: [],
      strategy: "model-assisted",
    });
  });

  it("keeps bpm null when no tempo was asked and open sides null", () => {
    expect(listeningRequestFromCrateParse(parsed({})).request.bpm).toBeNull();
    expect(listeningRequestFromCrateParse(parsed({ bpm: { min: null, max: 125 } })).request.bpm).toEqual({
      min: null,
      max: 125,
    });
  });

  it.each([
    [{ min: 0, max: 0.45 }, "low"],
    [{ min: 0.35, max: 0.7 }, "medium"],
    [{ min: 0.65, max: 1 }, "high"],
    [{ min: 0.8, max: null }, "high"],
    [{ min: null, max: 0.3 }, "low"],
    [{ min: 0.4, max: 0.8 }, "medium"],
    [{ min: 0.2, max: 0.6 }, "medium"],
  ])("maps the energy range %j to the %s band by its midpoint", (range, band) => {
    expect(listeningRequestFromCrateParse(parsed({ energy: range })).request.energy).toBe(band);
  });

  it("maps no energy range, or a fully open one, to null", () => {
    expect(listeningRequestFromCrateParse(parsed({ energy: null })).request.energy).toBeNull();
    expect(
      listeningRequestFromCrateParse(parsed({ energy: { min: null, max: null } })).request.energy,
    ).toBeNull();
  });

  it("ignores count silently and lists listening-irrelevant filters the text set", () => {
    expect(listeningRequestFromCrateParse(parsed({ count: 20 })).ignored).toEqual([]);
    expect(
      listeningRequestFromCrateParse(
        parsed({
          keys: ["8A"],
          requiredStems: ["vocals"],
          licenseType: "remix",
          maxTotalUsd: 20,
          maxPerItemUsd: 5,
          verifiedHumanOnly: true,
        }),
      ).ignored,
    ).toEqual(["keys", "requiredStems", "licenseType", "maxTotalUsd", "maxPerItemUsd", "verifiedHumanOnly"]);
  });

  it("does not report defaults as ignored", () => {
    expect(
      listeningRequestFromCrateParse(parsed({ includeCamelotNeighbors: false, allowFullyAi: true })).ignored,
    ).toEqual([]);
  });
});

describe("sanitizeSessionRequest", () => {
  it("returns undefined for anything that is not an object or has no valid filter", () => {
    for (const value of [undefined, null, "deep house", 7, [], {}, { genres: [] }, { genres: [3, "", "  "] }]) {
      expect(sanitizeSessionRequest(value)).toBeUndefined();
    }
  });

  it("keeps a valid request", () => {
    expect(
      sanitizeSessionRequest({
        genres: ["Deep House"],
        moods: ["Dark"],
        energy: "high",
        bpm: { min: 120, max: 125 },
      }),
    ).toEqual({ genres: ["Deep House"], moods: ["Dark"], energy: "high", bpm: { min: 120, max: 125 } });
  });

  it("trims, drops empty and oversize strings, dedupes, and caps arrays at 8", () => {
    const result = sanitizeSessionRequest({
      genres: ["  Soul ", "soul", "", "x".repeat(65), 5, "Jazz", "y".repeat(64)],
      moods: Array.from({ length: 12 }, (_, index) => `mood${index}`),
    });
    expect(result?.genres).toEqual(["Soul", "Jazz", "y".repeat(64)]);
    expect(result?.moods).toHaveLength(8);
    expect(result?.moods[7]).toBe("mood7");
  });

  it("drops an unknown energy value instead of echoing it", () => {
    expect(sanitizeSessionRequest({ genres: ["Soul"], energy: "extreme" })?.energy).toBeNull();
  });

  it("bounds bpm to 40..220, drops bad sides, and swaps an inverted range", () => {
    expect(sanitizeSessionRequest({ bpm: { min: 125, max: 120 } })?.bpm).toEqual({ min: 120, max: 125 });
    expect(sanitizeSessionRequest({ bpm: { min: 10, max: 125 } })?.bpm).toEqual({ min: null, max: 125 });
    expect(sanitizeSessionRequest({ bpm: { min: 120, max: 999 } })?.bpm).toEqual({ min: 120, max: null });
    expect(sanitizeSessionRequest({ bpm: { min: "120", max: Number.NaN } })).toBeUndefined();
    expect(sanitizeSessionRequest({ bpm: { min: Infinity, max: null } })).toBeUndefined();
    expect(sanitizeSessionRequest({ genres: ["Soul"], bpm: [120, 125] })?.bpm).toBeNull();
  });

  it("never throws on hostile input", () => {
    const hostile = {
      get genres(): never {
        throw new Error("boom");
      },
    };
    expect(sanitizeSessionRequest(hostile)).toBeUndefined();
    expect(() => sanitizeSessionRequest(Object.create(null))).not.toThrow();
    expect(() => sanitizeSessionRequest({ genres: { length: 3 }, moods: "a", bpm: "x" })).not.toThrow();
  });
});

describe("hasRequestFilters", () => {
  it("is true for any one filter and false for an empty request", () => {
    expect(hasRequestFilters(request())).toBe(false);
    expect(hasRequestFilters(undefined)).toBe(false);
    expect(hasRequestFilters(request({ genres: ["Soul"] }))).toBe(true);
    expect(hasRequestFilters(request({ moods: ["Dark"] }))).toBe(true);
    expect(hasRequestFilters(request({ energy: "low" }))).toBe(true);
    expect(hasRequestFilters(request({ bpm: { min: null, max: 125 } }))).toBe(true);
    expect(hasRequestFilters(request({ bpm: { min: null, max: null } }))).toBe(false);
  });
});

describe("requestRankingPreferences", () => {
  it("passes the preferences through untouched without a valid request", () => {
    expect(requestRankingPreferences({ mood: "Chill", energy: "low", request: { genres: [] } })).toEqual({
      sessionGenres: [],
      mood: "Chill",
      moods: [],
      energy: "low",
    });
  });

  it("derives session genres, moods, energy and tempo from the request", () => {
    expect(
      requestRankingPreferences({
        request: { genres: ["Deep House"], moods: ["Dark", "Moody"], energy: "high", bpm: { min: 120, max: 125 } },
      }),
    ).toEqual({
      request: { genres: ["Deep House"], moods: ["Dark", "Moody"], energy: "high", bpm: { min: 120, max: 125 } },
      sessionGenres: ["Deep House"],
      mood: "Dark",
      moods: ["Dark", "Moody"],
      energy: "high",
      tempoBpm: { min: 120, max: 125 },
    });
  });

  it("keeps the mood as sent and lets the request's energy win", () => {
    const result = requestRankingPreferences({
      mood: "Chill",
      energy: "low",
      request: { moods: ["Dark"], energy: "high" },
    });
    expect(result.mood).toBe("Chill");
    expect(result.energy).toBe("high");
    expect(result.moods).toEqual(["Dark"]);
  });

  it("falls back to the energy as sent when the request has none, and omits tempo", () => {
    const result = requestRankingPreferences({ energy: "medium", request: { genres: ["Soul"] } });
    expect(result.energy).toBe("medium");
    expect(result).not.toHaveProperty("tempoBpm");
  });
});

describe("computeRequestCoverage", () => {
  const measured = (tempoBpm: number, extra: object = {}) => ({
    genre: "Deep House",
    moods: ["Dark"],
    energyBand: "high",
    tempoBpm,
    tempoMeasured: true,
    ...extra,
  });

  it("is undefined without picks or without filters", () => {
    expect(computeRequestCoverage(request({ genres: ["Soul"] }), [])).toBeUndefined();
    expect(computeRequestCoverage(request(), [measured(122)])).toBeUndefined();
  });

  it("reports no gaps when every pick matches every filter", () => {
    expect(
      computeRequestCoverage(
        request({ genres: ["deep house"], moods: ["dark"], energy: "high", bpm: { min: 120, max: 125 } }),
        [measured(122), measured(124)],
      ),
    ).toEqual({ picks: 2, gaps: [] });
  });

  it("counts matches per filter case-insensitively and lists gaps, largest first", () => {
    const coverage = computeRequestCoverage(
      request({ genres: ["Deep House"], moods: ["dark"], energy: "high", bpm: { min: 120, max: 125 } }),
      [
        measured(122),
        measured(130),
        measured(140, { genre: "Techno", energyBand: "medium" }),
        measured(118, { genre: "Techno", moods: ["Bright"] }),
        measured(121, { genre: null, moods: [] }),
      ],
    );
    expect(coverage).toEqual({
      picks: 5,
      gaps: [
        { filter: "genres", matched: 2 },
        { filter: "bpm", matched: 2 },
        { filter: "moods", matched: 3 },
        { filter: "energy", matched: 4 },
      ],
    });
  });

  it("counts a catalog genre in the requested genre's family as a match (#2088)", () => {
    const pick = (genre: string | null) => ({ genre, moods: [], tempoMeasured: false });
    expect(
      computeRequestCoverage(request({ genres: ["World"] }), [
        pick("African"),
        pick("Musiques du monde"),
        pick("Techno"),
      ]),
    ).toEqual({ picks: 3, gaps: [{ filter: "genres", matched: 2 }] });
    expect(
      computeRequestCoverage(request({ genres: ["Hip-Hop"] }), [pick("Hip Hop"), pick("French Rap")]),
    ).toEqual({ picks: 2, gaps: [] });
  });

  it("does not count an inferred tempo toward a BPM filter", () => {
    const coverage = computeRequestCoverage(request({ bpm: { min: 120, max: 125 } }), [
      measured(122),
      measured(122, { tempoMeasured: false }),
      { genre: null, moods: [], tempoMeasured: false },
    ]);
    expect(coverage).toEqual({ picks: 3, gaps: [{ filter: "bpm", matched: 1 }] });
  });

  it("treats an open side of the tempo range as unbounded", () => {
    const picks = [measured(100), measured(130)];
    expect(computeRequestCoverage(request({ bpm: { min: null, max: 125 } }), picks)?.gaps).toEqual([
      { filter: "bpm", matched: 1 },
    ]);
    expect(computeRequestCoverage(request({ bpm: { min: 125, max: null } }), picks)?.gaps).toEqual([
      { filter: "bpm", matched: 1 },
    ]);
  });

  it("only reports the filters the request set", () => {
    const coverage = computeRequestCoverage(request({ energy: "low" }), [measured(122)]);
    expect(coverage).toEqual({ picks: 1, gaps: [{ filter: "energy", matched: 0 }] });
  });
});

describe("describeTempoRange", () => {
  it("formats bounded, one-sided and single-value ranges", () => {
    expect(describeTempoRange({ min: 120, max: 125 })).toBe("120–125 BPM");
    expect(describeTempoRange({ min: null, max: 125 })).toBe("under 125 BPM");
    expect(describeTempoRange({ min: 120, max: null })).toBe("over 120 BPM");
    expect(describeTempoRange({ min: 124, max: 124 })).toBe("124 BPM");
  });
});

describe("describeCoverageGaps", () => {
  const full = request({
    genres: ["deep house"],
    moods: ["dark", "moody"],
    energy: "high",
    bpm: { min: 120, max: 125 },
  });

  it("is empty when nothing is missing", () => {
    expect(describeCoverageGaps(full, undefined)).toBe("");
    expect(describeCoverageGaps(full, { picks: 5, gaps: [] })).toBe("");
  });

  it("names each unmet filter with how many picks matched", () => {
    expect(
      describeCoverageGaps(full, {
        picks: 5,
        gaps: [
          { filter: "genres", matched: 0 },
          { filter: "bpm", matched: 1 },
        ],
      }),
    ).toBe("not matched: deep house (0 of 5), 120–125 BPM (1 of 5)");
  });

  it("joins several genres and moods, and words energy", () => {
    expect(
      describeCoverageGaps(
        request({ genres: ["soul", "jazz"], moods: ["dark", "moody"], energy: "high" }),
        {
          picks: 4,
          gaps: [
            { filter: "moods", matched: 1 },
            { filter: "genres", matched: 2 },
            { filter: "energy", matched: 3 },
          ],
        },
      ),
    ).toBe("not matched: dark, moody (1 of 4), soul, jazz (2 of 4), high energy (3 of 4)");
  });
});
