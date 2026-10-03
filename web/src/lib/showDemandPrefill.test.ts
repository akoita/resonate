import { describe, expect, it } from "vitest";
import { showDemandPrefill } from "./showDemandPrefill";

describe("Scene Scout show suggestions", () => {
  it("prefills a coarse city and keeps the release reference", () => {
    expect(showDemandPrefill({ city: "new-york", country: "US", releaseId: "release-1" }))
      .toEqual({ city: "New York", country: "US", releaseId: "release-1" });
  });

  it.each([
    { city: ["paris", "lyon"], country: "FR", releaseId: "release-1" },
    { city: "paris", country: "France", releaseId: "release-1" },
    { city: "<script>", country: "FR", releaseId: "release-1" },
    { city: "paris", country: "FR", releaseId: "../../private" },
    { city: "paris", country: "FR" },
  ])("ignores malformed suggestions: %j", (input) => {
    expect(showDemandPrefill(input)).toBeUndefined();
  });
});
