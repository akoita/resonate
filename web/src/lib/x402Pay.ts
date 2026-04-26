import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

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
  licenseKey: string | null;
  transactionHash: string | null;
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
    throw new X402PaymentError(
      `x402 settle failed: HTTP ${paidResponse.status}`,
    );
  }

  onStatus?.("downloading");
  return decodeAudioResponse(paidResponse);
}

async function decodeAudioResponse(response: Response): Promise<X402PaymentResult> {
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
    licenseKey: response.headers.get("x-resonate-license"),
    transactionHash: response.headers.get("x-payment-response"),
  };
}

function parseFilenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;
  const match = /filename="?([^";]+)"?/.exec(value);
  return match ? match[1] : null;
}
