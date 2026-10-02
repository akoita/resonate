import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  fitBalances,
  isSimulationUnsupported,
  listingMatchesQuote,
  preflightWithReader,
  simulationVerdict,
  totalMatchesQuote,
  type ChainListing,
  type PreflightReader,
  type SimulatedCall,
} from "./crateQuotePreflight";
import type { CrateBatchLine } from "./onchainCheckout";
import { ZERO_PAYMENT_TOKEN } from "./payments";

const marketplace = "0x00000000000000000000000000000000000000b0" as Address;
const buyer = "0x00000000000000000000000000000000000000c0" as Address;
const usdc = "0x00000000000000000000000000000000000000a0" as Address;
const dai = "0x00000000000000000000000000000000000000d0" as Address;
const native = ZERO_PAYMENT_TOKEN as Address;
const seller = "0x00000000000000000000000000000000000000e0";
const NOW = 1_800_000_000;

function line(id: string, overrides: Partial<CrateBatchLine> = {}): CrateBatchLine {
  return {
    quoteLineId: id,
    listingId: BigInt(Number.parseInt(id.replace(/\D/g, "") || "1", 10)),
    amount: 1n,
    paymentToken: usdc,
    totalUnits: 1_000_000n,
    ...overrides,
  };
}

function listing(overrides: Partial<ChainListing> = {}): ChainListing {
  return {
    seller,
    amount: 5n,
    paymentToken: usdc,
    expiry: NOW + 3600,
    ...overrides,
  };
}

describe("listingMatchesQuote", () => {
  const base = line("l1");
  const check = (overrides: Partial<ChainListing>, margin?: number) =>
    listingMatchesQuote({ line: base, listing: listing(overrides), nowSeconds: NOW, marginSeconds: margin });

  it("accepts a listing that is the one quoted", () => {
    expect(check({})).toBe(true);
  });

  it("rejects a deleted listing, too few units, a different token and a near expiry", () => {
    expect(check({ seller: ZERO_PAYMENT_TOKEN })).toBe(false);
    expect(check({ amount: 0n })).toBe(false);
    expect(check({ paymentToken: dai })).toBe(false);
    expect(check({ expiry: NOW + 59 })).toBe(false);
    expect(check({ expiry: NOW + 60 })).toBe(true);
    expect(check({ expiry: BigInt(NOW + 59) })).toBe(false);
  });

  it("compares tokens without regard to case", () => {
    expect(check({ paymentToken: usdc.toUpperCase().replace("0X", "0x") })).toBe(true);
  });
});

describe("totalMatchesQuote", () => {
  it("needs the exact quoted total", () => {
    const target = line("l1", { totalUnits: 123n });
    expect(totalMatchesQuote(target, 123n)).toBe(true);
    expect(totalMatchesQuote(target, 124n)).toBe(false);
    expect(totalMatchesQuote(target, 122n)).toBe(false);
    expect(totalMatchesQuote(target, null)).toBe(false);
  });
});

