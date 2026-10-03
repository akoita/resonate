import { defaultCrateFilters } from "../modules/crates/crate_filters";
import type { CrateCandidateFacts, CrateCoverage } from "../modules/crates/crate.types";
import type { AgentSessionRequest } from "../modules/agents/agent_session_request";
import { deriveCrateUnmetDemand, deriveSessionUnmetDemand } from "../modules/scene_scout/unmet_demand.derivation";

const baseFacts = (overrides: Partial<CrateCandidateFacts> = {}): CrateCandidateFacts => ({
  trackId: "track-a",
  artistId: "artist-a",
  genre: "Electronic",
  moods: [],
  aiDisclosureLevel: "NONE",
  tempoBpm: 110,
  camelot: "8A",
  energy: 0.5,
  stemTypes: [],
  listedLicenseTypes: [],
  indicativePriceUsd: {},
  verifiedHuman: true,
  ...overrides,
});

const coverage = (gaps: CrateCoverage["gaps"]): CrateCoverage => ({ requested: 3, found: 0, gaps });

describe("Scene Scout unmet-demand derivation", () => {
  it("attributes a single eligible stem shortfall to its actual track", () => {
    const filters = { ...defaultCrateFilters(), count: 3, requiredStems: ["vocals" as const] };
    const result = deriveCrateUnmetDemand({
      filters,
      considered: [baseFacts()],
      coverage: coverage([{ filter: "requiredStems", wouldAdd: 1 }]),
    });

    expect(result.candidates).toEqual([{
      targetType: "track",
      candidateTrackId: "track-a",
      kind: "stem",
      value: "vocals",
    }]);
    expect(result.requestedGenres).toEqual([]);
  });

  it("ignores multi-filter and fully-AI candidates instead of assigning a guessed deficit", () => {
    const filters = {
      ...defaultCrateFilters(),
      count: 3,
      requiredStems: ["vocals" as const],
      genres: ["Jazz"],
    };
    const result = deriveCrateUnmetDemand({
      filters,
      considered: [
        baseFacts({ trackId: "multiple-failures", genre: "Electronic" }),
        baseFacts({ trackId: "fully-ai", aiDisclosureLevel: "ALL" }),
      ],
      coverage: coverage([
        { filter: "requiredStems", wouldAdd: 1 },
        { filter: "genres", wouldAdd: 1 },
      ]),
    });

    expect(result.candidates).toEqual([]);
    expect(result.requestedGenres).toEqual(["Jazz"]);
  });

  it("keeps only canonical genre vocabulary and never stores arbitrary request text", () => {
    const filters = {
      ...defaultCrateFilters(),
      count: 2,
      genres: ["hip-hop", "secret prompt text"],
    };
    const result = deriveCrateUnmetDemand({
      filters,
      considered: [],
      coverage: coverage([{ filter: "genres", wouldAdd: 1 }]),
    });
    expect(result.requestedGenres).toEqual(["Hip-Hop"]);
    expect(JSON.stringify(result)).not.toContain("secret prompt text");
  });

  it("derives only one-filter session gaps from canonical values and requires a real shortfall", () => {
    const request: AgentSessionRequest = {
      genres: [],
      moods: ["Focus"],
      energy: null,
      bpm: { min: 100, max: 120 },
    };
    const args = {
      request,
      candidates: [
        { trackId: "single-gap", genre: "Electronic", moods: ["Calm"], tempoBpm: 112, energy: 0.5 },
        { trackId: "multiple-gaps", genre: "Electronic", moods: ["Calm"], tempoBpm: 90, energy: 0.5 },
      ],
      requestCoverage: { picks: 2, gaps: [{ filter: "moods" as const, matched: 0 }] },
    };
    const result = deriveSessionUnmetDemand({ ...args, shortfall: 2 });

    expect(result.candidates).toEqual([{
      targetType: "artist",
      candidateTrackId: "single-gap",
      kind: "mood",
      value: "Focus",
    }]);
    expect(deriveSessionUnmetDemand({ ...args, shortfall: 0 }).candidates).toEqual([]);
  });
});
