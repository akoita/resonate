import { decodeFunctionData } from "viem";
import { describe, expect, it, vi } from "vitest";
import { StemMarketplaceABI } from "../contracts_abi";
import { quoteBatchLines } from "./crateQuote";
import {
  runCrateQuotePurchase,
  settleWithBackoff,
  type PurchaseDeps,
  type PurchaseStage,
} from "./crateQuotePurchase";
import type { PreflightResult } from "./crateQuotePreflight";
import type { CrateQuote, SettleCrateQuoteResult } from "./crates";
import { ERC20_APPROVE_ABI, type CrateBatchLine } from "./onchainCheckout";
import { BUYER, MARKETPLACE, NOW_MS, makeQuote } from "./__tests__/crateQuoteFixtures";

const HASH = `0x${"ab".repeat(32)}`;

function settled(quote: CrateQuote, status: CrateQuote["status"] = "settled"): SettleCrateQuoteResult {
  return { status: status === "submitted" ? 202 : 200, quote: { ...quote, status, transactionHash: HASH } };
}

function deps(overrides: Partial<PurchaseDeps> = {}) {
  const quote = overrides.quote ?? makeQuote();
  const stages: PurchaseStage[] = [];
  const base: PurchaseDeps = {
    quote,
    buyerAddress: BUYER,
    chainId: 31337,
    marketplaceAddress: MARKETPLACE,
    now: () => NOW_MS,
    preflight: vi.fn(async (lines: CrateBatchLine[]): Promise<PreflightResult> => ({ keep: lines, dropped: [], simulation: "ran" })),
    confirmDropped: vi.fn(async () => true),
    send: vi.fn(async () => HASH),
    settle: vi.fn(async () => settled(quote)),
    sleep: vi.fn(async () => undefined),
    onStage: (stage) => stages.push(stage),
    ...overrides,
  };
  return { deps: base, stages };
}

