/**
 * Staging feedback on #2242's branch: a three-genre hip-hop session showed 5 picks.
 * The default selection target is 12, and the request coverage says what the
 * batch left out (per-artist cap, explicit preference) instead of leaving the
 * listener to wonder. Pure unit tests; the catalog tools are stubbed.
 */
import { getAgentTrackLimit } from "../modules/agents/agent_runtime.config";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { requestCoverageFor } from "../modules/agents/agent_session_request";
import { applyDiscoveryPolicy } from "../modules/recommendations/discovery-policy";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";

describe("getAgentTrackLimit", () => {
  const saved = process.env.AGENT_TRACK_LIMIT;
  afterEach(() => {
    if (saved === undefined) delete process.env.AGENT_TRACK_LIMIT;
    else process.env.AGENT_TRACK_LIMIT = saved;
  });

  it("defaults to 12, keeps the env override and still caps at 50", () => {
    delete process.env.AGENT_TRACK_LIMIT;
    expect(getAgentTrackLimit()).toBe(12);
    process.env.AGENT_TRACK_LIMIT = "5";
    expect(getAgentTrackLimit()).toBe(5);
    process.env.AGENT_TRACK_LIMIT = "500";
    expect(getAgentTrackLimit()).toBe(50);
    process.env.AGENT_TRACK_LIMIT = "0";
    expect(getAgentTrackLimit()).toBe(12);
  });
});

describe("applyDiscoveryPolicy heldBackForVariety", () => {
  const candidate = (id: string, artist: string, score: number) =>
    ({ id, artist, score, signals: [], explanation: [], release: { artistDisplayName: artist } }) as any;

  it("lists eligible candidates left out only by the per-artist cap, and leaves the cap unchanged", () => {
    const result = applyDiscoveryPolicy(
      [candidate("a1", "A", 9), candidate("a2", "A", 8), candidate("a3", "A", 7), candidate("b1", "B", 6)],
      { limit: 10 },
    );
    expect(result.items.map((entry) => entry.id)).toEqual(["a1", "a2", "b1"]);
    expect(result.heldBackForVariety).toEqual(["a3"]);
  });

  it("reports nothing when the cap held nothing back", () => {
    const result = applyDiscoveryPolicy([candidate("a1", "A", 9), candidate("b1", "B", 6)], { limit: 10 });
    expect(result).not.toHaveProperty("heldBackForVariety");
  });
});

describe("AgentSelectorService held-back accounting", () => {
  const track = (id: string, artist: string) => ({
    id,
    title: id,
    artist,
    hasListing: false,
    release: { genre: "Hip-Hop", title: id, moods: [] as string[], artistId: `up-${artist}`, primaryArtist: artist },
  });
  function build(explicitCount: number | "error") {
    const explicitRun = jest.fn(async () => {
      if (explicitCount === "error") throw new Error("db");
      return { count: explicitCount };
    });
    const search = jest.fn(async () => ({
      items: [track("a1", "A"), track("a2", "A"), track("a3", "A"), track("b1", "B")],
    }));
    const tools = {
      get: jest.fn((name: string) => ({
        run: name === "catalog.explicit_matches" ? explicitRun : search,
      })),
    };
    return { selector: new AgentSelectorService(tools as any, new DiscoveryRankingService()), explicitRun };
  }
  const request = { queries: ["Hip-Hop"], requestedTerms: ["Hip-Hop"], recentTrackIds: [], limit: 12 };

  it("counts matches held back for variety and excluded as explicit", async () => {
    const { selector, explicitRun } = build(2);
    const result = await selector.select({ ...request, allowExplicit: false });
    expect(result.selected.map((entry) => entry.id).sort()).toEqual(["a1", "a2", "b1"]);
    expect(result.heldBack).toEqual({ variety: 1, explicit: 2 });
    expect(explicitRun).toHaveBeenCalledWith({ terms: ["Hip-Hop"], excludeTrackIds: [] });
  });

  it("does not count explicit tracks the listener allowed, and fails open when the count fails", async () => {
    const allowed = build(2);
    const withExplicit = await allowed.selector.select({ ...request, allowExplicit: true });
    expect(allowed.explicitRun).not.toHaveBeenCalled();
    expect(withExplicit.heldBack).toEqual({ variety: 1, explicit: 0 });

    const broken = build("error");
    const failed = await broken.selector.select({ ...request, allowExplicit: false });
    expect(failed.heldBack).toEqual({ variety: 1, explicit: 0 });
  });

  it("reports nothing for a session that asked for nothing, or when nothing was held back", async () => {
    const { selector, explicitRun } = build(3);
    const unasked = await selector.select({ queries: ["Hip-Hop"], recentTrackIds: [], limit: 12 });
    expect(unasked.heldBack).toBeUndefined();
    expect(explicitRun).not.toHaveBeenCalled();
  });
});

describe("requestCoverageFor heldBack", () => {
  const request = { genres: ["Hip-Hop"], moods: [], energy: null, bpm: null };
  const pick = { genre: "Hip-Hop", moods: [], tempoMeasured: false };

  it("carries the held-back counts, and omits them when there are none", () => {
    expect(requestCoverageFor(request, [pick], { variety: 1, explicit: 2 })?.coverage).toEqual({
      picks: 1,
      gaps: [],
      heldBack: { variety: 1, explicit: 2 },
    });
    expect(requestCoverageFor(request, [pick], { variety: 0, explicit: 0 })?.coverage).toEqual({ picks: 1, gaps: [] });
    expect(requestCoverageFor(request, [pick])?.coverage).toEqual({ picks: 1, gaps: [] });
  });
});
