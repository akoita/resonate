import {
  AdaptiveBlockWindow,
  detectRangeLimitError,
  fetchWithAdaptiveWindow,
} from "../modules/shared/adaptive_block_window";

function makeLogger() {
  return { warn: jest.fn(), log: jest.fn() };
}

function makeWindow(configured: number, growAfterSuccesses?: number) {
  const logger = makeLogger();
  const window = new AdaptiveBlockWindow({
    configured,
    label: "test indexer",
    logger,
    growAfterSuccesses,
  });
  return { window, logger };
}

/** Provider stub rejecting any span wider than `cap` with `message(cap)`. */
function cappedProvider(cap: number, message: (cap: number) => string) {
  const calls: Array<[bigint, bigint]> = [];
  const fetch = jest.fn(async (from: bigint, to: bigint) => {
    calls.push([from, to]);
    if (to - from + 1n > BigInt(cap)) throw new Error(message(cap));
    return [`${from}-${to}`];
  });
  return { fetch, calls };
}

describe("detectRangeLimitError", () => {
  it.each([
    ["eth_getLogs is limited to a 200 range", "blocks", 200],
    ["eth_getLogs is limited to a 10,000 range", "blocks", 10000],
    ["block range is too wide", "blocks", null],
    ["block range too large", "blocks", null],
    ["query exceeds max block range 100000", "blocks", 100000],
    ["exceed maximum block range: 5000", "blocks", 5000],
    ["Block range limit exceeded.", "blocks", null],
    [
      "Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range.",
      "blocks",
      10,
    ],
    [
      "You can make eth_getLogs requests with up to a 2K block range and no limit on the response size",
      "blocks",
      2000,
    ],
    ["requested too many blocks from 0 to 5000, maximum is set to 2048", "blocks", 2048],
    ["ranges over 10000 blocks are not supported", "blocks", 10000],
    ["query returned more than 10000 results", "results", null],
    [
      "Log response size exceeded. Based on your parameters, this block range should work: [0x10, 0x2f]",
      "results",
      32,
    ],
  ])("classifies %j", (message, kind, statedLimit) => {
    expect(detectRangeLimitError(new Error(message))).toEqual({
      kind,
      statedLimit,
    });
  });

  it("reads the RPC message from a nested viem-style cause chain", () => {
    const rpcError = { message: "eth_getLogs is limited to a 200 range", code: -32614 };
    const wrapped = Object.assign(new Error("HTTP request failed."), {
      details: "Request failed",
      cause: rpcError,
    });
    expect(detectRangeLimitError(wrapped)).toEqual({ kind: "blocks", statedLimit: 200 });
  });

  it.each([
    "fetch failed",
    "execution reverted",
    "max fee per gas less than block base fee",
    "429 Too Many Requests",
    "header not found",
  ])("ignores unrelated error %j", (message) => {
    expect(detectRangeLimitError(new Error(message))).toBeNull();
  });

  it("ignores non-error values", () => {
    expect(detectRangeLimitError(undefined)).toBeNull();
    expect(detectRangeLimitError(42)).toBeNull();
  });
});

