import { describe, expect, it } from "vitest";
import {
  groupRemixReadyStemsBySourceTrack,
  higherLicenseTier,
  isRemixReadyTier,
  isStemLicenseTier,
  matchesStemLicenseFilter,
  mergeCollectionStem,
  PURCHASED_STEMS_HREF,
} from "./ownedStems";

describe("license tiers (#2042)", () => {
  it("ranks personal < remix < commercial", () => {
    expect(higherLicenseTier("personal", "remix")).toBe("remix");
    expect(higherLicenseTier("commercial", "remix")).toBe("commercial");
    expect(higherLicenseTier(null, "personal")).toBe("personal");
    expect(higherLicenseTier("personal", undefined)).toBe("personal");
    expect(higherLicenseTier(null, undefined)).toBeNull();
  });

  it("treats remix and commercial as remix-ready", () => {
    expect(isRemixReadyTier("remix")).toBe(true);
    expect(isRemixReadyTier("commercial")).toBe(true);
    expect(isRemixReadyTier("personal")).toBe(false);
    expect(isRemixReadyTier(null)).toBe(false);
  });

  it("only accepts standard tiers", () => {
    expect(isStemLicenseTier("remix")).toBe(true);
    expect(isStemLicenseTier("sync")).toBe(false);
    expect(isStemLicenseTier(null)).toBe(false);
  });

  it("points buyers at Library › Stems", () => {
    expect(PURCHASED_STEMS_HREF).toBe("/library?tab=stems");
  });
});

describe("mergeCollectionStem (#2042)", () => {
  it("returns the incoming stem when nothing was seen yet", () => {
    const stem = { id: "s1", licenseType: "personal", holding: "purchased" as const };
    expect(mergeCollectionStem(undefined, stem)).toBe(stem);
  });

  it("keeps the higher tier whichever address returns it", () => {
    const eoa = { id: "s1", licenseType: "remix", holding: "purchased" as const };
    const smartAccount = { id: "s1", licenseType: "personal", holding: "purchased" as const };
    expect(mergeCollectionStem(eoa, smartAccount).licenseType).toBe("remix");
    expect(mergeCollectionStem(smartAccount, eoa).licenseType).toBe("remix");
  });

  it("prefers a purchase over a listing and keeps the active listing", () => {
    type Row = { id: string; licenseType: string | null; holding: "purchased" | "listed"; activeListingId: string | null };
    const bought: Row = { id: "s1", licenseType: "commercial", holding: "purchased", activeListingId: null };
    const listed: Row = { id: "s1", licenseType: null, holding: "listed", activeListingId: "42" };
    const merged = mergeCollectionStem(bought, listed);
    expect(merged.holding).toBe("purchased");
    expect(merged.licenseType).toBe("commercial");
    expect(merged.activeListingId).toBe("42");
    expect(mergeCollectionStem(listed, bought).activeListingId).toBe("42");
  });

  it("keeps a listed-only stem without a license", () => {
    const listed = { id: "s1", licenseType: null, holding: "listed" as const };
    const merged = mergeCollectionStem(listed, { ...listed });
    expect(merged.licenseType).toBeNull();
    expect(merged.holding).toBe("listed");
  });
});

describe("matchesStemLicenseFilter (#2042)", () => {
  const personal = { licenseType: "personal" as const };
  const remix = { licenseType: "remix" as const };
  const commercial = { licenseType: "commercial" as const };
  const listed = { licenseType: null };

  it("shows everything under All", () => {
    for (const stem of [personal, remix, commercial, listed]) {
      expect(matchesStemLicenseFilter(stem, "all")).toBe(true);
    }
  });

  it("shows remix and commercial stems under Remix-ready", () => {
    expect(matchesStemLicenseFilter(remix, "remix_ready")).toBe(true);
    expect(matchesStemLicenseFilter(commercial, "remix_ready")).toBe(true);
    expect(matchesStemLicenseFilter(personal, "remix_ready")).toBe(false);
    expect(matchesStemLicenseFilter(listed, "remix_ready")).toBe(false);
  });

  it("shows only personal stems under Personal", () => {
    expect(matchesStemLicenseFilter(personal, "personal")).toBe(true);
    expect(matchesStemLicenseFilter(remix, "personal")).toBe(false);
    expect(matchesStemLicenseFilter(listed, "personal")).toBe(false);
  });
});

describe("groupRemixReadyStemsBySourceTrack (#2042)", () => {
  it("groups two or more remix-ready stems of the same track", () => {
    const groups = groupRemixReadyStemsBySourceTrack([
      { id: "drums", sourceTrackId: "t1", sourceTrackTitle: "Night Drive", licenseType: "remix" },
      { id: "bass", sourceTrackId: "t1", sourceTrackTitle: "Night Drive", licenseType: "commercial" },
      { id: "vocals", sourceTrackId: "t1", sourceTrackTitle: "Night Drive", licenseType: "personal" },
      { id: "keys", sourceTrackId: "t2", sourceTrackTitle: "Solo", licenseType: "remix" },
    ]);
    expect(groups).toEqual([
      { sourceTrackId: "t1", sourceTrackTitle: "Night Drive", stemIds: ["drums", "bass"] },
    ]);
  });

  it("skips stems without a source track or a remix-ready license", () => {
    expect(
      groupRemixReadyStemsBySourceTrack([
        { id: "a", sourceTrackId: null, licenseType: "remix" },
        { id: "b", sourceTrackId: null, licenseType: "remix" },
        { id: "c", sourceTrackId: "t3", licenseType: null },
        { id: "d", sourceTrackId: "t3", licenseType: "personal" },
      ]),
    ).toEqual([]);
  });

  it("keeps track order and fills a missing title from a later stem", () => {
    const groups = groupRemixReadyStemsBySourceTrack([
      { id: "x1", sourceTrackId: "t9", licenseType: "remix" },
      { id: "y1", sourceTrackId: "t8", sourceTrackTitle: "B", licenseType: "remix" },
      { id: "x2", sourceTrackId: "t9", sourceTrackTitle: "A", licenseType: "remix" },
      { id: "y2", sourceTrackId: "t8", sourceTrackTitle: "B", licenseType: "remix" },
      { id: "x2", sourceTrackId: "t9", sourceTrackTitle: "A", licenseType: "remix" },
    ]);
    expect(groups.map((group) => group.sourceTrackId)).toEqual(["t9", "t8"]);
    expect(groups[0]).toEqual({ sourceTrackId: "t9", sourceTrackTitle: "A", stemIds: ["x1", "x2"] });
  });
});
