"use client";

import { useCallback, useState } from "react";
import { encodeFunctionData, formatUnits, type Address, type Hex } from "viem";
import { useAuth } from "../components/auth/AuthProvider";
import { useZeroDev } from "../components/auth/ZeroDevProviderClient";
import {
  confirmPledge,
  confirmPledgeRefund,
  type Campaign,
  type ShowPledgeConfirmation,
  type ShowPledgeIntent,
  type ShowPledgeReceipt,
} from "../lib/shows";
import { ZERO_PAYMENT_TOKEN } from "../lib/payments";
import { sendBatchContractTransactions } from "./useContracts";

const SHOW_CAMPAIGN_ESCROW_ABI = [
  {
    type: "function",
    name: "pledge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "campaignId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const ERC20_PLEDGE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
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
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const SHOW_CAMPAIGN_REFUND_ABI = [
  {
    type: "function",
    name: "claimRefund",
    stateMutability: "nonpayable",
    inputs: [{ name: "campaignId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refundable",
    stateMutability: "view",
    inputs: [
      { name: "campaignId", type: "uint256" },
      { name: "backer", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type PledgeCall = { to: Address; data: Hex; value?: bigint };

export type ShowPledgeExecutionPhase =
  | "idle"
  | "checking"
  | "signing"
  | "confirming"
  | "confirmed"
  | "failed";

export type ShowPledgeExecutionResult = {
  transactionHash: string;
  blockNumber?: string;
  confirmation: ShowPledgeConfirmation;
};

async function buildPledgeCalls(input: {
  intent: ShowPledgeIntent;
  payer: Address;
  publicClient: ReturnType<typeof useZeroDev>["publicClient"];
}): Promise<PledgeCall[]> {
  const { contractCall } = input.intent;
  if (!contractCall) {
    throw new Error("This pledge receipt is not linked to an escrow contract yet.");
  }

  const escrowAddress = contractCall.contractAddress as Address;
  const amount = BigInt(contractCall.args[1]);
  const paymentToken = contractCall.paymentTokenAddress as Address | null;
  const paymentSymbol = input.intent.pledge.paymentAssetSymbol ?? input.intent.pledge.currency;
  const decimals = input.intent.pledge.paymentAssetDecimals;

  if (!paymentToken || paymentToken.toLowerCase() === ZERO_PAYMENT_TOKEN) {
    throw new Error("This campaign escrow requires an ERC-20 payment token before pledges can be executed.");
  }

  const [balance, allowance] = await Promise.all([
    input.publicClient.readContract({
      address: paymentToken,
      abi: ERC20_PLEDGE_ABI,
      functionName: "balanceOf",
      args: [input.payer],
    }) as Promise<bigint>,
    input.publicClient.readContract({
      address: paymentToken,
      abi: ERC20_PLEDGE_ABI,
      functionName: "allowance",
      args: [input.payer, escrowAddress],
    }) as Promise<bigint>,
  ]);

  if (balance < amount) {
    throw new Error(
      `Your smart account needs ${formatUnits(amount, decimals)} ${paymentSymbol} to pledge. Current balance: ${formatUnits(balance, decimals)} ${paymentSymbol}.`,
    );
  }

  const calls: PledgeCall[] = [];
  if (allowance < amount) {
    if (allowance > 0n) {
      calls.push({
        to: paymentToken,
        data: encodeFunctionData({
          abi: ERC20_PLEDGE_ABI,
          functionName: "approve",
          args: [escrowAddress, 0n],
        }),
      });
    }
    calls.push({
      to: paymentToken,
      data: encodeFunctionData({
        abi: ERC20_PLEDGE_ABI,
        functionName: "approve",
        args: [escrowAddress, amount],
      }),
    });
  }

  calls.push({
    to: escrowAddress,
    data: encodeFunctionData({
      abi: SHOW_CAMPAIGN_ESCROW_ABI,
      functionName: "pledge",
      args: [BigInt(contractCall.args[0]), amount],
    }),
    value: BigInt(contractCall.value),
  });

  return calls;
}

export function useShowPledgeExecution() {
  const { publicClient, chainId } = useZeroDev();
  const { address, smartAccountAddress, status, token, kernelAccount } = useAuth();
  const [phase, setPhase] = useState<ShowPledgeExecutionPhase>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const executePledge = useCallback(
    async (intent: ShowPledgeIntent): Promise<ShowPledgeExecutionResult> => {
      if (status !== "authenticated" || !token) {
        throw new Error("Wallet not connected");
      }
      if (!intent.contractCall) {
        throw new Error("This pledge receipt is not linked to an escrow contract yet.");
      }
      if (intent.contractCall.chainId !== chainId) {
        throw new Error(`Switch to chain ${intent.contractCall.chainId} to pledge to this campaign.`);
      }

      const payer = (smartAccountAddress || address) as Address | null;
      if (!payer) {
        throw new Error("Smart account address is not available.");
      }

      setPhase("checking");
      setError(null);
      setTxHash(null);

      try {
        const calls = await buildPledgeCalls({ intent, payer, publicClient });

        setPhase("signing");
        const transactionHash = await sendBatchContractTransactions(
          publicClient,
          chainId,
          calls,
          payer,
          kernelAccount,
        );
        setTxHash(transactionHash);

        setPhase("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: transactionHash as Hex,
        });
        const confirmationStatus = receipt.status === "success" ? "confirmed" : "failed";
        const confirmation = await confirmPledge({
          pledgeId: intent.pledge.id,
          token,
          transactionHash,
          confirmationStatus,
          blockNumber: receipt.blockNumber.toString(),
          receipt: {
            chainId,
            transactionHash,
            status: receipt.status,
            gasUsed: receipt.gasUsed.toString(),
          },
        });

        if (confirmationStatus === "failed") {
          throw new Error("Pledge transaction was mined but reverted.");
        }

        setPhase("confirmed");
        return {
          transactionHash,
          blockNumber: receipt.blockNumber.toString(),
          confirmation,
        };
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        setPhase("failed");
        throw nextError;
      }
    },
    [address, chainId, kernelAccount, publicClient, smartAccountAddress, status, token],
  );

  return {
    executePledge,
    phase,
    pending: phase === "checking" || phase === "signing" || phase === "confirming",
    error,
    txHash,
  };
}

export function useShowRefundExecution() {
  const { publicClient, chainId } = useZeroDev();
  const { address, smartAccountAddress, status, token, kernelAccount } = useAuth();
  const [phase, setPhase] = useState<ShowPledgeExecutionPhase>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const claimRefund = useCallback(
    async (input: {
      pledge: ShowPledgeReceipt;
      campaign: Campaign;
    }): Promise<ShowPledgeExecutionResult> => {
      if (status !== "authenticated" || !token) {
        throw new Error("Wallet not connected");
      }
      if (input.pledge.chainId !== chainId) {
        throw new Error(`Switch to chain ${input.pledge.chainId} to claim this refund.`);
      }

      const payer = (smartAccountAddress || address) as Address | null;
      if (!payer) {
        throw new Error("Smart account address is not available.");
      }

      const contractAddress = (
        input.pledge.campaign?.contractAddress ?? input.campaign.escrowContractAddress
      ) as Address | null;
      const contractCampaignId = input.pledge.campaign?.contractCampaignId ?? input.campaign.contractCampaignId;
      if (!contractAddress || !contractCampaignId) {
        throw new Error("This pledge is not linked to an escrow campaign refund call.");
      }

      setPhase("checking");
      setError(null);
      setTxHash(null);

      try {
        const refundable = await publicClient.readContract({
          address: contractAddress,
          abi: SHOW_CAMPAIGN_REFUND_ABI,
          functionName: "refundable",
          args: [BigInt(contractCampaignId), payer],
        }) as bigint;

        if (refundable <= 0n) {
          throw new Error("No refundable pledge balance is available for this smart account.");
        }

        setPhase("signing");
        const transactionHash = await sendBatchContractTransactions(
          publicClient,
          chainId,
          [
            {
              to: contractAddress,
              data: encodeFunctionData({
                abi: SHOW_CAMPAIGN_REFUND_ABI,
                functionName: "claimRefund",
                args: [BigInt(contractCampaignId)],
              }),
            },
          ],
          payer,
          kernelAccount,
        );
        setTxHash(transactionHash);

        setPhase("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: transactionHash as Hex,
        });
        if (receipt.status !== "success") {
          throw new Error("Refund transaction was mined but reverted.");
        }

        const confirmation = await confirmPledgeRefund({
          pledgeId: input.pledge.id,
          token,
          transactionHash,
          blockNumber: receipt.blockNumber.toString(),
          receipt: {
            chainId,
            transactionHash,
            status: receipt.status,
            gasUsed: receipt.gasUsed.toString(),
          },
        });

        setPhase("confirmed");
        return {
          transactionHash,
          blockNumber: receipt.blockNumber.toString(),
          confirmation,
        };
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        setPhase("failed");
        throw nextError;
      }
    },
    [address, chainId, kernelAccount, publicClient, smartAccountAddress, status, token],
  );

  return {
    claimRefund,
    phase,
    pending: phase === "checking" || phase === "signing" || phase === "confirming",
    error,
    txHash,
  };
}
