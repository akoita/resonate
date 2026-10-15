import { describe, expect, it } from "vitest";
import { groupListingsByStem, groupTierOrder, type GroupableListing } from "./marketplaceStemGroups";

const listing = (
  listingId: string,
  stemId: string | null,
  licenseType: GroupableListing["licenseType"],
  price = "100",
  extra: Partial<GroupableListing> = {},
): GroupableListing => ({
  listingId,
  price,
  paymentToken: "0xusdc",
  licenseType,
  stem: stemId ? { id: stemId } : null,
  ...extra,
});

describe("groupListingsByStem", () => {
  it("makes one group per stem with its tiers, in first-seen order", () => {
    const groups = groupListingsByStem([
      listing("3", "stem-b", "personal"),
      listing("1", "stem-a", "remix", "5000"),
      listing("2", "stem-a", "personal"),
      listing("4", "stem-a", "commercial", "25000"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["stem-b", "stem-a"]);
    const stemA = groups[1];
    expect(groupTierOrder(stemA)).toEqual(["personal", "remix", "commercial"]);
    // Personal represents the card even when a paid tier was seen first.
    expect(stemA.primary.listingId).toBe("2");
    expect(stemA.tierListingIds).toEqual({ personal: "2", remix: "1", commercial: "4" });
  });

  it("treats a missing license type as personal", () => {
    const [group] = groupListingsByStem([listing("1", "stem-a", undefined)]);
    expect(group.tiers.personal?.listingId).toBe("1");
  });

  it("keeps the cheapest listing per tier in the same payment asset", () => {
    const [group] = groupListingsByStem([
      listing("1", "stem-a", "remix", "9000"),
      listing("2", "stem-a", "remix", "5000"),
      listing("3", "stem-a", "remix", "1", { paymentToken: "0xother" }),
    ]);
    expect(group.tiers.remix?.listingId).toBe("2");
    expect(group.primary.listingId).toBe("2");
  });

  it("keeps listings without a stem as their own cards", () => {
    const groups = groupListingsByStem([listing("1", null, "personal"), listing("2", null, "personal")]);
    expect(groups.map((g) => g.key)).toEqual(["listing:1", "listing:2"]);
  });

  it("merges backend sibling tiers, preferring listings on the page", () => {
    const [group] = groupListingsByStem([
      listing("2", "stem-a", "personal", "100", { tierListings: { remix: "9", personal: "old" } }),
    ]);
    expect(group.tierListingIds).toEqual({ personal: "2", remix: "9" });
    expect(groupTierOrder(group)).toEqual(["personal"]);
  });
});
