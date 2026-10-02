import { encodeFunctionData, type Address, type Hex } from "viem";
import { StemMarketplaceABI } from "../contracts_abi";
import { ZERO_PAYMENT_TOKEN } from "./payments";

export const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export type DirectMarketplaceBuyCall = {
  to: Address;
  data: Hex;
};

export type DirectMarketplaceBuyPlan = {
  rail: "native" | "erc20";
  value: bigint;
  calls: DirectMarketplaceBuyCall[];
};

export function buildDirectMarketplaceBuyPlan(input: {
  marketplaceAddress: Address;
  listingId: bigint;
  amount: bigint;
  paymentToken: Address;
  totalPrice: bigint;
}): DirectMarketplaceBuyPlan {
  const buyCall = {
    to: input.marketplaceAddress,
    data: encodeFunctionData({
      abi: StemMarketplaceABI,
      functionName: "buy",
      args: [input.listingId, input.amount],
    }),
  };

  if (input.paymentToken.toLowerCase() === ZERO_PAYMENT_TOKEN) {
    return {
      rail: "native",
      value: input.totalPrice,
      calls: [buyCall],
    };
  }

  return {
    rail: "erc20",
    value: 0n,
    calls: [
      {
        to: input.paymentToken,
        data: encodeFunctionData({
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [input.marketplaceAddress, input.totalPrice],
        }),
      },
      buyCall,
    ],
  };
}

/* ------------------------------------------------------------------ */
/* One batched purchase for a crate quote (#1964)                      */
/* ------------------------------------------------------------------ */

export type CrateBatchLine = {
  /** The quote line this buy settles; reported back when the line is left out. */
  quoteLineId: string;
  listingId: bigint;
  amount: bigint;
  paymentToken: Address;
  /** What the quote says this line costs, in payment-token units. */
  totalUnits: bigint;
};

export type CrateBatchCall = {
  to: Address;
  data: Hex;
  /** Native value; non-zero only on a buy paid in the native token. */
  value: bigint;
};

/** What a call of the batch belongs to, in the same order as `calls`. */
export type CrateBatchCallOwner =
  | { kind: "approve"; token: Address }
  | { kind: "buy"; quoteLineId: string };

export type CrateBatchPlan = {
  calls: CrateBatchCall[];
  /** One entry per distinct non-native token: the exact sum approved. */
  approvals: Array<{ token: Address; totalUnits: bigint }>;
  /** Sum of the native-token lines; the account must hold at least this. */
  nativeValue: bigint;
  owners: CrateBatchCallOwner[];
};

/**
 * Plans a whole crate quote as one batch: one `approve(marketplace, sum)` per
 * distinct non-native token first, then one `buy(listingId, amount)` per line in
 * quote order. Native lines carry their own `value`; ERC-20 lines carry none.
 * The batch always holds at least one buy: no lines is an error, never an empty
 * transaction. Amounts stay bigint end to end.
 */
export function buildCrateBatchPlan(input: {
  marketplaceAddress: Address;
  lines: readonly CrateBatchLine[];
}): CrateBatchPlan {
  if (input.lines.length === 0) {
    throw new Error("A crate purchase needs at least one line to buy");
  }

  const seen = new Set<string>();
  const sums = new Map<string, { token: Address; totalUnits: bigint }>();
  let nativeValue = 0n;
  for (const line of input.lines) {
    if (seen.has(line.quoteLineId)) {
      throw new Error(`Quote line ${line.quoteLineId} appears twice in the purchase`);
    }
    seen.add(line.quoteLineId);
    if (line.amount <= 0n || line.totalUnits <= 0n || line.listingId < 0n) {
      throw new Error(`Quote line ${line.quoteLineId} has an invalid amount or price`);
    }
    const key = line.paymentToken.toLowerCase();
    if (key === ZERO_PAYMENT_TOKEN) {
      nativeValue += line.totalUnits;
      continue;
    }
    const existing = sums.get(key);
    if (existing) existing.totalUnits += line.totalUnits;
    else sums.set(key, { token: line.paymentToken, totalUnits: line.totalUnits });
  }

  const approvals = [...sums.values()];
  const calls: CrateBatchCall[] = [];
  const owners: CrateBatchCallOwner[] = [];

  for (const approval of approvals) {
    calls.push({
      to: approval.token,
      data: encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [input.marketplaceAddress, approval.totalUnits],
      }),
      value: 0n,
    });
    owners.push({ kind: "approve", token: approval.token });
  }

  for (const line of input.lines) {
    const native = line.paymentToken.toLowerCase() === ZERO_PAYMENT_TOKEN;
    calls.push({
      to: input.marketplaceAddress,
      data: encodeFunctionData({
        abi: StemMarketplaceABI,
        functionName: "buy",
        args: [line.listingId, line.amount],
      }),
      value: native ? line.totalUnits : 0n,
    });
    owners.push({ kind: "buy", quoteLineId: line.quoteLineId });
  }

  return { calls, approvals, nativeValue, owners };
}
