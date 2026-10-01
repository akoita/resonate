import { djPickVariantFields } from "../modules/sessions/dj_pick_variant";
import {
  assignDiscoveryVariant,
  DISCOVERY_EXPERIMENT_ENV,
  discoveryVariantForUser,
  parseDiscoveryExperiment,
} from "../modules/recommendations/discovery_experiment";

const EXPERIMENT = "ranker_v2:candidate=50,holdout=20";

describe("djPickVariantFields (#2005)", () => {
  it("reports baseline and no experiment key when no experiment is configured", () => {
    expect(djPickVariantFields("listener-1", {})).toEqual({ rankerVariant: "baseline" });
  });

  it("matches the assignment the agent runtime records for the same listener", () => {
    const env = { [DISCOVERY_EXPERIMENT_ENV]: EXPERIMENT };
    for (let i = 0; i < 40; i += 1) {
      const userId = `listener-${i}`;
      const runtime = discoveryVariantForUser(userId, env);
      expect(djPickVariantFields(userId, env)).toEqual({
        rankerVariant: runtime.rankerVariant,
        experimentKey: "ranker_v2",
      });
      expect(runtime).toEqual(
        assignDiscoveryVariant(userId, parseDiscoveryExperiment(EXPERIMENT)),
      );
    }
  });

  it("exposes only labels, never the bucket", () => {
    const fields = djPickVariantFields("listener-1", { [DISCOVERY_EXPERIMENT_ENV]: EXPERIMENT });
    expect(Object.keys(fields).sort()).toEqual(["experimentKey", "rankerVariant"]);
  });

  it("falls back to baseline for a missing listener id", () => {
    expect(djPickVariantFields(undefined, { [DISCOVERY_EXPERIMENT_ENV]: EXPERIMENT })).toEqual({
      rankerVariant: "baseline",
      experimentKey: "ranker_v2",
    });
  });
});
