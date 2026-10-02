/**
 * Checks a crate quote against the chain right before the DJ signs (#1964).
 *
 * The quote was priced from the chain a few minutes ago. Before the one
 * signature, each line is read again (`getListing`, `quoteBuy`), the buyer's
 * balances are compared with what the remaining lines cost, and, when the RPC
 * supports `eth_simulateV1`, the final batch is simulated. A line that no longer
 * holds is left out and reported with a fixed reason; it is never bought.
 *
 * The decisions are pure functions over plain values. Chain access sits behind
 * {@link PreflightReader} so the decisions are tested with fakes.
 */

import { type Address, type Hex, type PublicClient } from "viem";
import { StemMarketplaceABI } from "../contracts_abi";
import {
  buildCrateBatchPlan,
  type CrateBatchCall,
  type CrateBatchLine,
  type CrateBatchPlan,
} from "./onchainCheckout";
import { ZERO_PAYMENT_TOKEN } from "./payments";

/** A listing must outlive the signing step by at least this long. */
export const LISTING_EXPIRY_MARGIN_SECONDS = 60;

/** How many chain reads run at once. */
const READ_CONCURRENCY = 6;

export type PreflightDropReason = "listing_changed" | "insufficient_balance" | "simulation_failed";

export type PreflightDrop = { quoteLineId: string; reason: PreflightDropReason };

export type PreflightResult = {
  /** The lines still safe to buy, in quote order. */
  keep: CrateBatchLine[];
  /** The lines left out, each with why. */
  dropped: PreflightDrop[];
  /** Whether the final batch was simulated, or only the reads decided. */
  simulation: "ran" | "unsupported";
};

/** A listing as the contract returns it. */
export type ChainListing = {
  seller: string;
  amount: bigint;
  paymentToken: string;
  expiry: bigint | number;
};

export type SimulatedCall = { status: "success" | "failure" };

export type PreflightReader = {
  getListing(listingId: bigint): Promise<ChainListing>;
  /** The total for `amount` units, or null when the contract refuses the quote. */
  quoteBuyTotal(listingId: bigint, amount: bigint): Promise<bigint | null>;
  /** The native balance when `token` is the zero address, else the token balance. */
  balanceOf(token: Address, account: Address): Promise<bigint>;
  /** One result per call, in order. Throws when the RPC cannot simulate. */
  simulate(account: Address, calls: readonly CrateBatchCall[]): Promise<SimulatedCall[]>;
};

const ZERO_ADDRESS = ZERO_PAYMENT_TOKEN;

/* ------------------------------------------------------------------ */
/* Pure decisions                                                      */
/* ------------------------------------------------------------------ */

/**
 * Whether the listing still looks like the one quoted: it exists, still has the
 * units, has not expired (or will not within the margin) and is paid in the
 * quoted token.
 */
export function listingMatchesQuote(input: {
  line: Pick<CrateBatchLine, "amount" | "paymentToken">;
  listing: ChainListing;
  nowSeconds: number;
  marginSeconds?: number;
}): boolean {
  const { line, listing } = input;
  if (listing.seller.toLowerCase() === ZERO_ADDRESS) return false;
  if (listing.amount < line.amount) return false;
  const margin = input.marginSeconds ?? LISTING_EXPIRY_MARGIN_SECONDS;
  if (BigInt(listing.expiry) < BigInt(input.nowSeconds + margin)) return false;
  if (listing.paymentToken.toLowerCase() !== line.paymentToken.toLowerCase()) return false;
  return true;
}

/** The chain's price must be exactly the quoted one: the DJ approved that number. */
export function totalMatchesQuote(line: Pick<CrateBatchLine, "totalUnits">, total: bigint | null): boolean {
  return total !== null && total === line.totalUnits;
}

/**
 * Drops lines from the END of the quote order, token by token, until what is
 * left costs no more than the balance of that token. A token with no known
 * balance counts as zero. Native lines are compared against the native
 * balance; gas is not assumed (a paymaster may sponsor it).
 */
export function fitBalances(
  lines: readonly CrateBatchLine[],
  balances: ReadonlyMap<string, bigint>,
): { keep: CrateBatchLine[]; dropped: PreflightDrop[] } {
  const spent = new Map<string, bigint>();
  for (const line of lines) {
    const key = line.paymentToken.toLowerCase();
    spent.set(key, (spent.get(key) ?? 0n) + line.totalUnits);
  }

  const dropIds = new Set<string>();
  for (const [key, total] of spent) {
    let remaining = total;
    const balance = balances.get(key) ?? 0n;
    for (let index = lines.length - 1; index >= 0 && remaining > balance; index -= 1) {
      const line = lines[index];
      if (line.paymentToken.toLowerCase() !== key) continue;
      dropIds.add(line.quoteLineId);
      remaining -= line.totalUnits;
    }
  }

  return {
    keep: lines.filter((line) => !dropIds.has(line.quoteLineId)),
    dropped: lines
      .filter((line) => dropIds.has(line.quoteLineId))
      .map((line) => ({ quoteLineId: line.quoteLineId, reason: "insufficient_balance" as const })),
  };
}

