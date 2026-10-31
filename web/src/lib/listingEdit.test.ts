import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { StemMarketplaceABI, StemNFTABI } from "../contracts_abi/index";
import { buildRelistNotifyPayloads, type RelistItem, type RelistTerms } from "./batchRelist";
import {
  describeEditFailure,
  isListingEditable,
  listingEditChanges,
  planListingEdit,
} from "./listingEdit";

const STEM_NFT = getAddress("0x" + "a".repeat(40)) as Address;
const MARKETPLACE = getAddress("0x" + "b".repeat(40)) as Address;
const PAYMENT = getAddress("0x" + "c".repeat(40)) as Address;

const TERMS: RelistTerms = {
  amount: 3n,
  pricePerUnit: 2_000_000n,
  paymentToken: PAYMENT,
  durationSeconds: 604_800n,
};

const ITEM: RelistItem = {
  key: "row-1",
  tokenId: 42n,
  licenseType: "remix",
  label: "Bassline",
  stemId: "stem-42",
};

function plan(needsApproval: boolean) {
  return planListingEdit({
    listingId: 17n,
    item: ITEM,
    terms: TERMS,
    needsApproval,
    stemNFT: STEM_NFT,
    marketplace: MARKETPLACE,
  });
}

function decodeMarketplace(data: unknown) {
  return decodeFunctionData({ abi: StemMarketplaceABI, data: data as Hex });
}

describe("planListingEdit", () => {
  it("batches cancel(old) then list(new terms) into one call list", () => {
    const edit = plan(false);
    expect(edit.calls).toHaveLength(2);
    expect(edit.calls.every((call) => call.to === MARKETPLACE)).toBe(true);

    const cancel = decodeMarketplace(edit.calls[0].data);
    expect(cancel.functionName).toBe("cancel");
    expect(cancel.args).toEqual([17n]);

    const list = decodeMarketplace(edit.calls[1].data);
    expect(list.functionName).toBe("list");
    expect(list.args).toEqual([42n, 3n, 2_000_000n, PAYMENT, 604_800n]);
    expect(edit.cancelledListingId).toBe(17n);
  });

  it("puts the marketplace approval between cancel and list when it is missing", () => {
    const edit = plan(true);
    expect(edit.calls).toHaveLength(3);
    expect(decodeMarketplace(edit.calls[0].data).functionName).toBe("cancel");
    expect(edit.calls[1].to).toBe(STEM_NFT);
    expect(decodeFunctionData({ abi: StemNFTABI, data: edit.calls[1].data as Hex }).functionName).toBe(
      "setApprovalForAll",
    );
    expect(decodeMarketplace(edit.calls[2].data).functionName).toBe("list");
    expect(edit.relist.includeApproval).toBe(true);
  });

  it("keeps the relist half free of the cancel so preflight and notify work as for a relist", () => {
    const edit = plan(false);
    expect(edit.relist.calls).toHaveLength(1);
    expect(edit.relist.listings).toEqual([{ ...ITEM, ordinal: 0 }]);

    const [payload] = buildRelistNotifyPayloads(edit.relist, {
      terms: TERMS,
      chainId: 84532,
      seller: "0x" + "d".repeat(40),
      transactionHash: "0x" + "e".repeat(64),
      listingIdsByToken: new Map([["42", [18n]]]),
    });
    expect(payload).toMatchObject({ licenseType: "remix", transactionHash: "0x" + "e".repeat(64) });
    expect(payload).not.toHaveProperty("tiers");
  });
});

describe("isListingEditable", () => {
  const row = { id: "r", listingId: "1", status: "active", lifecycleStatus: "active", amount: "1" };

  it("allows active and expiring-soon listings only", () => {
    expect(isListingEditable(row)).toBe(true);
    expect(isListingEditable({ ...row, lifecycleStatus: "expiring_soon" })).toBe(true);
    expect(isListingEditable({ ...row, lifecycleStatus: "expired" })).toBe(false);
    expect(isListingEditable({ ...row, status: "cancelled", lifecycleStatus: "cancelled" })).toBe(false);
    expect(isListingEditable({ ...row, status: "sold", lifecycleStatus: "sold" })).toBe(false);
  });
});

describe("listingEditChanges", () => {
  const current = { pricePerUnit: 1n, amount: 2n, paymentToken: PAYMENT };

  it("names each changed field", () => {
    expect(listingEditChanges(current, { pricePerUnit: 5n, amount: 4n, paymentToken: STEM_NFT })).toEqual([
      "price",
      "quantity",
      "payment asset",
    ]);
  });

  it("ignores address case and reports no change for identical terms", () => {
    expect(listingEditChanges(current, { ...current, paymentToken: PAYMENT.toLowerCase() })).toEqual([]);
  });
});

describe("describeEditFailure", () => {
  it("says nothing was sent when the passkey prompt is dismissed", () => {
    const error = Object.assign(new Error("The operation either timed out or was not allowed."), {
      name: "NotAllowedError",
    });
    expect(describeEditFailure(error)).toMatch(/closed the confirmation.*still active/);
  });

  it("explains a wallet rejection and a NotSeller revert", () => {
    expect(describeEditFailure(new Error("User rejected the request."))).toMatch(/declined/);
    expect(describeEditFailure(new Error("execution reverted: NotSeller()"))).toMatch(/different account/);
  });

  it("keeps the reason for other failures and says the listing is unchanged", () => {
    expect(describeEditFailure(new Error("PriceExceedsStakeCap."))).toBe(
      "Could not update the listing: PriceExceedsStakeCap. Nothing was changed. The listing is still active with its current terms.",
    );
  });
});
