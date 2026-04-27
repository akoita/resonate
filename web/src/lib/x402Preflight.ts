import {
  createPublicClient,
  decodeErrorResult,
  encodeFunctionData,
  http,
  type Hex,
  type PublicClient,
} from "viem";
import { baseSepolia } from "viem/chains";

const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const multicall3Abi = [
  {
    inputs: [
      { name: "requireSuccess", type: "bool" },
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    name: "tryAggregate",
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const eip3009TransferAbi = [
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

// Common revert selectors that USDC + Kernel may emit. Used to pretty-print
// short revert reasons even when the raw return data isn't decoded.
const KNOWN_SELECTORS: Record<string, string> = {
  "0x08c379a0": "Error(string)",
  "0x4e487b71": "Panic(uint256)",
  "0xe450d38c": "ERC20InsufficientBalance(address,uint256,uint256)",
  "0x118cdaa7": "OwnableUnauthorizedAccount(address)",
};

export type PreflightCall = {
  label: string;
  target: `0x${string}`;
  callData: Hex;
};

export type PreflightResult = {
  label: string;
  success: boolean;
  returnData: Hex;
  decodedRevert?: string;
};

export type SimulateX402MulticallInput = {
  usdcAddress: `0x${string}`;
  authorization: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: bigint | string;
    validAfter: bigint | string;
    validBefore: bigint | string;
    nonce: `0x${string}`;
  };
  innerSignature: Hex;
  factory?: `0x${string}` | null;
  factoryData?: Hex | null;
  publicClient?: PublicClient;
};

/**
 * Replays the same multicall that the x402 facilitator's verify path runs
 * (Multicall3.tryAggregate(false, [factoryDeploy?, transferWithAuthorization])).
 * Surfaces the per-call success + revert data via console.info so we see
 * exactly which step the facilitator is failing on.
 *
 * Pure diagnostic — does not affect the actual payment flow.
 */
export async function simulateX402Multicall(
  input: SimulateX402MulticallInput,
): Promise<PreflightResult[]> {
  const publicClient =
    input.publicClient ??
    createPublicClient({ chain: baseSepolia, transport: http() });

  const calls: PreflightCall[] = [];
  if (
    input.factory &&
    input.factoryData &&
    input.factoryData !== "0x" &&
    input.factory !== "0x0000000000000000000000000000000000000000"
  ) {
    calls.push({
      label: "factory.deploy",
      target: input.factory,
      callData: input.factoryData,
    });
  }

  const transferCalldata = encodeFunctionData({
    abi: eip3009TransferAbi,
    functionName: "transferWithAuthorization",
    args: [
      input.authorization.from,
      input.authorization.to,
      BigInt(input.authorization.value),
      BigInt(input.authorization.validAfter),
      BigInt(input.authorization.validBefore),
      input.authorization.nonce,
      input.innerSignature,
    ],
  });
  calls.push({
    label: "usdc.transferWithAuthorization",
    target: input.usdcAddress,
    callData: transferCalldata,
  });

  let raw: readonly { success: boolean; returnData: Hex }[];
  try {
    raw = await publicClient.readContract({
      address: MULTICALL3_ADDRESS,
      abi: multicall3Abi,
      functionName: "tryAggregate",
      args: [
        false,
        calls.map((c) => ({ target: c.target, callData: c.callData })),
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[x402 preflight] multicall reverted entirely", { message });
    return calls.map((c) => ({
      label: c.label,
      success: false,
      returnData: "0x" as Hex,
      decodedRevert: `multicall reverted: ${message}`,
    }));
  }

  return raw.map((r, i) => ({
    label: calls[i].label,
    success: r.success,
    returnData: r.returnData,
    decodedRevert: r.success ? undefined : decodeRevert(r.returnData),
  }));
}

function decodeRevert(data: Hex): string {
  if (!data || data === "0x") return "empty revert (no return data)";
  const selector = data.slice(0, 10).toLowerCase();
  const known = KNOWN_SELECTORS[selector];
  if (known === "Error(string)") {
    try {
      const decoded = decodeErrorResult({
        abi: [
          {
            type: "error",
            name: "Error",
            inputs: [{ name: "message", type: "string" }],
          },
        ],
        data,
      });
      const args = decoded.args as readonly [string];
      return `Error("${args[0]}")`;
    } catch {
      return `selector ${selector} (Error(string), undecodable)`;
    }
  }
  if (known === "Panic(uint256)") {
    return `Panic at selector ${selector}`;
  }
  return known
    ? `selector ${selector} (${known})`
    : `selector ${selector} (unknown)`;
}
