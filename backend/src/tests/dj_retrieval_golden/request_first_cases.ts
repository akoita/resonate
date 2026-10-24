/**
 * Request-first golden scenarios (#2316), shared by the Docker-free runner
 * (`agent_golden_eval.spec.ts`) and the Postgres runner
 * (`agent_dj_retrieval_golden.integration.spec.ts`): both register the same
 * cases through {@link registerRequestFirstCases}, so the two can never drift.
 * Tests only.
 */
import { HYBRID_RETRIEVAL_VARIANT } from "../../modules/agents/agent_hybrid_retrieval";
import { RAP_REQUEST, REQUEST_FIRST_OFF_REQUEST, REQUEST_FIRST_ON_REQUEST } from "./fixtures";
import type { GoldenRequest } from "./fixtures";
import type { RequestFirstScenarioOptions, runRequestFirstScenario } from "./harness";

export type RequestFirstRunner = (
  catalog: "request_first" | "cap_identity",
  request: GoldenRequest,
  options?: RequestFirstScenarioOptions,
) => ReturnType<typeof runRequestFirstScenario>;

const sorted = (values: readonly string[]) => [...values].sort();

export function registerRequestFirstCases(getRunner: () => RequestFirstRunner) {
  describe.each([[undefined], [HYBRID_RETRIEVAL_VARIANT]])("request-first selection (#2316), variant %s", (variant) => {
    const run = (
      catalog: "request_first" | "cap_identity",
      request: GoldenRequest,
      options: RequestFirstScenarioOptions = {},
    ) => getRunner()(catalog, request, { ...options, ...(variant ? { retrievalVariant: variant } : {}) });

    it("still picks an on-request track Home has already shown (impressions are no penalty)", async () => {
      const served = ["rf_rap_a", "rf_rap_b", "rf_rap_c"];
      const result = await run("request_first", RAP_REQUEST, { servedOnHome: served });

      expect(sorted(result.selected)).toEqual(sorted(REQUEST_FIRST_ON_REQUEST));
      for (const key of served) expect(result.tiers[key]).toBe("A");
    });

    it("hears every non-explicit on-request track before any off-request one, relaxing the artist cap", async () => {
      // Nine Rap tracks, three by one performer and one explicit: eight are playable.
      const result = await run("request_first", { ...RAP_REQUEST, learnedGenres: ["Pop"], fillSimilar: true });

      expect(sorted(result.selected.slice(0, 8))).toEqual(sorted(REQUEST_FIRST_ON_REQUEST));
      expect(result.selected).not.toContain("rf_rap_explicit");
      // The off-request tracks only come after, and are marked as such.
      for (const key of result.selected.slice(8)) {
        expect(result.tiers[key]).toBe("C");
        expect(REQUEST_FIRST_OFF_REQUEST).toContain(key);
      }
      expect(result.capRelaxed).toEqual({ artists: 1, top: { artist: "Marlo Vance", tracks: 3 } });
    });

    it("returns a shorter batch and says why when the catalog has fewer matches than the batch", async () => {
      const result = await run("request_first", RAP_REQUEST);

      expect(sorted(result.selected)).toEqual(sorted(REQUEST_FIRST_ON_REQUEST));
      expect(result.shortfallReason).toBe("catalog_short");
      expect(result.capRelaxed).toEqual({ artists: 1, top: { artist: "Marlo Vance", tracks: 3 } });
      for (const key of result.selected) expect(result.tiers[key]).not.toBe("C");
    });

    it("pads with marked off-request tracks only when similar sounds are allowed", async () => {
      const padded = await run("request_first", { ...RAP_REQUEST, learnedGenres: ["Pop"], fillSimilar: true });

      expect(padded.selected).toHaveLength(12);
      expect(padded.shortfallReason).toBeUndefined();
      expect(padded.selected.filter((key) => padded.tiers[key] === "C")).toHaveLength(4);
    });

    it("plays no learned-taste Pop track for a Rap request while Rap remains", async () => {
      const result = await run("request_first", { ...RAP_REQUEST, learnedGenres: ["Pop"] });

      expect(result.selected.filter((key) => (REQUEST_FIRST_OFF_REQUEST as readonly string[]).includes(key))).toEqual([]);
      expect(sorted(result.selected)).toEqual(sorted(REQUEST_FIRST_ON_REQUEST));
    });

    it("never gives an exploration slot to an off-request track", async () => {
      // The uploader profile is a verified human nobody played, so exploration
      // slots are reserved; the padding and the favoured Pop score well too.
      const result = await run(
        "request_first",
        { ...RAP_REQUEST, learnedGenres: ["Pop"], fillSimilar: true },
        { verifiedUploader: true },
      );

      expect(result.discoveryPicks.length).toBeGreaterThan(0);
      for (const key of result.discoveryPicks) expect(result.tiers[key]).not.toBe("C");
    });

    it("does not cap tracks of different performers, or uncredited tracks, together because one account uploaded them", async () => {
      const result = await run("cap_identity", RAP_REQUEST);

      expect(result.selected).toHaveLength(9);
      expect(result.capRelaxed).toBeUndefined();
      // Nothing was held back for variety (the explicit count reads the whole catalog, so it is not asserted).
      expect(result.heldBack?.variety ?? 0).toBe(0);
      expect(result.shortfallReason).toBe("catalog_short");
    });

    it("keeps the session's own tracks out, and says everything matching was played rather than unmet", async () => {
      const partial = await run("request_first", RAP_REQUEST, { sessionTracks: ["rf_rap_a", "rf_rap_b"] });
      expect(partial.selected).not.toContain("rf_rap_a");
      expect(partial.selected).not.toContain("rf_rap_b");
      expect(partial.selected).toHaveLength(6);

      const used = await run("request_first", RAP_REQUEST, { sessionTracks: [...REQUEST_FIRST_ON_REQUEST] });
      expect(used.selected).toEqual([]);
      expect(used.reason).toBe("all_candidates_recently_played");
    });

    it("steps a recently played track down gently inside its tier instead of burying it", async () => {
      const result = await run("request_first", RAP_REQUEST, { playedRecently: ["rf_rap_a"] });

      expect(result.selected).toContain("rf_rap_a");
      expect(result.tiers.rf_rap_a).toBe("A");
      expect(result.playedStep).toEqual(["rf_rap_a"]);
    });
  });
}
