/**
 * #2172: the arithmetic and log matching behind a marketplace sale's real split.
 * Pure: no database, no chain. The DB and Anvil behaviour is in
 * marketplace_sale_split.integration.spec.ts.
 */
import {
  computeSaleSplit,
  selectRoyaltyForSale,
  type SaleLogRow,
} from "../modules/contracts/marketplace_sale_split";

const MARKETPLACE = "0x" + "a".repeat(40);
const OTHER = "0x" + "b".repeat(40);
const ARTIST = "0x" + "c".repeat(40);

function royalty(logIndex: number, tokenId: string, amount: string, contractAddress = MARKETPLACE): SaleLogRow {
  return { eventName: "RoyaltyPaid", logIndex, contractAddress, args: { tokenId, recipient: ARTIST, amount } };
}
function sold(logIndex: number, contractAddress = MARKETPLACE): SaleLogRow {
  return { eventName: "Sold", logIndex, contractAddress, args: { listingId: "1", buyer: OTHER, amount: "1", totalPaid: "1" } };
}

describe("computeSaleSplit", () => {
  it("mirrors the contract: fee floors, the seller keeps the remainder", () => {
    // 1,000,003 units at 10% fee and a 50,000 royalty.
    const split = computeSaleSplit({ totalPaid: 1_000_003n, protocolFeeBps: 1000n, royaltyAmount: 50_000n });
    expect(split).toEqual({ protocolFee: 100_000n, royalty: 50_000n, seller: 850_003n });
    expect(split!.protocolFee + split!.royalty + split!.seller).toBe(1_000_003n);
  });

  it("a sale with no royalty and no fee is all seller", () => {
    expect(computeSaleSplit({ totalPaid: 5n, protocolFeeBps: 0n, royaltyAmount: 0n })).toEqual({
      protocolFee: 0n,
      royalty: 0n,
      seller: 5n,
    });
  });

  it("refuses parts that do not fit the gross, or an impossible fee", () => {
    expect(computeSaleSplit({ totalPaid: 100n, protocolFeeBps: 1000n, royaltyAmount: 95n })).toBeNull();
    expect(computeSaleSplit({ totalPaid: 100n, protocolFeeBps: 10_001n, royaltyAmount: 0n })).toBeNull();
    expect(computeSaleSplit({ totalPaid: 100n, protocolFeeBps: -1n, royaltyAmount: 0n })).toBeNull();
  });
});

describe("selectRoyaltyForSale", () => {
  it("picks the RoyaltyPaid log just before the Sold log, for that token", () => {
    const rows = [royalty(3, "7", "500")];
    expect(selectRoyaltyForSale({ rows, soldLogIndex: 4, tokenId: 7n, marketplaceAddress: MARKETPLACE })).toEqual({
      amount: 500n,
      recipient: ARTIST,
    });
  });

  it("returns null when the log is not there (never a zero royalty)", () => {
    expect(selectRoyaltyForSale({ rows: [], soldLogIndex: 4, tokenId: 7n, marketplaceAddress: MARKETPLACE })).toBeNull();
  });

  it("ignores a RoyaltyPaid for another token, another contract, or after the Sold log", () => {
    const rows = [royalty(1, "8", "111"), royalty(2, "7", "222", OTHER), royalty(9, "7", "333")];
    expect(selectRoyaltyForSale({ rows, soldLogIndex: 4, tokenId: 7n, marketplaceAddress: MARKETPLACE })).toBeNull();
  });

  it("keeps the sales of a batched transaction apart", () => {
    // [Royalty(7,500), Sold#1, Royalty(7,900), Sold#2, Sold#3 (no royalty)]
    const rows = [royalty(0, "7", "500"), sold(1), royalty(2, "7", "900"), sold(3)];
    const first = selectRoyaltyForSale({ rows, soldLogIndex: 1, tokenId: 7n, marketplaceAddress: MARKETPLACE });
    const second = selectRoyaltyForSale({ rows, soldLogIndex: 3, tokenId: 7n, marketplaceAddress: MARKETPLACE });
    const third = selectRoyaltyForSale({ rows, soldLogIndex: 4, tokenId: 7n, marketplaceAddress: MARKETPLACE });
    expect(first?.amount).toBe(500n);
    expect(second?.amount).toBe(900n);
    // The third sale paid no royalty: it must not inherit the second sale's.
    expect(third).toBeNull();
  });

  it("matches the marketplace address regardless of case and skips malformed args", () => {
    const rows: SaleLogRow[] = [
      { eventName: "RoyaltyPaid", logIndex: 2, contractAddress: MARKETPLACE.toUpperCase().replace("0X", "0x"), args: { tokenId: "7", recipient: ARTIST } },
      royalty(1, "7", "42"),
    ];
    expect(selectRoyaltyForSale({ rows, soldLogIndex: 3, tokenId: 7n, marketplaceAddress: MARKETPLACE })?.amount).toBe(42n);
  });
});