export type SimulationVerdict =
  | { kind: "ok" }
  | { kind: "drop"; dropped: PreflightDrop[] };

/**
 * Reads the simulation of a planned batch. The first failing call decides: a
 * failing buy drops its line; a failing approve drops every line paid in that
 * token, because none of them can be bought without it.
 */
export function simulationVerdict(
  plan: Pick<CrateBatchPlan, "owners">,
  lines: readonly CrateBatchLine[],
  results: readonly SimulatedCall[],
): SimulationVerdict {
  if (results.length !== plan.owners.length) {
    throw new Error("The simulation returned an unexpected result");
  }
  const failed = results.findIndex((result) => result.status !== "success");
  if (failed === -1) return { kind: "ok" };

  const owner = plan.owners[failed];
  if (owner.kind === "buy") {
    return { kind: "drop", dropped: [{ quoteLineId: owner.quoteLineId, reason: "simulation_failed" }] };
  }
  const token = owner.token.toLowerCase();
  return {
    kind: "drop",
    dropped: lines
      .filter((line) => line.paymentToken.toLowerCase() === token)
      .map((line) => ({ quoteLineId: line.quoteLineId, reason: "simulation_failed" as const })),
  };
}

const UNSUPPORTED_CODES = new Set([-32601, -32004, 4200]);
const UNSUPPORTED_TEXT =
  /method[^.]{0,40}(not found|not supported|does not exist|not available|unsupported)|unsupported[^.]{0,20}method|eth_simulatev1[^.]{0,60}(not|unsupported|unknown)|not implemented|unknown method/i;

/**
 * Whether a simulation error just means the RPC cannot simulate (method not
 * found or not supported), as opposed to the network failing or the batch
 * being refused. Walks the error's causes.
 */
export function isSimulationUnsupported(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    const candidate = current as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      shortMessage?: unknown;
      details?: unknown;
      cause?: unknown;
    };
    if (typeof candidate.code === "number" && UNSUPPORTED_CODES.has(candidate.code)) return true;
    if (
      typeof candidate.name === "string"
      && /^(MethodNotFoundRpcError|MethodNotSupportedRpcError|UnsupportedProviderMethodError|SimulationUnsupportedError)$/.test(
        candidate.name,
      )
    ) {
      return true;
    }
    for (const text of [candidate.shortMessage, candidate.details, candidate.message]) {
      if (typeof text === "string" && UNSUPPORTED_TEXT.test(text)) return true;
    }
    current = candidate.cause;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* The preflight                                                       */
/* ------------------------------------------------------------------ */

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Runs the whole preflight with a reader. A chain read that fails (the network,
 * not a refused quote) throws: nothing is decided from a read that did not
 * happen, and nothing is sent.
 */
export async function preflightWithReader(input: {
  reader: PreflightReader;
  marketplaceAddress: Address;
  buyer: Address;
  lines: readonly CrateBatchLine[];
  nowSeconds?: number;
}): Promise<PreflightResult> {
  const { reader } = input;
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const dropped: PreflightDrop[] = [];

  // 1. Each line against its listing and the contract's own price.
  const holds = await mapWithConcurrency(input.lines, READ_CONCURRENCY, async (line) => {
    const listing = await reader.getListing(line.listingId);
    if (!listingMatchesQuote({ line, listing, nowSeconds })) return false;
    const total = await reader.quoteBuyTotal(line.listingId, line.amount);
    return totalMatchesQuote(line, total);
  });
  let keep: CrateBatchLine[] = [];
  input.lines.forEach((line, index) => {
    if (holds[index]) keep.push(line);
    else dropped.push({ quoteLineId: line.quoteLineId, reason: "listing_changed" });
  });

  // 2. The buyer's balance per token against what the remaining lines cost.
  const tokens = new Map<string, Address>();
  for (const line of keep) tokens.set(line.paymentToken.toLowerCase(), line.paymentToken);
  const entries = await mapWithConcurrency([...tokens.entries()], READ_CONCURRENCY, async ([key, token]) => {
    return [key, await reader.balanceOf(token, input.buyer)] as const;
  });
  const fitted = fitBalances(keep, new Map(entries));
  keep = fitted.keep;
  dropped.push(...fitted.dropped);

  // 3. Simulate the final batch when the RPC can; drop what fails and look again.
  let simulation: PreflightResult["simulation"] = "unsupported";
  let verified = false;
  for (let attempt = 0; attempt <= input.lines.length && keep.length > 0; attempt += 1) {
    const plan = buildCrateBatchPlan({ marketplaceAddress: input.marketplaceAddress, lines: keep });
    let results: SimulatedCall[];
    try {
      results = await reader.simulate(input.buyer, plan.calls);
    } catch (error) {
      if (isSimulationUnsupported(error)) {
        simulation = "unsupported";
        break;
      }
      throw error;
    }
    simulation = "ran";
    const verdict = simulationVerdict(plan, keep, results);
    if (verdict.kind === "ok") {
      verified = true;
      break;
    }
    const gone = new Set(verdict.dropped.map((entry) => entry.quoteLineId));
    dropped.push(...verdict.dropped);
    keep = keep.filter((line) => !gone.has(line.quoteLineId));
  }
  if (simulation === "ran" && !verified && keep.length > 0) {
    // Bounded and still failing: buy nothing that was never confirmed.
    dropped.push(...keep.map((line) => ({ quoteLineId: line.quoteLineId, reason: "simulation_failed" as const })));
    keep = [];
  }

  // Report in quote order so the screen reads the same way the quote does.
  const order = new Map(input.lines.map((line, index) => [line.quoteLineId, index]));
  dropped.sort((a, b) => (order.get(a.quoteLineId) ?? 0) - (order.get(b.quoteLineId) ?? 0));
  return { keep, dropped, simulation };
}