describe("runCrateQuotePurchase", () => {
  it("checks, signs one batch for every quoted stem, and settles with no dropped lines", async () => {
    const { deps: d, stages } = deps();
    const outcome = await runCrateQuotePurchase(d);

    expect(outcome.kind).toBe("sent");
    expect(stages).toEqual(["checking", "signing", "settling"]);
    expect(d.confirmDropped).not.toHaveBeenCalled();
    expect(d.send).toHaveBeenCalledTimes(1);

    const plan = (d.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // One USDC approval for the sum of the three stems, then three buys in quote order.
    expect(plan.calls).toHaveLength(4);
    const approve = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: plan.calls[0].data });
    expect(approve.args?.[1]).toBe(2_000_000n + 3_000_000n + 2_000_000n);
    const buys = plan.calls.slice(1).map((call: { data: `0x${string}` }) =>
      decodeFunctionData({ abi: StemMarketplaceABI, data: call.data }).args,
    );
    expect(buys).toEqual([[11n, 1n], [12n, 1n], [13n, 1n]]);

    expect(d.settle).toHaveBeenCalledWith({ transactionHash: HASH, dropped: [] });
    if (outcome.kind === "sent") expect(outcome.settlement.kind).toBe("final");
  });

  it("tells the caller about the transaction before it asks settlement", async () => {
    const order: string[] = [];
    const { deps: d } = deps({
      onSent: (hash, dropped) => order.push(`sent:${hash.slice(0, 6)}:${dropped.length}`),
      settle: vi.fn(async () => {
        order.push("settle");
        return settled(makeQuote());
      }),
    });
    await runCrateQuotePurchase(d);
    expect(order).toEqual(["sent:0xabab:0", "settle"]);
  });

  it("sends nothing for a quote that must not be signed", async () => {
    const cases: Array<[Partial<PurchaseDeps>, string]> = [
      [{ quote: makeQuote({ status: "submitted" }) }, "not_open"],
      [{ now: () => NOW_MS + 11 * 60_000 }, "expired"],
      [{ buyerAddress: "0x00000000000000000000000000000000000000d9" }, "wallet_changed"],
      [{ chainId: 1 }, "wrong_network"],
      [{ marketplaceAddress: "0x00000000000000000000000000000000000000f1" }, "wrong_marketplace"],
    ];
    for (const [override, blocker] of cases) {
      const { deps: d } = deps(override);
      const outcome = await runCrateQuotePurchase(d);
      expect(outcome).toEqual({ kind: "blocked", blocker });
      expect(d.preflight).not.toHaveBeenCalled();
      expect(d.send).not.toHaveBeenCalled();
      expect(d.settle).not.toHaveBeenCalled();
    }
  });

  it("asks the DJ before going on without left-out lines, and reports them to settlement", async () => {
    const { deps: d, stages } = deps({
      preflight: vi.fn(async (lines: CrateBatchLine[]) => ({
        keep: [lines[0], lines[2]],
        dropped: [{ quoteLineId: "q2", reason: "listing_changed" as const }],
        simulation: "ran" as const,
      })),
    });
    const outcome = await runCrateQuotePurchase(d);

    expect(stages).toEqual(["checking", "confirming_drops", "signing", "settling"]);
    expect(d.confirmDropped).toHaveBeenCalledWith(
      [{ quoteLineId: "q2", reason: "listing_changed" }],
      expect.arrayContaining([expect.objectContaining({ quoteLineId: "q1" }), expect.objectContaining({ quoteLineId: "q3" })]),
    );
    // The dropped stem is not in the batch, and settlement hears about it.
    const plan = (d.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(plan.calls).toHaveLength(3);
    const buys = plan.calls.slice(1).map((call: { data: `0x${string}` }) =>
      decodeFunctionData({ abi: StemMarketplaceABI, data: call.data }).args,
    );
    expect(buys).toEqual([[11n, 1n], [13n, 1n]]);
    const approve = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: plan.calls[0].data });
    expect(approve.args?.[1]).toBe(4_000_000n);
    expect(d.settle).toHaveBeenCalledWith({
      transactionHash: HASH,
      dropped: [{ quoteLineId: "q2", reason: "listing_changed" }],
    });
    expect(outcome.kind).toBe("sent");
  });

  it("sends nothing when the DJ declines the reduced purchase", async () => {
    const { deps: d } = deps({
      preflight: vi.fn(async (lines: CrateBatchLine[]) => ({
        keep: [lines[0]],
        dropped: [{ quoteLineId: "q2", reason: "insufficient_balance" as const }, { quoteLineId: "q3", reason: "insufficient_balance" as const }],
        simulation: "unsupported" as const,
      })),
      confirmDropped: vi.fn(async () => false),
    });
    const outcome = await runCrateQuotePurchase(d);
    expect(outcome.kind).toBe("cancelled");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.settle).not.toHaveBeenCalled();
  });

  it("never sends a batch with no buys", async () => {
    const { deps: d } = deps({
      preflight: vi.fn(async () => ({
        keep: [],
        dropped: [
          { quoteLineId: "q1", reason: "listing_changed" as const },
          { quoteLineId: "q2", reason: "listing_changed" as const },
          { quoteLineId: "q3", reason: "listing_changed" as const },
        ],
        simulation: "ran" as const,
      })),
    });
    const outcome = await runCrateQuotePurchase(d);
    expect(outcome.kind).toBe("nothing_to_buy");
    expect(d.confirmDropped).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("refuses to buy a line that is not in the quote or was changed", async () => {
    const { deps: d } = deps({
      preflight: vi.fn(async (lines: CrateBatchLine[]) => ({
        keep: [{ ...lines[0], totalUnits: lines[0].totalUnits - 1n }],
        dropped: [],
        simulation: "ran" as const,
      })),
    });
    expect((await runCrateQuotePurchase(d)).kind).toBe("not_sent");
    expect(d.send).not.toHaveBeenCalled();

    const stranger = deps({
      preflight: vi.fn(async (lines: CrateBatchLine[]) => ({
        keep: [{ ...lines[0], quoteLineId: "someone-else" }],
        dropped: [],
        simulation: "ran" as const,
      })),
    });
    expect((await runCrateQuotePurchase(stranger.deps)).kind).toBe("not_sent");
    expect(stranger.deps.send).not.toHaveBeenCalled();
  });

  it("does not send when the quote expires while the DJ decides", async () => {
    let clock = NOW_MS;
    const { deps: d } = deps({
      now: () => clock,
      preflight: vi.fn(async (lines: CrateBatchLine[]) => ({
        keep: [lines[0]],
        dropped: [{ quoteLineId: "q2", reason: "listing_changed" as const }],
        simulation: "ran" as const,
      })),
      confirmDropped: vi.fn(async () => {
        clock += 11 * 60_000;
        return true;
      }),
    });
    expect(await runCrateQuotePurchase(d)).toEqual({ kind: "blocked", blocker: "expired" });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("does not send when the check itself fails", async () => {
    const { deps: d } = deps({
      preflight: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    });
    const outcome = await runCrateQuotePurchase(d);
    expect(outcome.kind).toBe("not_sent");
    if (outcome.kind === "not_sent") expect(outcome.message).toMatch(/Nothing was charged/);
    expect(d.send).not.toHaveBeenCalled();
  });

  it("keeps the quote open and settles nothing when the wallet fails or is cancelled", async () => {
    const cancelled = deps({
      send: vi.fn(async () => {
        throw Object.assign(new Error("The operation either timed out or was not allowed"), { name: "NotAllowedError" });
      }),
    });
    const a = await runCrateQuotePurchase(cancelled.deps);
    expect(a.kind).toBe("not_sent");
    if (a.kind === "not_sent") expect(a.message).toMatch(/Nothing was charged/);
    expect(cancelled.deps.settle).not.toHaveBeenCalled();

    const bundler = deps({
      send: vi.fn(async () => {
        throw new Error("bundler error");
      }),
    });
    const b = await runCrateQuotePurchase(bundler.deps);
    expect(b.kind).toBe("not_sent");
    expect(bundler.deps.settle).not.toHaveBeenCalled();
  });

  it("does not settle a hash that is not a transaction hash", async () => {
    const { deps: d } = deps({ send: vi.fn(async () => "0x1234") });
    expect((await runCrateQuotePurchase(d)).kind).toBe("not_sent");
    expect(d.settle).not.toHaveBeenCalled();
  });

  it("matches the lines the plan buys to the quote's own lines", () => {
    const lines = quoteBatchLines(makeQuote());
    expect(lines.map((line) => line.quoteLineId)).toEqual(["q1", "q2", "q3"]);
  });
});

describe("settleWithBackoff", () => {
  const quote = makeQuote({ status: "submitted" });
  const pending: SettleCrateQuoteResult = { status: 202, quote };
  const done: SettleCrateQuoteResult = { status: 200, quote: { ...quote, status: "settled" } };

  it("retries a 202 with growing delays until the quote is final", async () => {
    const settle = vi.fn<() => Promise<SettleCrateQuoteResult>>()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(done);
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const outcome = await settleWithBackoff({ settle, sleep });
    expect(outcome.kind).toBe("final");
    expect(settle).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([2000, 4000]);
  });

  it("gives up as still confirming after the last delay", async () => {
    const settle = vi.fn(async () => pending);
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const outcome = await settleWithBackoff({ settle, sleep });
    expect(outcome.kind).toBe("pending");
    expect(settle).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([2000, 4000, 8000, 16000]);
  });

  it("keeps trying through a server hiccup but stops on a conflict", async () => {
    const hiccup = vi.fn<() => Promise<SettleCrateQuoteResult>>()
      .mockRejectedValueOnce({ status: 503, details: { code: "marketplace_unavailable" } })
      .mockResolvedValueOnce(done);
    expect((await settleWithBackoff({ settle: hiccup, sleep: async () => undefined })).kind).toBe("final");

    const conflict = vi.fn(async () => {
      throw Object.assign(new Error("Conflict"), {
        status: 409,
        details: { code: "transaction_already_used" },
      });
    });
    const outcome = await settleWithBackoff({ settle: conflict, sleep: async () => undefined });
    expect(outcome.kind).toBe("rejected");
    expect(conflict).toHaveBeenCalledTimes(1);
  });

  it("stops when cancelled", async () => {
    const settle = vi.fn(async () => pending);
    const outcome = await settleWithBackoff({
      settle,
      sleep: async () => undefined,
      isCancelled: () => true,
    });
    expect(outcome.kind).toBe("pending");
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("does not trust a 200 for a quote that is not in a final state", async () => {
    const odd: SettleCrateQuoteResult = { status: 200, quote: { ...quote, status: "open" } };
    const outcome = await settleWithBackoff({ settle: async () => odd, sleep: async () => undefined, delaysMs: [1] });
    expect(outcome.kind).toBe("pending");
  });
});
