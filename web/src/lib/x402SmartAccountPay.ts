import {
  createPublicClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from "viem";
import { createZeroDevPaymasterClient, createKernelAccountClient } from "@zerodev/sdk";
import {
  API_BASE,
  type PunchlineCollectResult,
  type PunchlineMomentQuote,
} from "./api";
import { getBundlerUrl, isPaymasterEnabled } from "./bundlerConfig";
import { normalizeContractWriteError } from "./contractErrors";
import { getX402Chain } from "./x402BrowserWallet";
import { getX402KernelAccount } from "./x402KernelAccount";
import { decodeAudioResponse, type X402PaymentResult } from "./x402Pay";
import {
  PAYER_NOT_LINKED_CODE,
  payerIsKnownBuyerAddress,
  paymentBindingTypedData,
  type PaymentBindingResource,
} from "./x402PaymentBinding";

type X402SmartAccountStatus = "signing" | "settling" | "downloading";

type PayWithX402SmartAccountInput = {
  /** Absolute POST URL that verifies the payment and fulfills the resource. */
  submitUrl: string;
  webAuthnKey: unknown;
  chainId: number;
  assetAddress: Address;
  payTo: Address;
  amountUnits: string;
  /** Extra fields merged into the POST body (e.g. { collectorWallet }). */
  extraBody?: Record<string, unknown>;
  /** Extra request headers (e.g. Authorization for JWT-guarded endpoints). */
  extraHeaders?: Record<string, string>;
  /**
   * Ties the payment to the signed-in buyer (`x402PaymentBinding`). A payment
   * from an address the server does not know as the buyer's is signed by the
   * paying account; without this, only the buyer's own addresses redeem.
   */
  binding?: PaymentBuyerBinding;
  onStatus?: (status: X402SmartAccountStatus) => void;
  onPayer?: (address: Address) => void;
};

/** Who is buying: the signed-in user id and the addresses the server already links to them. */
export type PaymentBuyer = {
  buyerId: string;
  buyerAddresses: Array<string | null | undefined>;
};

type PaymentBuyerBinding = PaymentBuyer & { resource: PaymentBindingResource };

type PayStemWithX402SmartAccountInput = {
  stemId: string;
  /** The signed-in session: the endpoint redeems a payment only for its buyer. */
  token: string;
  buyer: PaymentBuyer;
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

/**
 * Endpoint-agnostic x402 smart-account payer (#1462). Builds the Resonate
 * passkey (Kernel) account, transfers USDC to `payTo`, then POSTs
 * `{ txHash, payer, ...extraBody }` to `submitUrl` for server-side verification
 * and fulfillment. Returns the raw `Response` plus the txHash/payer so each
 * caller decodes its own body (audio for stems, JSON for moment collects) and
 * maps its own error codes — this helper only throws on wallet/transfer
 * failures, never on a non-2xx from `submitUrl`.
 */
export async function payWithX402SmartAccount(
  input: PayWithX402SmartAccountInput,
): Promise<{ response: Response; txHash: `0x${string}`; payer: Address }> {
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

  // Tie the payment to the signed-in buyer (`x402PaymentBinding`). An account
  // the server does not know as the buyer's signs before any money moves, so a
  // cancelled prompt costs nothing.
  const binding = input.binding;
  const signBinding = () =>
    account.signTypedData(
      paymentBindingTypedData({
        chainId: input.chainId,
        resource: binding!.resource,
        buyer: binding!.buyerId,
      }) as Parameters<typeof account.signTypedData>[0],
    );
  let payerSignature =
    binding !== undefined && !payerIsKnownBuyerAddress(account.address, binding.buyerAddresses)
      ? await signBinding()
      : undefined;

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
  const submit = (signature?: `0x${string}`) =>
    fetch(input.submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(input.extraHeaders ?? {}) },
      body: JSON.stringify({
        txHash,
        payer: account.address,
        ...(signature ? { payerSignature: signature } : {}),
        ...(input.extraBody ?? {}),
      }),
    });

  // The transfer is already on-chain here: if the server does not link an
  // address we expected it to know, sign and retry once rather than strand it.
  let response = await submit(payerSignature);
  if (binding && !payerSignature && response.status === 403 && (await isPayerNotLinked(response))) {
    payerSignature = await signBinding();
    response = await submit(payerSignature);
  }

  return { response, txHash, payer: account.address as Address };
}

async function isPayerNotLinked(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { code?: string } | null;
    return body?.code === PAYER_NOT_LINKED_CODE;
  } catch {
    return false;
  }
}

export async function payStemWithX402SmartAccount(
  input: PayStemWithX402SmartAccountInput,
): Promise<X402PaymentResult> {
  const { response } = await payWithX402SmartAccount({
    submitUrl: `${API_BASE}/api/stems/${encodeURIComponent(input.stemId)}/x402/smart-account`,
    webAuthnKey: input.webAuthnKey,
    chainId: input.chainId,
    assetAddress: input.assetAddress,
    payTo: input.payTo,
    amountUnits: input.amountUnits,
    extraHeaders: { Authorization: `Bearer ${input.token}` },
    binding: { ...input.buyer, resource: { kind: "stem", id: input.stemId } },
    onStatus: input.onStatus,
    onPayer: input.onPayer,
  });

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

/** An x402 collect error carrying the backend `{ code }` for UI mapping (#1462). */
export class PunchlineCheckoutError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "PunchlineCheckoutError";
  }
}

/**
 * Pay for and collect one edition of a priced Punchline moment (#1462): the
 * Resonate passkey wallet transfers USDC to the payout address, then the
 * JWT-guarded collect endpoint verifies the on-chain payment and grants the
 * edition. Throws a `PunchlineCheckoutError` with the backend `code` so the UI
 * can map verification / paid_but_unfulfilled / sold_out honestly.
 */
export async function payMomentWithX402SmartAccount(input: {
  quote: PunchlineMomentQuote;
  token: string;
  buyer: PaymentBuyer;
  webAuthnKey: unknown;
  chainId: number;
  collectorWallet?: string | null;
  onStatus?: (status: X402SmartAccountStatus) => void;
  onPayer?: (address: Address) => void;
}): Promise<PunchlineCollectResult> {
  const { response } = await payWithX402SmartAccount({
    submitUrl: `${API_BASE}${input.quote.collectEndpoint}`,
    webAuthnKey: input.webAuthnKey,
    chainId: input.chainId,
    assetAddress: input.quote.asset.address as Address,
    payTo: input.quote.payTo as Address,
    amountUnits: input.quote.amountUnits,
    extraHeaders: { Authorization: `Bearer ${input.token}` },
    extraBody: { collectorWallet: input.collectorWallet ?? null },
    binding: { ...input.buyer, resource: { kind: "moment", id: input.quote.momentId } },
    onStatus: input.onStatus,
    onPayer: input.onPayer,
  });

  const text = await response.text().catch(() => "");
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const detail = (body ?? {}) as { code?: string; message?: string; error?: string };
    throw new PunchlineCheckoutError(
      detail.message || detail.error || `Collect failed (HTTP ${response.status}).`,
      detail.code ?? null,
    );
  }

  return body as PunchlineCollectResult;
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

  if (isPaymasterEnabled(input.chainId)) {
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