/* ------------------------------------------------------------------ */
/* The viem reader                                                     */
/* ------------------------------------------------------------------ */

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Whether a read failed because the contract refused it (not the network). */
function isContractRevert(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { name?: unknown; cause?: unknown };
    if (candidate.name === "ContractFunctionRevertedError") return true;
    current = candidate.cause;
  }
  return false;
}

type SimulateCallsFn = (
  client: unknown,
  params: {
    account: Address;
    calls: Array<{ to: Address; data: Hex; value?: bigint }>;
  },
) => Promise<{ results: Array<{ status: string }> }>;

class SimulationUnsupportedError extends Error {
  constructor() {
    super("This network connection cannot simulate a batch");
    this.name = "SimulationUnsupportedError";
  }
}

/** viem's `simulateCalls` (eth_simulateV1), from the client or the actions entry. */
async function resolveSimulateCalls(client: PublicClient): Promise<SimulateCallsFn> {
  const decorated = (client as unknown as { simulateCalls?: unknown }).simulateCalls;
  if (typeof decorated === "function") {
    return (_client, params) =>
      (decorated as (params: unknown) => Promise<{ results: Array<{ status: string }> }>).call(client, params);
  }
  const actions = (await import("viem/actions")) as unknown as { simulateCalls?: SimulateCallsFn };
  if (typeof actions.simulateCalls === "function") return actions.simulateCalls;
  throw new SimulationUnsupportedError();
}

/** Reads the quote's own marketplace, never a configured default. */
export function createViemPreflightReader(
  client: PublicClient,
  marketplaceAddress: Address,
): PreflightReader {
  return {
    async getListing(listingId) {
      const listing = await client.readContract({
        address: marketplaceAddress,
        abi: StemMarketplaceABI,
        functionName: "getListing",
        args: [listingId],
      });
      return {
        seller: listing.seller,
        amount: listing.amount,
        paymentToken: listing.paymentToken,
        expiry: listing.expiry,
      };
    },
    async quoteBuyTotal(listingId, amount) {
      try {
        const result = await client.readContract({
          address: marketplaceAddress,
          abi: StemMarketplaceABI,
          functionName: "quoteBuy",
          args: [listingId, amount],
        });
        return result[0];
      } catch (error) {
        if (isContractRevert(error)) return null;
        throw error;
      }
    },
    async balanceOf(token, account) {
      if (token.toLowerCase() === ZERO_ADDRESS) return client.getBalance({ address: account });
      return client.readContract({
        address: token,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [account],
      });
    },
    async simulate(account, calls) {
      const simulateCalls = await resolveSimulateCalls(client);
      const { results } = await simulateCalls(client, {
        account,
        calls: calls.map((call) => ({ to: call.to, data: call.data, value: call.value })),
      });
      return results.map((result) => ({
        status: result.status === "success" ? ("success" as const) : ("failure" as const),
      }));
    },
  };
}

/** The preflight against a real public client. */
export function runCratePreflight(input: {
  publicClient: PublicClient;
  marketplaceAddress: Address;
  buyer: Address;
  lines: readonly CrateBatchLine[];
}): Promise<PreflightResult> {
  return preflightWithReader({
    reader: createViemPreflightReader(input.publicClient, input.marketplaceAddress),
    marketplaceAddress: input.marketplaceAddress,
    buyer: input.buyer,
    lines: input.lines,
  });
}
