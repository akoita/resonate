import { createHash } from 'node:crypto';
import {
  buildStemX402Receipt,
  encodeX402ReceiptHeader,
} from '../modules/x402/x402.receipt';

describe('buildStemX402Receipt', () => {
  it('returns a machine-readable receipt with payment, resource, and license metadata', () => {
    const receipt = buildStemX402Receipt({
      stemId: 'stem_1',
      stemType: 'vocals',
      stemTitle: 'Hook Vocals',
      trackTitle: 'Midnight Run',
      artist: 'Koita',
      releaseTitle: 'Neon Heat',
      hasNft: true,
      tokenId: '42',
      amountUsd: 0.75,
      network: 'eip155:84532',
      payTo: '0xPayTo',
      resource: '/api/stems/stem_1/x402',
      quoteUrl: '/api/stems/stem_1/x402/info',
      mimeType: 'audio/mpeg',
      contentLength: 2048,
      eventTransactionHash: 'x402:stem_1:12345',
      paymentHeader: 'proof-abc',
      purchasedAt: new Date('2026-04-13T10:00:00.000Z'),
    });

    expect(receipt.type).toBe('resonate.x402.purchase_receipt');
    expect(receipt.resource).toEqual({
      kind: 'stem',
      stemId: 'stem_1',
      stemType: 'vocals',
      stemTitle: 'Hook Vocals',
      trackTitle: 'Midnight Run',
      artist: 'Koita',
      releaseTitle: 'Neon Heat',
      hasNft: true,
      tokenId: '42',
      endpoint: '/api/stems/stem_1/x402',
      quoteUrl: '/api/stems/stem_1/x402/info',
      mimeType: 'audio/mpeg',
      contentLength: 2048,
    });
    expect(receipt.payment).toEqual({
      protocol: 'x402',
      scheme: 'exact',
      network: 'eip155:84532',
      payTo: '0xPayTo',
      currency: 'USDC',
      amount: '0.75',
      displayAmount: '0.75 USDC',
      paymentProofSha256: createHash('sha256')
        .update('proof-abc')
        .digest('hex'),
    });
    expect(receipt.license).toEqual({
      key: 'personal',
      name: 'Personal',
      currency: 'USDC',
      amount: '0.75',
      displayAmount: '0.75 USDC',
      scope: 'base stem download access via x402',
    });
    expect(receipt.provenance).toEqual({
      eventName: 'x402.purchase',
      transactionHash: 'x402:stem_1:12345',
    });
  });

  it('encodes the receipt as a base64url header payload', () => {
    const receipt = buildStemX402Receipt({
      stemId: 'stem_2',
      stemType: 'drums',
      stemTitle: null,
      trackTitle: null,
      artist: null,
      releaseTitle: null,
      hasNft: false,
      tokenId: null,
      amountUsd: 0.05,
      network: 'eip155:84532',
      payTo: '0xPayTo',
      resource: '/api/stems/stem_2/x402',
      quoteUrl: '/api/stems/stem_2/x402/info',
      mimeType: 'audio/mpeg',
      contentLength: 512,
      eventTransactionHash: 'x402:stem_2:12345',
    });

    const header = encodeX402ReceiptHeader(receipt);
    const decoded = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));

    expect(decoded.receiptId).toBe(receipt.receiptId);
    expect(decoded.payment.amount).toBe('0.05');
  });
});
