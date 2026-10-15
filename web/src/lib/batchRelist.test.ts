import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { StemMarketplaceABI, StemNFTABI } from "../contracts_abi/index";
import type { LicenseType } from "../components/marketplace/LicenseTypeSelector";
import {
  RELIST_CHUNK_SIZE,
  buildRelistNotifyPayloads,
  describeRelistFailure,
  normalizeRelistLicense,
  planRelistChunks,
  type RelistItem,
  type RelistTerms,
} from "./batchRelist";

const STEM_NFT = getAddress("0x" + "a".repeat(40)) as Address;
const MARKETPLACE = getAddress("0x" + "b".repeat(40)) as Address;
const PAYMENT = getAddress("0x" + "c".repeat(40)) as Address;
const SELLER = "0x" + "d".repeat(40);
const TX = "0x" + "e".repeat(64);

const TERMS: RelistTerms = {
  amount: 2n,
  pricePerUnit: 1_000_000n,
  paymentToken: PAYMENT,
  durationSeconds: 604_800n,
};

const item = (tokenId: number, licenseType: LicenseType, key = `${tokenId}-${licenseType}`): RelistItem => ({
  key,
  tokenId: BigInt(tokenId),
  licenseType,
  label: `Stem ${tokenId} ${licenseType}`,
  stemId: `stem-${tokenId}`,
});

function plan(items: RelistItem[], needsApproval: boolean, chunkSize?: number) {
  return planRelistChunks(items, {
    terms: TERMS,
    needsApproval,
    stemNFT: STEM_NFT,
    marketplace: MARKETPLACE,
    chunkSize,
  });
}

function decodeCall(call: { to: Address; data: Hex | ((sender: Address) => Hex) }) {
  const data = call.data as Hex;
  if (call.to === STEM_NFT) return decodeFunctionData({ abi: StemNFTABI, data });
  return decodeFunctionData({ abi: StemMarketplaceABI, data });
}

describe("planRelistChunks", () => {
  it("sends one approval and one list() per stem in a single chunk", () => {
    const chunks = plan([item(1, "personal"), item(2, "remix"), item(3, "commercial")], true);
    expect(chunks).toHaveLength(1);
    const [chunk] = chunks;
    expect(chunk.includeApproval).toBe(true);
    expect(chunk.calls).toHaveLength(4);
    const approval = decodeCall(chunk.calls[0]);
    expect(approval.functionName).toBe("setApprovalForAll");
    expect(approval.args).toEqual([MARKETPLACE, true]);
    const lists = chunk.calls.slice(1).map(decodeCall);
    expect(lists.map((call) => call.functionName)).toEqual(["list", "list", "list"]);
    expect(lists.map((call) => call.args?.[0])).toEqual([1n, 2n, 3n]);
    for (const call of lists) {
      expect(call.args?.slice(1)).toEqual([2n, 1_000_000n, PAYMENT, 604_800n]);
    }
  });

  it("omits the approval when the marketplace is already approved", () => {
    const [chunk] = plan([item(1, "personal"), item(2, "personal")], false);
    expect(chunk.includeApproval).toBe(false);
    expect(chunk.calls.map((call) => decodeCall(call).functionName)).toEqual(["list", "list"]);
  });

  it("chunks at RELIST_CHUNK_SIZE with the approval only in the first chunk", () => {
    expect(RELIST_CHUNK_SIZE).toBe(10);
    const items = Array.from({ length: 23 }, (_, index) => item(index + 1, "personal"));
    const chunks = plan(items, true);
    expect(chunks.map((chunk) => chunk.listings.length)).toEqual([10, 10, 3]);
    expect(chunks.map((chunk) => chunk.includeApproval)).toEqual([true, false, false]);
    expect(chunks[0].calls).toHaveLength(11);
    expect(chunks[1].calls).toHaveLength(10);
    expect(chunks.flatMap((chunk) => chunk.listings.map((listing) => listing.tokenId))).toEqual(
      items.map((entry) => entry.tokenId),
    );
  });

  it("keeps two tiers of one token in the same chunk with ordinals in tier order", () => {
    const items = [
      ...Array.from({ length: 9 }, (_, index) => item(index + 1, "personal")),
      item(50, "commercial"),
      item(50, "personal"),
    ];
    const chunks = plan(items, false);
    expect(chunks.map((chunk) => chunk.listings.length)).toEqual([9, 2]);
    const [group] = chunks[1].groups;
    expect(group.tokenId).toBe(50n);
    expect(group.listings.map((listing) => [listing.licenseType, listing.ordinal])).toEqual([
      ["personal", 0],
      ["commercial", 1],
    ]);
    expect(chunks[1].calls.map((call) => decodeCall(call).args?.[0])).toEqual([50n, 50n]);
  });

  it("puts a repeat relist of the same token and tier in a later chunk", () => {
    const chunks = plan([item(7, "remix", "a"), item(7, "remix", "b"), item(8, "personal")], false);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].listings.map((listing) => listing.key)).toEqual(["a", "8-personal"]);
    expect(chunks[1].listings.map((listing) => listing.key)).toEqual(["b"]);
    expect(chunks[1].index).toBe(1);
  });
});

