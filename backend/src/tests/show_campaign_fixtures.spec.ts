import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import {
  SHOW_CAMPAIGN_FIXTURES,
  validateShowCampaignFixtures,
} from "../fixtures/show_campaigns";

describe("sample show campaign fixtures", () => {
  const assetDirectory = resolve(process.cwd(), "fixtures", "show-campaigns", "assets");
  const provenanceReadme = readFileSync(
    resolve(process.cwd(), "fixtures", "show-campaigns", "README.md"),
    "utf8",
  );

  const referencedAssetFiles = () =>
    SHOW_CAMPAIGN_FIXTURES.flatMap((fixture) => [
      fixture.campaign.heroAsset,
      ...fixture.gallery.map((asset) => asset.file),
    ]).sort();

  const committedAssetFiles = () =>
    readdirSync(assetDirectory)
      .filter((file) => /\.(?:jpe?g|png|webp)$/i.test(file))
      .sort();

  it("defines four distinct, sourced campaigns", () => {
    expect(SHOW_CAMPAIGN_FIXTURES).toHaveLength(4);
    expect(new Set(SHOW_CAMPAIGN_FIXTURES.map((fixture) => fixture.campaign.id)).size).toBe(4);
    expect(new Set(SHOW_CAMPAIGN_FIXTURES.map((fixture) => fixture.campaign.slug)).size).toBe(4);
    expect(SHOW_CAMPAIGN_FIXTURES.every((fixture) => fixture.sources.length >= 2)).toBe(true);
  });

  it("ships every referenced image in the fixture asset directory", () => {
    expect(() => validateShowCampaignFixtures(assetDirectory)).not.toThrow();
    expect(referencedAssetFiles()).toEqual(committedAssetFiles());
  });

  it("records creator, license, and a source URL for every committed asset", () => {
    const provenanceRows = new Map(
      provenanceReadme
        .split("\n")
        .filter((line) => line.startsWith("| `"))
        .map((line) => {
          const [file, creator, license, source] = line
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());
          return [file.replaceAll("`", ""), { creator, license, source }];
        }),
    );

    for (const file of committedAssetFiles()) {
      const provenance = provenanceRows.get(file);
      expect(provenance).toBeDefined();
      expect(provenance?.creator).toBeTruthy();
      expect(provenance?.license).toBeTruthy();
      expect(provenance?.source).toMatch(/\]\(https?:\/\/[^)]+\)/);
    }
  });
});
