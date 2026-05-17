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
