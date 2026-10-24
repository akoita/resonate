import { describe, expect, it } from "vitest";
import { buildMarketplaceListingsParams } from "./marketplaceListingsQuery";
import { STEM_SOURCE_FILTERS } from "./stemSource";

const base = { limit: 24, offset: 0, sortBy: "newest" };

describe("Browse stems listings query (#2379)", () => {
  it("sends no source for all sources", () => {
    const params = buildMarketplaceListingsParams({ ...base, source: "all" });
    expect(params.has("source")).toBe(false);
    expect(params.toString()).toBe("status=active&limit=24&offset=0&sortBy=newest");
    expect(buildMarketplaceListingsParams(base).has("source")).toBe(false);
    expect(buildMarketplaceListingsParams({ ...base, source: null }).has("source")).toBe(false);
  });

  it("sends the chosen source to the listings route", () => {
    expect(buildMarketplaceListingsParams({ ...base, source: "official" }).get("source")).toBe("official");
    expect(buildMarketplaceListingsParams({ ...base, source: "separated" }).get("source")).toBe("separated");
  });

  it("never forwards a value that is not a source", () => {
    for (const source of ["", "OFFICIAL", "lossless", "official,separated", "all&x=1"]) {
      expect(buildMarketplaceListingsParams({ ...base, source }).has("source")).toBe(false);
    }
  });

  it("covers every option of the source menu", () => {
    const sent = STEM_SOURCE_FILTERS.map((option) => buildMarketplaceListingsParams({ ...base, source: option.value }).get("source"));
    expect(sent).toEqual([null, "official", "separated"]);
  });

  it("keeps the source together with paging, sort, search and the own-listings exclusion", () => {
    const params = buildMarketplaceListingsParams({
      limit: 24,
      offset: 48,
      sortBy: "price_asc",
      search: "night drive",
      source: "official",
      excludeSeller: "0xabc",
    });
    expect(Object.fromEntries(params)).toEqual({
      status: "active",
      limit: "24",
      offset: "48",
      sortBy: "price_asc",
      search: "night drive",
      source: "official",
      excludeSeller: "0xabc",
    });
  });
});
