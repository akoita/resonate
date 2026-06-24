import { resolve } from "path";
import {
  SHOW_CAMPAIGN_FIXTURES,
  validateShowCampaignFixtures,
} from "../fixtures/show_campaigns";

describe("sample show campaign fixtures", () => {
  const assetDirectory = resolve(process.cwd(), "fixtures", "show-campaigns", "assets");

  it("defines four distinct, sourced campaigns", () => {
    expect(SHOW_CAMPAIGN_FIXTURES).toHaveLength(4);
    expect(new Set(SHOW_CAMPAIGN_FIXTURES.map((fixture) => fixture.campaign.id)).size).toBe(4);
    expect(new Set(SHOW_CAMPAIGN_FIXTURES.map((fixture) => fixture.campaign.slug)).size).toBe(4);
    expect(SHOW_CAMPAIGN_FIXTURES.every((fixture) => fixture.sources.length >= 2)).toBe(true);
  });

  it("ships every referenced image in the fixture asset directory", () => {
    expect(() => validateShowCampaignFixtures(assetDirectory)).not.toThrow();
  });
});
