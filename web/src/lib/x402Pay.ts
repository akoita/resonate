import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { API_BASE } from "./api";

export type X402EvmSigner = {
  readonly address: `0x${string}`;
  signTypedData(message: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
};

export type X402PaymentResult = {
  audio: Blob;
  filename: string;
  mimeType: string;
  receiptId: string | null;
  receiptHeader: string | null;
  receipt: X402Receipt | null;
  licenseKey: string | null;
  transactionHash: string | null;
};

export type X402Receipt = {
  receiptId: string;
  payment?: {
    currency?: string;
    amount?: string;
    amountUsd?: string;
    canonicalAmountUsd?: string;
    settlementAmount?: string;
    settlementAmountUnits?: string;
    asset?: {
      symbol?: string;
      decimals?: number;
      tokenAddress?: string;
      assetId?: string;
    };
  };
  settlement?: {
    rail?: string;
    status?: "download_only" | "contract_required_missing" | "contract_backed";
    entitlement?: string;
    listingId?: string | null;
    transactionHash?: string | null;
    reason?: string | null;
  };
};

export class X402PaymentError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "X402PaymentError";
  }
}

export async function payStemWithX402(input: {
  stemId: string;
  signer: X402EvmSigner;
  /**
   * Optional onStatus callback so callers can drive UI through challenge → sign → settle phases.
   */
  onStatus?: (status: "challenging" | "signing" | "settling" | "downloading") => void;
}): Promise<X402PaymentResult> {
  const { stemId, signer, onStatus } = input;
  const url = `${API_BASE}/api/stems/${encodeURIComponent(stemId)}/x402`;

  const core = new x402Client();
  registerExactEvmScheme(core, { signer });
  const httpClient = new x402HTTPClient(core);

  onStatus?.("challenging");
  const initialResponse = await fetch(url);

  if (initialResponse.status !== 402) {
    if (initialResponse.ok) {
      // Server returned audio without a payment challenge — still hand it back.
      return decodeAudioResponse(initialResponse);
    }
    throw new X402PaymentError(
      `Expected HTTP 402 from x402 endpoint, got ${initialResponse.status}`,
    );
  }

  const challengeBody = await initialResponse.json();
  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => initialResponse.headers.get(name),
    challengeBody,
  );

  onStatus?.("signing");
  let paymentPayload;
  try {
    paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  } catch (err) {
    throw new X402PaymentError(
      `Failed to create payment payload: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  onStatus?.("settling");
  const paidResponse = await fetch(url, {
    headers: httpClient.encodePaymentSignatureHeader(paymentPayload),
  });

  if (!paidResponse.ok) {
    let reason: string | null = null;
    try {
      const body = await paidResponse.clone().json();
      if (body && typeof body === "object") {
        reason = (body as { message?: string; error?: string }).message
          ?? (body as { error?: string }).error
          ?? null;
      }
    } catch {
      // Body wasn't JSON; fall back to status text.
    }
    throw new X402PaymentError(
      reason
        ? `x402 settle failed (HTTP ${paidResponse.status}): ${reason}`
        : `x402 settle failed: HTTP ${paidResponse.status}`,
    );
  }

  onStatus?.("downloading");
  return decodeAudioResponse(paidResponse);
}

export async function decodeAudioResponse(response: Response): Promise<X402PaymentResult> {
  const mimeType = response.headers.get("content-type") ?? "audio/mpeg";
  const audio = await response.blob();
  const dispositionFilename = parseFilenameFromContentDisposition(
    response.headers.get("content-disposition"),
  );

  return {
    audio,
    mimeType,
    filename: dispositionFilename ?? "stem",
    receiptId: response.headers.get("x-resonate-receipt-id"),
    receiptHeader: response.headers.get("x-resonate-receipt"),
    receipt: decodeReceiptHeader(response.headers.get("x-resonate-receipt")),
    licenseKey: response.headers.get("x-resonate-license"),
    transactionHash: response.headers.get("x-payment-response"),
  };
}

function decodeReceiptHeader(value: string | null): X402Receipt | null {
  if (!value) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as X402Receipt;
  } catch {
    return null;
  }
}

function parseFilenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;
  const match = /filename="?([^";]+)"?/.exec(value);
  return match ? match[1] : null;
}
