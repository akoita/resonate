import { decodeFunctionData, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { StemMarketplaceABI } from "../contracts_abi";
import {
  buildCrateBatchPlan,
  buildDirectMarketplaceBuyPlan,
  ERC20_APPROVE_ABI,
  type CrateBatchLine,
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

describe("crate batch planning", () => {
  const dai = "0x00000000000000000000000000000000000000d0";

  function line(overrides: Partial<CrateBatchLine> & { quoteLineId: string }): CrateBatchLine {
    return {
      listingId: 1n,
      amount: 1n,
      paymentToken: usdc as CrateBatchLine["paymentToken"],
      totalUnits: 1_000_000n,
      ...overrides,
    };
  }

  const approveOf = (data: `0x${string}`) =>
    decodeFunctionData({ abi: ERC20_APPROVE_ABI, data });
  const buyOf = (data: `0x${string}`) =>
    decodeFunctionData({ abi: StemMarketplaceABI, data });

  it("approves each token once with the exact sum, first, then buys in quote order", () => {
    const plan = buildCrateBatchPlan({
      marketplaceAddress: marketplace,
      lines: [
        line({ quoteLineId: "a", listingId: 10n, totalUnits: 1_500_000n }),
        line({ quoteLineId: "b", listingId: 11n, paymentToken: dai, totalUnits: 7n * 10n ** 18n }),
        line({ quoteLineId: "c", listingId: 12n, totalUnits: 2_500_000n }),
        line({ quoteLineId: "d", listingId: 13n, paymentToken: ZERO_PAYMENT_TOKEN, totalUnits: 900n }),
      ],
    });

    expect(plan.calls.map((call) => call.to)).toEqual([
      usdc,
      dai,
      marketplace,
      marketplace,
      marketplace,
      marketplace,
    ]);
    expect(plan.approvals).toEqual([
      { token: usdc, totalUnits: 4_000_000n },
      { token: dai, totalUnits: 7n * 10n ** 18n },
    ]);
    expect(approveOf(plan.calls[0].data).args).toEqual([getAddress(marketplace), 4_000_000n]);
    expect(approveOf(plan.calls[1].data).args).toEqual([getAddress(marketplace), 7n * 10n ** 18n]);
    expect(plan.calls.slice(2).map((call) => buyOf(call.data).args)).toEqual([
      [10n, 1n],
      [11n, 1n],
      [12n, 1n],
      [13n, 1n],
    ]);
    // Only the native buy carries value.
    expect(plan.calls.map((call) => call.value)).toEqual([0n, 0n, 0n, 0n, 0n, 900n]);
    expect(plan.nativeValue).toBe(900n);
    expect(plan.owners).toEqual([
      { kind: "approve", token: usdc },
      { kind: "approve", token: dai },
      { kind: "buy", quoteLineId: "a" },
      { kind: "buy", quoteLineId: "b" },
      { kind: "buy", quoteLineId: "c" },
      { kind: "buy", quoteLineId: "d" },
    ]);
  });

  it("plans native-only lines as buys with value and no approval", () => {
    const plan = buildCrateBatchPlan({
      marketplaceAddress: marketplace,
      lines: [
        line({ quoteLineId: "a", listingId: 1n, paymentToken: ZERO_PAYMENT_TOKEN, totalUnits: 300n }),
        line({ quoteLineId: "b", listingId: 2n, paymentToken: ZERO_PAYMENT_TOKEN, totalUnits: 700n }),
      ],
    });
    expect(plan.approvals).toEqual([]);
    expect(plan.calls).toHaveLength(2);
    expect(plan.calls.every((call) => call.to === marketplace)).toBe(true);
    expect(plan.calls.map((call) => call.value)).toEqual([300n, 700n]);
    expect(plan.nativeValue).toBe(1000n);
  });

  it("a single line produces the same calls as the one-stem plan", () => {
    const single = buildDirectMarketplaceBuyPlan({
      marketplaceAddress: marketplace,
      listingId: 43n,
      amount: 1n,
      paymentToken: usdc,
      totalPrice: 5_000_000n,
    });
    const batch = buildCrateBatchPlan({
      marketplaceAddress: marketplace,
      lines: [line({ quoteLineId: "a", listingId: 43n, totalUnits: 5_000_000n })],
    });
    expect(batch.calls.map(({ to, data }) => ({ to, data }))).toEqual(single.calls);

    const native = buildDirectMarketplaceBuyPlan({
      marketplaceAddress: marketplace,
      listingId: 44n,
      amount: 1n,
      paymentToken: ZERO_PAYMENT_TOKEN,
      totalPrice: 77n,
    });
    const nativeBatch = buildCrateBatchPlan({
      marketplaceAddress: marketplace,
      lines: [
        line({ quoteLineId: "n", listingId: 44n, paymentToken: ZERO_PAYMENT_TOKEN, totalUnits: 77n }),
      ],
    });
    expect(nativeBatch.calls.map(({ to, data }) => ({ to, data }))).toEqual(native.calls);
    expect(nativeBatch.calls[0].value).toBe(native.value);
  });

  it("keeps amounts exact beyond Number precision", () => {
    const big = 9_007_199_254_740_993n; // 2^53 + 1
    const plan = buildCrateBatchPlan({
      marketplaceAddress: marketplace,
      lines: [
        line({ quoteLineId: "a", totalUnits: big }),
        line({ quoteLineId: "b", listingId: 2n, totalUnits: 2n }),
      ],
    });
    expect(plan.approvals[0].totalUnits).toBe(big + 2n);
    expect(approveOf(plan.calls[0].data).args?.[1]).toBe(big + 2n);
  });

  it("rejects an empty purchase, a repeated line and a zero amount", () => {
    expect(() => buildCrateBatchPlan({ marketplaceAddress: marketplace, lines: [] })).toThrow(
      /at least one line/,
    );
    expect(() =>
      buildCrateBatchPlan({
        marketplaceAddress: marketplace,
        lines: [line({ quoteLineId: "a" }), line({ quoteLineId: "a", listingId: 2n })],
      }),
    ).toThrow(/twice/);
    expect(() =>
      buildCrateBatchPlan({
        marketplaceAddress: marketplace,
        lines: [line({ quoteLineId: "a", totalUnits: 0n })],
      }),
    ).toThrow(/invalid/);
    expect(() =>
      buildCrateBatchPlan({
        marketplaceAddress: marketplace,
        lines: [line({ quoteLineId: "a", amount: 0n })],
      }),
    ).toThrow(/invalid/);
  });
});
