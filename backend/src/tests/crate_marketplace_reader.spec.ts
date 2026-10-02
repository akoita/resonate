import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { createViemMarketplaceReader } from "../modules/crates/crate_marketplace_reader";

/**
 * The viem marketplace reader (#1964) against a fake client: decoding of the
 * contract's struct and `Sold` logs, the pending / reverted / success receipt
 * states, and the configuration check. No chain, no database.
 */

const MARKETPLACE = `0x${"AB".repeat(20)}` as const;
const BUYER = `0x${"bc".repeat(20)}` as const;
const SELLER = `0x${"cd".repeat(20)}` as const;
const TOKEN = "0x" + "de".repeat(20);

const SOLD = parseAbi([
  "event Sold(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 totalPaid)",
]);
const ROYALTY = parseAbi([
  "event RoyaltyPaid(uint256 indexed tokenId, address indexed recipient, uint256 amount)",
]);

function soldLog(address: `0x${string}`, listingId: bigint, logIndex: number, totalPaid: bigint) {
  return {
    address,
    logIndex,
    topics: encodeEventTopics({ abi: SOLD, eventName: "Sold", args: { listingId, buyer: BUYER } }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }],
      [1n, totalPaid],
    ),
  };
}

function royaltyLog(address: `0x${string}`, logIndex: number) {
  return {
    address,
    logIndex,
    topics: encodeEventTopics({
      abi: ROYALTY,
      eventName: "RoyaltyPaid",
      args: { tokenId: 1n, recipient: SELLER },
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [5n]),
  };
}

function reader(client: Record<string, jest.Mock>) {
  return createViemMarketplaceReader({
    client: client as never,
    config: { chainId: 31337, marketplaceAddress: MARKETPLACE },
  });
}

describe("createViemMarketplaceReader", () => {
  it("is configured only with a marketplace address, and exposes it in lower case", () => {
    expect(reader({}).isConfigured()).toBe(true);
    expect(reader({}).marketplaceAddress).toBe(MARKETPLACE.toLowerCase());
    expect(reader({}).chainId).toBe(31337);
    const unconfigured = createViemMarketplaceReader({
      config: { chainId: 31337, marketplaceAddress: null, rpcUrl: "http://localhost:8545" },
    });
    expect(unconfigured.isConfigured()).toBe(false);
    expect(unconfigured.marketplaceAddress).toBe("");
  });

  it("is not configured without an RPC when no client is injected", () => {
    expect(
      createViemMarketplaceReader({
        config: { chainId: 31337, marketplaceAddress: MARKETPLACE, rpcUrl: null },
      }).isConfigured(),
    ).toBe(false);
  });

  it("reads a listing as lower-case addresses and bigints", async () => {
    const readContract = jest.fn().mockResolvedValue({
      seller: SELLER.toUpperCase().replace("0X", "0x"),
      tokenId: 9n,
      amount: 2n,
      pricePerUnit: 1_500_000n,
      paymentToken: TOKEN,
      expiry: 1_900_000_000,
    });
    const listing = await reader({ readContract }).getListing(12n);
    expect(listing).toEqual({
      seller: SELLER,
      tokenId: 9n,
      amount: 2n,
      pricePerUnit: 1_500_000n,
      paymentToken: TOKEN,
      expiry: 1_900_000_000,
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "getListing", args: [12n] }),
    );
  });

  it("reads the quote tuple", async () => {
    const readContract = jest.fn().mockResolvedValue([1_000_000n, 50_000n, 100_000n, 850_000n]);
    const quote = await reader({ readContract }).quoteBuy(12n, 1n);
    expect(quote).toEqual({
      totalPrice: 1_000_000n,
      royaltyAmount: 50_000n,
      protocolFee: 100_000n,
      sellerAmount: 850_000n,
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "quoteBuy", args: [12n, 1n] }),
    );
  });

  it("propagates a chain read failure", async () => {
    const readContract = jest.fn().mockRejectedValue(new Error("rpc down"));
    await expect(reader({ readContract }).getListing(1n)).rejects.toThrow("rpc down");
  });

  it("reports a transaction without a receipt as pending", async () => {
    const notFound = Object.assign(new Error("not found"), { name: "TransactionReceiptNotFoundError" });
    const getTransactionReceipt = jest.fn().mockRejectedValue(notFound);
    await expect(reader({ getTransactionReceipt }).getSoldLogs("0x" + "1".repeat(64))).resolves.toEqual({
      status: "pending",
      logs: [],
    });
  });

  it("rethrows other receipt errors", async () => {
    const getTransactionReceipt = jest.fn().mockRejectedValue(new Error("rpc down"));
    await expect(reader({ getTransactionReceipt }).getSoldLogs("0x" + "1".repeat(64))).rejects.toThrow(
      "rpc down",
    );
  });

  it("reports a reverted transaction with no logs", async () => {
    const getTransactionReceipt = jest
      .fn()
      .mockResolvedValue({ status: "reverted", logs: [soldLog(MARKETPLACE, 1n, 0, 5n)] });
    await expect(reader({ getTransactionReceipt }).getSoldLogs("0x" + "1".repeat(64))).resolves.toEqual({
      status: "reverted",
      logs: [],
    });
  });

  it("decodes only Sold logs emitted by the marketplace, in log order", async () => {
    const getTransactionReceipt = jest.fn().mockResolvedValue({
      status: "success",
      logs: [
        soldLog(MARKETPLACE, 2n, 9, 200n),
        royaltyLog(MARKETPLACE, 8),
        // A Sold-shaped log from another contract must not count.
        soldLog(`0x${"99".repeat(20)}`, 3n, 5, 300n),
        soldLog(MARKETPLACE.toLowerCase() as `0x${string}`, 1n, 4, 100n),
      ],
    });
    const result = await reader({ getTransactionReceipt }).getSoldLogs("0x" + "1".repeat(64));
    expect(result.status).toBe("success");
    expect(result.logs).toEqual([
      { listingId: 1n, buyer: BUYER, amount: 1n, totalPaid: 100n, logIndex: 4 },
      { listingId: 2n, buyer: BUYER, amount: 1n, totalPaid: 200n, logIndex: 9 },
    ]);
  });
});
