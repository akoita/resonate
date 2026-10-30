/**
 * A session that names a mood, energy or tempo but no genre (every Moments
 * starter: "Zen, relaxed", "High energy") constrains what is played, the way a
 * genre request does (soft-gated, see `AgentRequestScope.softGated`): a track
 * that contradicts the request is never played, a short batch says so, and the
 * listener's saved vibes only order what already fits. With similar sounds
 * allowed, the leftovers are padded and marked as outside the request.
 *
 * Docker-free: the real selector and ranking core over the in-memory twin of
 * the catalog tools (the golden harness).
 */
import { HYBRID_RETRIEVAL_VARIANT } from "../modules/agents/agent_hybrid_retrieval";
import {
  buildScenarioSelector,
  FixtureAudioFeatureService,
  InMemoryGoldenTools,
  runRequestFirstScenario,
} from "./dj_retrieval_golden/harness";
import type { GoldenRequest, GoldenTrack } from "./dj_retrieval_golden/fixtures";

const LOW = { energyRms: 0.02, onsetDensity: 0.8, tempoBpm: 70 };
const HIGH = { energyRms: 0.26, onsetDensity: 6.5, tempoBpm: 172 };

const CATALOG: readonly GoldenTrack[] = [
  // Contradicts a low-energy request: measured high energy.
  { key: "loud_rap", title: "Gutter Anthem", artist: "Marlo Vance", genre: "Rap", measured: HIGH },
  { key: "loud_zen_tag", title: "Quiet Storm", artist: "Kern", genre: "Rap", moods: ["Zen"], measured: HIGH },
  // No data to judge by: no moods, nothing measured.
  { key: "unknown_indie", title: "Window Seat", artist: "Ida Lund", genre: "Indie" },
  // On the request.
  { key: "zen_low", title: "Still Water", artist: "Hana Mori", genre: "Ambient", moods: ["Zen"], measured: LOW },
  // Measured low, no mood tag: only the audio-range source can find it by sound.
  { key: "calm_measured", title: "Evening Porch", artist: "Elsa Brandt", genre: "Singer-Songwriter", measured: LOW },
  { key: "calm_tagged", title: "Slow Tide", artist: "Noor Haddad", genre: "Classical", moods: ["Calm"], measured: LOW },
];

const ZEN_RELAXED: GoldenRequest = { kind: "structured", moods: ["Zen"], energy: "low", learnedGenres: ["Rap", "Indie"] };
const ON_REQUEST = ["zen_low", "calm_measured", "calm_tagged"];

async function run(request: GoldenRequest, retrievalVariant?: string) {
  const tools = new InMemoryGoldenTools(CATALOG);
  const audioRangeCalls: Array<Record<string, unknown>> = [];
  const spied = {
    get: (name: string) => {
      const tool = tools.get(name);
      return name === "catalog.audio_range"
        ? {
            run: async (input: Record<string, unknown>) => {
              audioRangeCalls.push(input);
              return tool.run(input);
            },
          }
        : tool;
    },
  };
  const spiedSelector = buildScenarioSelector(spied, new FixtureAudioFeatureService(tools.tracksById), "");
  const result = await runRequestFirstScenario(spiedSelector, "", CATALOG, request, {
    limit: 12,
    ...(retrievalVariant ? { retrievalVariant } : {}),
  });
  return { result, audioRangeCalls };
}

describe.each([[undefined], [HYBRID_RETRIEVAL_VARIANT]])("soft-gated request (mood and energy, no genre), variant %s", (variant) => {
  it("plays no track that contradicts the request, whatever the saved vibes favour", async () => {
    const { result } = await run(ZEN_RELAXED, variant);

    expect(result.selected).not.toContain("loud_rap");
    expect(result.selected).not.toContain("loud_zen_tag");
    expect([...result.selected].sort()).toEqual([...ON_REQUEST].sort());
    for (const key of result.selected) expect(result.tiers[key]).not.toBe("C");
  });

  it("finds a track by its measured sound when no tag mentions it", async () => {
    const { result, audioRangeCalls } = await run(ZEN_RELAXED, variant);

    expect(result.candidates).toContain("calm_measured");
    expect(audioRangeCalls.length).toBeGreaterThan(0);
    expect(audioRangeCalls[0]).toMatchObject({ energy: "low" });
  });

  it("says the batch is short, instead of padding it, when the matches run out", async () => {
    const { result } = await run(ZEN_RELAXED, variant);

    expect(result.selected).toHaveLength(ON_REQUEST.length);
    expect(result.shortfallReason).toBe("catalog_short");
  });

  it("tiers A for a full match and B for a partial one", async () => {
    const { result } = await run(ZEN_RELAXED, variant);

    expect(result.tiers.zen_low).toBe("A");
    expect(result.tiers.calm_measured).toBe("B");
    expect(result.tiers.calm_tagged).toBe("B");
  });

  it("pads with the off-request tracks, marked tier C and after the matches, when similar sounds are allowed", async () => {
    const { result } = await run({ ...ZEN_RELAXED, fillSimilar: true }, variant);

    expect([...result.selected.slice(0, ON_REQUEST.length)].sort()).toEqual([...ON_REQUEST].sort());
    const padded = result.selected.slice(ON_REQUEST.length);
    expect(padded.length).toBeGreaterThan(0);
    for (const key of padded) {
      expect(result.tiers[key]).toBe("C");
      expect(["loud_rap", "loud_zen_tag", "unknown_indie"]).toContain(key);
    }
    expect(result.shortfallReason).toBeUndefined();
  });
});

describe("a request that sets no filter is unchanged", () => {
  it("a sentence-only session never produces tier C", async () => {
    const { result } = await run({ kind: "text", text: "something for cooking" });

    expect(result.selected.length).toBeGreaterThan(0);
    for (const key of result.selected) expect(result.tiers[key]).not.toBe("C");
  });
});
