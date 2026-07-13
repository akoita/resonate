/**
 * CP-1 (#1271) — attestRelease gate voucher wiring.
 *
 * The publish flow (useAttestAndStake in useContracts.ts) now fetches an
 * EIP-712 voucher from the backend before batching the on-chain
 * `attestRelease` call, and passes the returned `(deadline, signature)` as two
 * extra args. These tests lock down the two halves of that wiring without
 * mounting the ZeroDev/passkey React hook:
 *
 *  1. `createAttestationVoucher` POSTs to /contracts/attestation-vouchers with
 *     the JWT and the `{ releaseId, attester, chainId }` body.
 *  2. The vendored `ContentProtectionABI` encodes `attestRelease` with 6 args,
 *     including the fetched deadline/signature (roundtrips via decode).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeFunctionData, decodeFunctionData, type Hex } from 'viem';
import { ContentProtectionABI } from '../contracts_abi/index';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.stubGlobal('process', {
  ...process,
  env: {
    ...process.env,
    NEXT_PUBLIC_API_URL: 'http://test-api:3000',
  },
});

// Dynamic import so the stubbed NEXT_PUBLIC_API_URL is picked up by API_BASE.
const api = await import('../lib/api');

describe('createAttestationVoucher', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('POSTs the release id, attester, content hash, metadata URI, and chain id with the JWT', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          attester: '0x00000000000000000000000000000000000000aa',
          tokenId: '12345678901234567890',
          deadline: 1893456000,
          signature: `0x${'ab'.repeat(65)}`,
        }),
    });

    const releaseId = 12345678901234567890n;
    const attester = '0x00000000000000000000000000000000000000aa';
    const contentHash = `0x${'11'.repeat(32)}`;
    const metadataURI = 'ipfs://release-meta';

    const voucher = await api.createAttestationVoucher('artist-jwt', {
      releaseId: releaseId.toString(),
      attester,
      contentHash,
      metadataURI,
      chainId: 84532,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://test-api:3000/contracts/attestation-vouchers');
    expect(opts.method).toBe('POST');
    expect(opts.headers.get('Authorization')).toBe('Bearer artist-jwt');
    expect(JSON.parse(opts.body)).toEqual({
      releaseId: '12345678901234567890',
      attester,
      contentHash,
      metadataURI,
      chainId: 84532,
    });
    expect(voucher.deadline).toBe(1893456000);
    expect(voucher.signature).toBe(`0x${'ab'.repeat(65)}`);
  });

  it('encodes attestRelease with the 6 args including the fetched deadline/signature', async () => {
    const deadline = 1893456000;
    const signature = `0x${'cd'.repeat(65)}` as Hex;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          attester: '0x00000000000000000000000000000000000000aa',
          tokenId: '42',
          deadline,
          signature,
        }),
    });

    const releaseId = 42n;
    const contentHash = `0x${'11'.repeat(32)}` as Hex;
    const fingerprintHash = `0x${'22'.repeat(32)}` as Hex;
    const metadataURI = 'ipfs://release-meta';

    const voucher = await api.createAttestationVoucher('artist-jwt', {
      releaseId: releaseId.toString(),
      attester: '0x00000000000000000000000000000000000000aa',
      contentHash,
      metadataURI,
      chainId: 84532,
    });

    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
      contentHash,
      metadataURI,
    });

    // This mirrors exactly what useAttestAndStake batches on-chain. If the ABI
    // still had only 4 inputs, encodeFunctionData would throw on the 6-arg
    // array, so this guards the ABI change.
    const data = encodeFunctionData({
      abi: ContentProtectionABI,
      functionName: 'attestRelease',
      args: [
        releaseId,
        contentHash,
        fingerprintHash,
        metadataURI,
        BigInt(voucher.deadline),
        voucher.signature as Hex,
      ],
    });

    const decoded = decodeFunctionData({ abi: ContentProtectionABI, data });
    expect(decoded.functionName).toBe('attestRelease');
    expect(decoded.args).toHaveLength(6);
    expect(decoded.args?.[0]).toBe(releaseId);
    expect(decoded.args?.[1]).toBe(contentHash);
    expect(decoded.args?.[2]).toBe(fingerprintHash);
    expect(decoded.args?.[3]).toBe(metadataURI);
    expect(decoded.args?.[4]).toBe(BigInt(deadline));
    expect(decoded.args?.[5]).toBe(signature);
  });
});
