import { decodeFunctionData, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { StemMarketplaceABI } from "../contracts_abi";
import {
  buildDirectMarketplaceBuyPlan,
  ERC20_APPROVE_ABI,
} from "./onchainCheckout";
import { ZERO_PAYMENT_TOKEN } from "./payments";

const marketplace = "0x00000000000000000000000000000000000000b0";
const usdc = "0x00000000000000000000000000000000000000a0";

describe("direct marketplace buy transaction planning", () => {
  it("plans native-token listings as one payable marketplace buy", () => {
    const plan = buildDirectMarketplaceBuyPlan({
      marketplaceAddress: marketplace,
      listingId: 42n,
      amount: 2n,
      paymentToken: ZERO_PAYMENT_TOKEN,
      totalPrice: 10_000_000n,
    });

    expect(plan.rail).toBe("native");
    expect(plan.value).toBe(10_000_000n);
    expect(plan.calls).toHaveLength(1);
    expect(plan.calls[0].to).toBe(marketplace);

    const buy = decodeFunctionData({
      abi: StemMarketplaceABI,
      data: plan.calls[0].data,
    });
    expect(buy.functionName).toBe("buy");
    expect(buy.args).toEqual([42n, 2n]);
  });

  it("plans stablecoin listings as approval plus marketplace buy with no native value", () => {
    const plan = buildDirectMarketplaceBuyPlan({
      marketplaceAddress: marketplace,
      listingId: 43n,
      amount: 1n,
      paymentToken: usdc,
      totalPrice: 5_000_000n,
    });

    expect(plan.rail).toBe("erc20");
    expect(plan.value).toBe(0n);
    expect(plan.calls.map((call) => call.to)).toEqual([usdc, marketplace]);

    const approve = decodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      data: plan.calls[0].data,
    });
    expect(approve.functionName).toBe("approve");
    expect(approve.args).toEqual([getAddress(marketplace), 5_000_000n]);

    const buy = decodeFunctionData({
      abi: StemMarketplaceABI,
      data: plan.calls[1].data,
    });
    expect(buy.functionName).toBe("buy");
    expect(buy.args).toEqual([43n, 1n]);
  });
});
