import { describe, expect, it } from "vitest";
import {
  campaignDisplayInitial,
  campaignDisplayTitle,
  campaignRouteCode,
} from "./shows";

describe("Shows campaign presentation", () => {
  it("uses the campaign title as the public display identity", () => {
    const campaign = {
      title: "Sennarin in Paris",
      artistName: "green",
      city: "Paris",
    };

    expect(campaignDisplayTitle(campaign)).toBe("Sennarin in Paris");
    expect(campaignDisplayInitial(campaign)).toBe("S");
    expect(campaignRouteCode(campaign)).toBe("SEN-PAR");
  });

  it("falls back to the platform artist name when a legacy campaign has no title", () => {
    const campaign = {
      title: "",
      artistName: "green",
      city: "Paris",
    };

    expect(campaignDisplayTitle(campaign)).toBe("green in Paris");
    expect(campaignDisplayInitial(campaign)).toBe("G");
  });
});
