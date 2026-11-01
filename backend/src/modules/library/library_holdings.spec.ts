import { libraryRowStemId, ownershipFor } from "./library_holdings";

describe("library holdings (#2511)", () => {
  it("names the stem a catalog row stands for", () => {
    expect(libraryRowStemId({ source: "remote", clientKey: "stem-1" })).toBe("stem-1");
    expect(libraryRowStemId({ source: "remote", clientKey: "x", previewUrl: "https://api.test/catalog/stems/stem-2/preview?t=1" })).toBe("stem-2");
    expect(libraryRowStemId({ source: "remote", remoteUrl: "/catalog/stems/stem%203/preview" })).toBe("stem 3");
  });

  it("gives no stem for full catalog tracks and device files", () => {
    expect(libraryRowStemId({ source: "remote", catalogTrackId: "t1", clientKey: "stem-1" })).toBeNull();
    expect(libraryRowStemId({ source: "local", clientKey: "local_1" })).toBeNull();
    expect(libraryRowStemId({ source: "remote" })).toBeNull();
  });

  it("reads ownership only from the holdings map", () => {
    const purchasedAt = new Date("2026-10-01T00:00:00Z");
    const holdings = new Map([["stem-1", { tokenId: "42", listingId: "9", purchasedAt }]]);
    expect(ownershipFor("stem-1", holdings)).toEqual({ isOwned: true, tokenId: "42", listingId: "9", purchaseDate: purchasedAt });
    expect(ownershipFor("stem-2", holdings)).toEqual({ isOwned: false, tokenId: null, listingId: null, purchaseDate: null });
    expect(ownershipFor(null, holdings).isOwned).toBe(false);
  });
});