describe("buildRelistNotifyPayloads", () => {
  it("sends one tiers[] notify for several tiers of one token and single-tier notifies for other tokens", () => {
    const [chunk] = plan([item(4, "remix"), item(5, "commercial"), item(4, "personal")], true);
    const payloads = buildRelistNotifyPayloads(chunk, {
      terms: TERMS,
      chainId: 84532,
      seller: SELLER,
      transactionHash: TX,
      listingIdsByToken: new Map([
        ["4", [11n, 12n]],
        ["5", [13n]],
      ]),
    });
    expect(payloads).toHaveLength(2);
    const [multi, single] = payloads;
    expect(multi.tokenId).toBe("4");
    expect(multi.transactionHash).toBe(TX);
    expect(multi.sellerAddress).toBe(SELLER);
    expect(multi.licenseType).toBe("personal");
    expect(multi.stemId).toBe("stem-4");
    expect(multi.tiers).toEqual([
      { licenseType: "personal", pricePerUnit: "1000000", amount: "2", ordinal: 0, listingId: "11" },
      { licenseType: "remix", pricePerUnit: "1000000", amount: "2", ordinal: 1, listingId: "12" },
    ]);
    expect(single).toEqual({
      tokenId: "5",
      chainId: 84532,
      seller: SELLER,
      sellerAddress: SELLER,
      price: "1000000",
      amount: "2",
      paymentToken: PAYMENT,
      licenseType: "commercial",
      durationSeconds: "604800",
      transactionHash: TX,
      stemId: "stem-5",
    });
  });

  it("preserves each listing's license tier and omits listing ids it could not read", () => {
    const [chunk] = plan([item(1, "commercial"), item(2, "remix"), item(3, "personal")], false);
    const payloads = buildRelistNotifyPayloads(chunk, {
      terms: TERMS,
      chainId: 31337,
      seller: SELLER,
      transactionHash: TX,
    });
    expect(payloads.map((payload) => [payload.tokenId, payload.licenseType])).toEqual([
      ["1", "commercial"],
      ["2", "remix"],
      ["3", "personal"],
    ]);
    expect(payloads.every((payload) => payload.tiers === undefined)).toBe(true);
  });
});

describe("normalizeRelistLicense", () => {
  it("keeps known tiers and falls back to personal", () => {
    expect(normalizeRelistLicense("remix")).toBe("remix");
    expect(normalizeRelistLicense("commercial")).toBe("commercial");
    expect(normalizeRelistLicense("unknown")).toBe("personal");
    expect(normalizeRelistLicense(null)).toBe("personal");
  });
});

describe("describeRelistFailure", () => {
  it("names the failed group, its stems, earlier successes and unsent stems", () => {
    const message = describeRelistFailure({
      chunkIndex: 1,
      chunkCount: 3,
      failedLabels: ["Bass", "Drums"],
      succeededLabels: ["Keys"],
      notSentLabels: ["Vox"],
      reason: "Insufficient balance",
      failingLabel: "Drums",
    });
    expect(message).toBe(
      "Group 2 of 3 failed: Drums could not be listed. Insufficient balance. " +
        "None of these stems were relisted: Bass, Drums. " +
        "Already relisted in earlier groups: Keys. Not sent yet: Vox.",
    );
  });

  it("keeps a single-group failure short", () => {
    expect(
      describeRelistFailure({
        chunkIndex: 0,
        chunkCount: 1,
        failedLabels: ["Bass"],
        succeededLabels: [],
        reason: "User rejected the request.",
      }),
    ).toBe("The relist failed: User rejected the request. None of these stems were relisted: Bass.");
  });
});
