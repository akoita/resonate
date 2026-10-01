import { describe, expect, it } from "vitest";
import {
  buildRecommendationClickedPayload,
  buildRecommendationServedPayload,
} from "./homeRecommendationEvents";

const items = [{ id: "t1" }, { id: "t2" }] as never[];

describe("Home recommendation event payloads (#1455)", () => {
  it("forwards the feed's variant labels on served events", () => {
    expect(
      buildRecommendationServedPayload(
        { requestId: "r1", rankerVariant: "candidate", experimentKey: "exp" },
        { id: "because_genre", items },
      ),
    ).toEqual({
      requestId: "r1",
      railId: "because_genre",
      trackIds: ["t1", "t2"],
      count: 2,
      source: "home",
      rankerVariant: "candidate",
      experimentKey: "exp",
    });
  });

  it("omits the experiment key when none is configured", () => {
    const payload = buildRecommendationServedPayload(
      { requestId: "r1", rankerVariant: "baseline", experimentKey: null },
      { id: "exploration", items },
    );
    expect(payload.rankerVariant).toBe("baseline");
    expect(payload.experimentKey).toBeUndefined();
  });

  it("forwards the labels on clicked events and tolerates a missing feed", () => {
    expect(
      buildRecommendationClickedPayload(
        { requestId: "r1", rankerVariant: "baseline", experimentKey: "exp" },
        { railId: "because_genre", trackId: "t1", position: 3 },
      ),
    ).toEqual({
      requestId: "r1",
      railId: "because_genre",
      trackId: "t1",
      position: 3,
      source: "home",
      rankerVariant: "baseline",
      experimentKey: "exp",
    });
    expect(
      buildRecommendationClickedPayload(null, { railId: "r", trackId: "t", position: 0 }),
    ).toEqual(expect.objectContaining({ requestId: null, rankerVariant: undefined }));
  });
});
