import { createHash, randomUUID } from 'node:crypto';
import { QuoteLicenseKey, formatUsdcAmount } from './x402.quote';

export type X402ReceiptInput = {
  stemId: string;
  stemType: string;
  stemTitle: string | null;
  trackTitle: string | null;
  artist: string | null;
  releaseTitle: string | null;
  hasNft: boolean;
  tokenId: string | null;
  licenseKey?: QuoteLicenseKey;
  amountUsd: number;
  network: string;
  payTo: string;
  resource: string;
  quoteUrl: string;
  mimeType: string;
  contentLength: number;
  eventTransactionHash: string;
  paymentHeader?: string | null;
  purchasedAt?: Date;
};

const LICENSE_NAMES: Record<QuoteLicenseKey, string> = {
  personal: 'Personal',
  remix: 'Remix',
  commercial: 'Commercial',
};

export function buildStemX402Receipt(input: X402ReceiptInput) {
  const purchasedAt = input.purchasedAt ?? new Date();
  const licenseKey = input.licenseKey ?? 'personal';
  const normalizedAmount = formatUsdcAmount(input.amountUsd);
  const paymentProofDigest = input.paymentHeader
    ? createHash('sha256').update(input.paymentHeader).digest('hex')
    : null;

  return {
    receiptId: `x402r_${randomUUID()}`,
    version: '1',
    type: 'resonate.x402.purchase_receipt',
    protocol: 'x402',
    purchasedAt: purchasedAt.toISOString(),
    resource: {
      kind: 'stem',
      stemId: input.stemId,
      stemType: input.stemType,
      stemTitle: input.stemTitle,
      trackTitle: input.trackTitle,
      artist: input.artist,
      releaseTitle: input.releaseTitle,
      hasNft: input.hasNft,
      tokenId: input.tokenId,
      endpoint: input.resource,
      quoteUrl: input.quoteUrl,
      mimeType: input.mimeType,
      contentLength: input.contentLength,
    },
    payment: {
      protocol: 'x402',
      scheme: 'exact',
      network: input.network,
      payTo: input.payTo,
      currency: 'USDC',
      amount: normalizedAmount,
      displayAmount: `${normalizedAmount} USDC`,
      paymentProofSha256: paymentProofDigest,
    },
    license: {
      key: licenseKey,
      name: LICENSE_NAMES[licenseKey],
      currency: 'USDC',
      amount: normalizedAmount,
      displayAmount: `${normalizedAmount} USDC`,
      scope: 'base stem download access via x402',
    },
    provenance: {
      eventName: 'x402.purchase',
      transactionHash: input.eventTransactionHash,
    },
  };
}

export function encodeX402ReceiptHeader(receipt: ReturnType<typeof buildStemX402Receipt>) {
  return Buffer.from(JSON.stringify(receipt)).toString('base64url');
}