describe("fetchWithAdaptiveWindow", () => {
  it("jumps straight to a stated limit and retries the same fromBlock", async () => {
    const { window, logger } = makeWindow(1000);
    const provider = cappedProvider(200, (cap) => `eth_getLogs is limited to a ${cap} range`);

    const { result, toBlock } = await fetchWithAdaptiveWindow(window, 5000n, 9000n, provider.fetch);

    expect(provider.calls).toEqual([
      [5000n, 5999n],
      [5000n, 5199n],
    ]);
    expect(toBlock).toBe(5199n);
    expect(result).toEqual(["5000-5199"]);
    expect(window.size).toBe(200);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain("from 1000 to 200");
  });

  it("halves when no limit is stated, down to a span the provider accepts", async () => {
    const { window, logger } = makeWindow(1000);
    const provider = cappedProvider(200, () => "block range is too wide");

    const { toBlock } = await fetchWithAdaptiveWindow(window, 0n, 10_000n, provider.fetch);

    expect(provider.calls.map(([, to]) => to)).toEqual([999n, 499n, 249n, 124n]);
    expect(provider.calls.every(([from]) => from === 0n)).toBe(true);
    expect(toBlock).toBe(124n);
    expect(window.size).toBe(125);
    // One warning for the whole adaptation, not one per halving.
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("covers every block exactly once while catching up through a capped provider", async () => {
    const { window, logger } = makeWindow(1000);
    const provider = cappedProvider(200, () => "block range too large");
    const covered: Array<[bigint, bigint]> = [];
    let from = 100n;
    const tip = 3_456n;

    while (from <= tip) {
      const { toBlock } = await fetchWithAdaptiveWindow(window, from, tip, provider.fetch);
      covered.push([from, toBlock]);
      from = toBlock + 1n;
    }

    expect(covered[0][0]).toBe(100n);
    expect(covered[covered.length - 1][1]).toBe(tip);
    for (let i = 1; i < covered.length; i++) {
      expect(covered[i][0]).toBe(covered[i - 1][1] + 1n);
    }
    // Only the first batch needed retries; the reduced window then stuck.
    expect(provider.fetch.mock.calls.length).toBe(covered.length + 3);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("shrinks from the clamped span at the chain tip, not the full window", async () => {
    const { window } = makeWindow(1000);
    const provider = cappedProvider(20, () => "query returned more than 10000 results");

    const { toBlock } = await fetchWithAdaptiveWindow(window, 100n, 149n, provider.fetch);

    expect(provider.calls).toEqual([
      [100n, 149n],
      [100n, 124n],
      [100n, 111n],
    ]);
    expect(toBlock).toBe(111n);
    expect(window.size).toBe(12);
  });

  it("rethrows other RPC errors without shrinking", async () => {
    const { window, logger } = makeWindow(1000);
    const error = new Error("fetch failed");
    const fetch = jest.fn().mockRejectedValue(error);

    await expect(fetchWithAdaptiveWindow(window, 0n, 5000n, fetch)).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(window.size).toBe(1000);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("stops at a one-block floor and surfaces the error", async () => {
    const { window, logger } = makeWindow(4);
    const error = new Error("block range is too wide");
    const fetch = jest.fn().mockRejectedValue(error);

    await expect(fetchWithAdaptiveWindow(window, 10n, 5000n, fetch)).rejects.toBe(error);
    expect(fetch.mock.calls.map(([from, to]) => [from, to])).toEqual([
      [10n, 13n],
      [10n, 11n],
      [10n, 10n],
    ]);
    expect(window.size).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("settles on a one-block window when the provider states a limit of one", async () => {
    const { window } = makeWindow(10);
    const provider = cappedProvider(1, () => "eth_getLogs is limited to a 1 range");

    const { toBlock } = await fetchWithAdaptiveWindow(window, 7n, 100n, provider.fetch);

    expect(toBlock).toBe(7n);
    expect(window.size).toBe(1);
  });
});

describe("AdaptiveBlockWindow growth", () => {
  it("never grows back after a hard block-range cap", async () => {
    const { window } = makeWindow(1000, 2);
    const provider = cappedProvider(200, (cap) => `eth_getLogs is limited to a ${cap} range`);
    let from = 0n;
    for (let i = 0; i < 10; i++) {
      const { toBlock } = await fetchWithAdaptiveWindow(window, from, 1_000_000n, provider.fetch);
      from = toBlock + 1n;
    }
    expect(window.size).toBe(200);
    // One rejection, then ten accepted batches.
    expect(provider.fetch).toHaveBeenCalledTimes(11);
  });

  it("grows back toward the configured window after a result-count limit", async () => {
    const { window, logger } = makeWindow(1000, 3);
    let dense = true;
    const fetch = jest.fn(async (from: bigint, to: bigint) => {
      if (dense && to - from + 1n > 300n) {
        throw new Error("query returned more than 10000 results");
      }
      return [];
    });

    await fetchWithAdaptiveWindow(window, 0n, 1_000_000n, fetch);
    expect(window.size).toBe(250);

    dense = false;
    let from = 250n;
    for (let i = 0; i < 9; i++) {
      const { toBlock } = await fetchWithAdaptiveWindow(window, from, 1_000_000n, fetch);
      from = toBlock + 1n;
    }
    expect(window.size).toBe(1000);
    expect(logger.log).toHaveBeenCalledTimes(2);
  });
});
