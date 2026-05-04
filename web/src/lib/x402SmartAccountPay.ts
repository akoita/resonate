import {
  createPublicClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from "viem";
import { createZeroDevPaymasterClient, createKernelAccountClient } from "@zerodev/sdk";
import { API_BASE } from "./api";
import { getBundlerUrl, isLocalDevEnvironment } from "./bundlerConfig";
import { normalizeContractWriteError } from "./contractErrors";
import { getX402Chain } from "./x402BrowserWallet";
import { getX402KernelAccount } from "./x402KernelAccount";
import { decodeAudioResponse, type X402PaymentResult } from "./x402Pay";

type X402SmartAccountStatus = "signing" | "settling" | "downloading";

type PayStemWithX402SmartAccountInput = {
  stemId: string;
  webAuthnKey: unknown;
  chainId: number;
  assetAddress: Address;
  payTo: Address;
  amountUnits: string;
  onStatus?: (status: X402SmartAccountStatus) => void;
  onPayer?: (address: Address) => void;
};

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export async function payStemWithX402SmartAccount(
  input: PayStemWithX402SmartAccountInput,
): Promise<X402PaymentResult> {
  const chain = getX402Chain(input.chainId);
  const publicClient = createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });

  input.onStatus?.("signing");
  const account = await getX402KernelAccount({
    webAuthnKey: input.webAuthnKey,
    publicClient,
    chainId: input.chainId,
  });
  input.onPayer?.(account.address);
  const transferData = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [input.payTo, BigInt(input.amountUnits)],
  });
  const txHash = await sendSmartAccountCall({
    account,
    chainId: input.chainId,
    chain,
    to: input.assetAddress,
    data: transferData,
  });

  input.onStatus?.("settling");
  const response = await fetch(
    `${API_BASE}/api/stems/${encodeURIComponent(input.stemId)}/x402/smart-account`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txHash,
        payer: account.address,
      }),
    },
  );

  if (!response.ok) {
    let reason: string | null = null;
    try {
      const body = await response.clone().json();
      if (body && typeof body === "object") {
        reason = (body as { message?: string; error?: string }).message
          ?? (body as { error?: string }).error
          ?? null;
      }
    } catch {
      // The endpoint returns audio on success; failed responses may not be JSON.
    }
    throw new Error(
      reason
        ? `x402 smart-account payment failed (HTTP ${response.status}): ${reason}`
        : `x402 smart-account payment failed: HTTP ${response.status}`,
    );
  }

  input.onStatus?.("downloading");
  return decodeAudioResponse(response);
}

function createMappedTransport(bundlerUrl: string) {
  const baseTransport = http(bundlerUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (opts: any) => {
    const transport = baseTransport(opts);
    const originalRequest = transport.request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport.request = async (args: any) => {
      const mappedArgs = { ...args };
      if (args.method === "zd_getUserOperationGasPrice") {
        mappedArgs.method = "pimlico_getUserOperationGasPrice";
      }
      return originalRequest(mappedArgs);
    };
    return transport;
  };
}

async function sendSmartAccountCall(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  account: any;
  chainId: number;
  chain: ReturnType<typeof getX402Chain>;
  to: Address;
  data: Hex;
}) {
  const bundlerUrl = getBundlerUrl(input.chainId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientOpts: any = {
    account: input.account,
    chain: input.chain,
    bundlerTransport: createMappedTransport(bundlerUrl),
  };

  if (!isLocalDevEnvironment(input.chainId)) {
    clientOpts.paymaster = createZeroDevPaymasterClient({
      chain: input.chain,
      transport: http(bundlerUrl),
    });
  }

  const kernelClient = await createKernelAccountClient(clientOpts);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userOpHash = await (kernelClient as any).sendUserOperation({
      calls: [{ to: input.to, data: input.data, value: 0n }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const receipt = await (kernelClient as any).waitForUserOperationReceipt({
      hash: userOpHash,
    });
    const txHash = receipt.receipt?.transactionHash;
    if (!txHash || receipt.success === false || receipt.receipt?.status === "reverted") {
      throw new Error("Smart-account USDC transfer reverted.");
    }
    return txHash as `0x${string}`;
  } catch (error) {
    throw normalizeContractWriteError(error);
  }
}