describe("fitBalances", () => {
  const lines = [
    line("l1", { totalUnits: 4n }),
    line("l2", { paymentToken: dai, totalUnits: 10n }),
    line("l3", { totalUnits: 3n }),
    line("l4", { totalUnits: 2n }),
    line("l5", { paymentToken: native, totalUnits: 5n }),
  ];

  it("keeps everything when every balance covers its token", () => {
    const result = fitBalances(
      lines,
      new Map([
        [usdc.toLowerCase(), 9n],
        [dai.toLowerCase(), 10n],
        [native, 5n],
      ]),
    );
    expect(result.keep).toEqual(lines);
    expect(result.dropped).toEqual([]);
  });

  it("drops from the end of the quote order, per token, until it fits", () => {
    const result = fitBalances(
      lines,
      new Map([
        [usdc.toLowerCase(), 5n], // 4 + 3 + 2 = 9: drop l4 (7), then l3 (4)
        [dai.toLowerCase(), 10n],
        [native, 5n],
      ]),
    );
    expect(result.keep.map((entry) => entry.quoteLineId)).toEqual(["l1", "l2", "l5"]);
    expect(result.dropped).toEqual([
      { quoteLineId: "l3", reason: "insufficient_balance" },
      { quoteLineId: "l4", reason: "insufficient_balance" },
    ]);
  });

  it("treats an unknown balance as zero and drops that whole token", () => {
    const result = fitBalances(lines, new Map([[usdc.toLowerCase(), 100n], [dai.toLowerCase(), 100n]]));
    expect(result.keep.map((entry) => entry.quoteLineId)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(result.dropped).toEqual([{ quoteLineId: "l5", reason: "insufficient_balance" }]);
  });

  it("compares native lines against the native balance exactly", () => {
    const result = fitBalances([line("l1", { paymentToken: native, totalUnits: 9n })], new Map([[native, 8n]]));
    expect(result.keep).toEqual([]);
    expect(result.dropped).toEqual([{ quoteLineId: "l1", reason: "insufficient_balance" }]);
  });
});

describe("simulationVerdict", () => {
  const lines = [line("l1"), line("l2", { paymentToken: dai }), line("l3")];
  const plan = {
    owners: [
      { kind: "approve" as const, token: usdc },
      { kind: "approve" as const, token: dai },
      { kind: "buy" as const, quoteLineId: "l1" },
      { kind: "buy" as const, quoteLineId: "l2" },
      { kind: "buy" as const, quoteLineId: "l3" },
    ],
  };
  const ok: SimulatedCall = { status: "success" };
  const bad: SimulatedCall = { status: "failure" };

  it("is ok when every call succeeds", () => {
    expect(simulationVerdict(plan, lines, [ok, ok, ok, ok, ok])).toEqual({ kind: "ok" });
  });

  it("drops the line of the first failing buy", () => {
    expect(simulationVerdict(plan, lines, [ok, ok, ok, bad, bad])).toEqual({
      kind: "drop",
      dropped: [{ quoteLineId: "l2", reason: "simulation_failed" }],
    });
  });

  it("drops every line of a token whose approve fails", () => {
    expect(simulationVerdict(plan, lines, [bad, ok, ok, ok, ok])).toEqual({
      kind: "drop",
      dropped: [
        { quoteLineId: "l1", reason: "simulation_failed" },
        { quoteLineId: "l3", reason: "simulation_failed" },
      ],
    });
  });

  it("refuses a result list that does not match the batch", () => {
    expect(() => simulationVerdict(plan, lines, [ok, ok])).toThrow(/unexpected/);
  });
});

describe("isSimulationUnsupported", () => {
  it("recognises method-not-found and not-supported errors, however nested", () => {
    expect(isSimulationUnsupported({ code: -32601, message: "x" })).toBe(true);
    expect(isSimulationUnsupported({ code: -32004, message: "x" })).toBe(true);
    expect(isSimulationUnsupported({ name: "MethodNotFoundRpcError", message: "x" })).toBe(true);
    expect(isSimulationUnsupported(new Error("The method eth_simulateV1 does not exist / is not available"))).toBe(true);
    expect(isSimulationUnsupported(new Error("Method not found"))).toBe(true);
    expect(
      isSimulationUnsupported({ message: "request failed", cause: { cause: { code: -32601, message: "x" } } }),
    ).toBe(true);
  });

  it("does not treat a network failure or a refused batch as unsupported", () => {
    expect(isSimulationUnsupported(new Error("fetch failed"))).toBe(false);
    expect(isSimulationUnsupported(new Error("HTTP request failed. Status: 503"))).toBe(false);
    expect(isSimulationUnsupported({ code: -32000, message: "insufficient funds" })).toBe(false);
    expect(isSimulationUnsupported(null)).toBe(false);
  });
});

type FakeOptions = {
  listings?: Record<string, ChainListing>;
  totals?: Record<string, bigint | null>;
  balances?: Record<string, bigint>;
  /** Called with the calls; returns the per-call statuses, or throws. */
  simulate?: PreflightReader["simulate"];
};

function fakeReader(lines: readonly CrateBatchLine[], options: FakeOptions = {}) {
  const reader: PreflightReader = {
    getListing: vi.fn(async (listingId: bigint) => {
      const quoted = lines.find((candidate) => candidate.listingId === listingId);
      return (
        options.listings?.[listingId.toString()]
        ?? listing({ paymentToken: quoted?.paymentToken ?? usdc })
      );
    }),
    quoteBuyTotal: vi.fn(async (listingId: bigint) => {
      const key = listingId.toString();
      if (options.totals && key in options.totals) return options.totals[key];
      return lines.find((candidate) => candidate.listingId === listingId)?.totalUnits ?? null;
    }),
    balanceOf: vi.fn(async (token: Address) => options.balances?.[token.toLowerCase()] ?? 1_000_000_000n),
    simulate:
      options.simulate
      ?? vi.fn(async (_account: Address, calls) => calls.map(() => ({ status: "success" as const }))),
  };
  return reader;
}

async function run(lines: CrateBatchLine[], options: FakeOptions = {}) {
  const reader = fakeReader(lines, options);
  const result = await preflightWithReader({
    reader,
    marketplaceAddress: marketplace,
    buyer,
    lines,
    nowSeconds: NOW,
  });
  return { result, reader };
}

describe("preflightWithReader", () => {
  const three = [line("l1"), line("l2"), line("l3")];

  it("keeps every line that still holds and simulates the whole batch once", async () => {
    const { result, reader } = await run(three);
    expect(result.keep).toEqual(three);
    expect(result.dropped).toEqual([]);
    expect(result.simulation).toBe("ran");
    expect(reader.simulate).toHaveBeenCalledTimes(1);
    // One approve and three buys.
    expect((reader.simulate as ReturnType<typeof vi.fn>).mock.calls[0][1]).toHaveLength(4);
  });

  it("drops a line whose listing changed and never prices it twice", async () => {
    const { result, reader } = await run(three, {
      listings: { "2": listing({ seller: ZERO_PAYMENT_TOKEN }) },
    });
    expect(result.keep.map((entry) => entry.quoteLineId)).toEqual(["l1", "l3"]);
    expect(result.dropped).toEqual([{ quoteLineId: "l2", reason: "listing_changed" }]);
    // A deleted listing is not even priced.
    expect(reader.quoteBuyTotal).toHaveBeenCalledTimes(2);
  });

  it("drops a line whose price moved or whose quote the contract refuses", async () => {
    const { result } = await run(three, { totals: { "1": 1_000_001n, "3": null } });
    expect(result.keep.map((entry) => entry.quoteLineId)).toEqual(["l2"]);
    expect(result.dropped).toEqual([
      { quoteLineId: "l1", reason: "listing_changed" },
      { quoteLineId: "l3", reason: "listing_changed" },
    ]);
  });

  it("drops lines from the end when the balance is short, then simulates the rest", async () => {
    const { result, reader } = await run(three, { balances: { [usdc.toLowerCase()]: 2_000_000n } });
    expect(result.keep.map((entry) => entry.quoteLineId)).toEqual(["l1", "l2"]);
    expect(result.dropped).toEqual([{ quoteLineId: "l3", reason: "insufficient_balance" }]);
    expect((reader.simulate as ReturnType<typeof vi.fn>).mock.calls[0][1]).toHaveLength(3);
  });

  it("falls back to the reads when the RPC cannot simulate", async () => {
    const { result } = await run(three, {
      simulate: async () => {
        throw Object.assign(new Error("Method not found"), { code: -32601 });
      },
    });
    expect(result.simulation).toBe("unsupported");
    expect(result.keep).toEqual(three);
  });

  it("aborts, buying nothing, when the simulation fails for another reason", async () => {
    await expect(
      run(three, {
        simulate: async () => {
          throw new Error("fetch failed");
        },
      }),
    ).rejects.toThrow("fetch failed");
  });

  it("aborts when a chain read fails", async () => {
    const reader = fakeReader(three);
    reader.getListing = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    await expect(
      preflightWithReader({ reader, marketplaceAddress: marketplace, buyer, lines: three, nowSeconds: NOW }),
    ).rejects.toThrow("fetch failed");
  });

  it("drops the failing buy and simulates again until the batch passes", async () => {
    const attempts: number[] = [];
    const { result } = await run(three, {
      simulate: async (_account, calls) => {
        attempts.push(calls.length);
        // The buy of listing 2 fails while it is in the batch.
        return calls.map((_call, index) => ({
          status:
            attempts.length === 1 && index === 2 ? ("failure" as const) : ("success" as const),
        }));
      },
    });
    expect(attempts).toEqual([4, 3]);
    expect(result.keep.map((entry) => entry.quoteLineId)).toEqual(["l1", "l3"]);
    expect(result.dropped).toEqual([{ quoteLineId: "l2", reason: "simulation_failed" }]);
    expect(result.simulation).toBe("ran");
  });

  it("drops a whole token group when its approve fails", async () => {
    const mixed = [line("l1"), line("l2", { paymentToken: dai }), line("l3")];
    let first = true;
    const { result } = await run(mixed, {
      simulate: async (_account, calls) => {
        const failing = first;
        first = false;
        // calls: approve usdc, approve dai, buy l1, buy l2, buy l3
        return calls.map((_call, index) => ({
          status: failing && index === 0 ? ("failure" as const) : ("success" as const),
        }));
      },
    });
    expect(result.keep.map((entry) => entry.quoteLineId)).toEqual(["l2"]);
    expect(result.dropped).toEqual([
      { quoteLineId: "l1", reason: "simulation_failed" },
      { quoteLineId: "l3", reason: "simulation_failed" },
    ]);
  });

  it("buys nothing when every line fails the simulation, and stays bounded", async () => {
    const simulate = vi.fn(async (_account: Address, calls: readonly unknown[]) =>
      calls.map(() => ({ status: "failure" as const })),
    );
    const { result } = await run(three, { simulate });
    expect(result.keep).toEqual([]);
    expect(result.dropped.map((entry) => entry.quoteLineId)).toEqual(["l1", "l2", "l3"]);
    expect(result.dropped.every((entry) => entry.reason === "simulation_failed")).toBe(true);
    expect(simulate.mock.calls.length).toBeLessThanOrEqual(three.length + 1);
  });

  it("returns no lines to buy, and no simulation, when nothing survives the reads", async () => {
    const { result, reader } = await run(three, {
      listings: {
        "1": listing({ seller: ZERO_PAYMENT_TOKEN }),
        "2": listing({ seller: ZERO_PAYMENT_TOKEN }),
        "3": listing({ seller: ZERO_PAYMENT_TOKEN }),
      },
    });
    expect(result.keep).toEqual([]);
    expect(result.dropped).toHaveLength(3);
    expect(reader.simulate).not.toHaveBeenCalled();
  });

  it("reads each token balance once", async () => {
    const mixed = [line("l1"), line("l2"), line("l3", { paymentToken: native })];
    const { reader } = await run(mixed);
    expect(reader.balanceOf).toHaveBeenCalledTimes(2);
  });
});
