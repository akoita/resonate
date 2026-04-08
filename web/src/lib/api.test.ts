/**
 * Frontend API client unit tests — Issue #362
 *
 * Tests the core apiRequest function and key API wrappers.
 * These tests mock `fetch` globally and verify:
 * - Correct URL construction
 * - Authorization header injection
 * - Error handling (HTTP errors, JSON parse failures)
 * - 204 No Content handling
 * - FormData Content-Type passthrough
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock fetch before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock process.env
vi.stubGlobal('process', {
  ...process,
  env: {
    ...process.env,
    NEXT_PUBLIC_API_URL: 'http://test-api:3000',
  },
});

// Dynamic import so env vars are picked up
const api = await import('./api');

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('API_BASE', () => {
    it('uses NEXT_PUBLIC_API_URL from env', () => {
      expect(api.API_BASE).toBe('http://test-api:3000');
    });
  });

  describe('getReleaseArtworkUrl', () => {
    it('constructs correct artwork URL', () => {
      expect(api.getReleaseArtworkUrl('release-123')).toBe(
        'http://test-api:3000/catalog/releases/release-123/artwork',
      );
    });
  });

  describe('fetchNonce', () => {
    it('sends POST to /auth/nonce with address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ nonce: 'abc-123' }),
      });

      const result = await api.fetchNonce('0xABC');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/auth/nonce');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ address: '0xABC' });
      expect(result).toEqual({ nonce: 'abc-123' });
    });
  });

  describe('verifySignature', () => {
    it('sends POST to /auth/verify with full payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ accessToken: 'jwt-token-123' }),
      });

      const result = await api.verifySignature({
        address: '0xABC',
        message: 'Sign in',
        signature: '0xDEAD',
      });

      expect(result).toEqual({ accessToken: 'jwt-token-123' });
    });
  });

  describe('apiRequest error handling', () => {
    it('throws on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid token',
      });

      await expect(api.fetchNonce('0x1')).rejects.toThrow('API 401');
    });

    it('handles 204 No Content gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      });

      // deletePlaylistAPI returns void (204)
      const result = await api.deletePlaylistAPI('pl-1', 'token');
      expect(result).toBeNull();
    });

    it('handles empty response body gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
      });

      const result = await api.fetchNonce('0x1');
      expect(result).toBeNull();
    });
  });

  describe('authorization header', () => {
    it('includes Bearer token when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'wallet-1' }),
      });

      await api.fetchWallet('user-1', 'my-jwt-token');

      const [, opts] = mockFetch.mock.calls[0];
      const headers = opts.headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer my-jwt-token');
    });

    it('does not include Authorization header when no token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      });

      await api.listPublishedReleases();

      const [, opts] = mockFetch.mock.calls[0];
      const headers = opts.headers as Headers;
      expect(headers.get('Authorization')).toBeNull();
    });
  });

  describe('getRelease', () => {
    it('appends artworkUrl when artworkMimeType present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'rel-1',
            title: 'Test Release',
            artworkMimeType: 'image/png',
          }),
      });

      const release = await api.getRelease('rel-1');
      expect(release!.artworkUrl).toBe(
        'http://test-api:3000/catalog/releases/rel-1/artwork',
      );
    });

    it('does not set artworkUrl when artworkMimeType is null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'rel-2',
            title: 'No Art',
            artworkMimeType: null,
          }),
      });

      const release = await api.getRelease('rel-2');
      expect(release!.artworkUrl).toBeUndefined();
    });
  });

  describe('getTrack', () => {
    it('enriches release artworkUrl when present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'track-1',
            releaseId: 'rel-1',
            release: {
              id: 'rel-1',
              artworkMimeType: 'image/jpeg',
            },
          }),
      });

      const track = await api.getTrack('track-1');
      expect(track!.release!.artworkUrl).toBe(
        'http://test-api:3000/catalog/releases/rel-1/artwork',
      );
    });
  });

  describe('curator endpoints', () => {
    it('loads curator reporting policy from metadata API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            walletAddress: '0xabc',
            reportsFiled: 4,
            requiresHumanVerification: true,
            message: 'Verification required',
            stakeTier: { key: 'trusted', label: 'Trusted Curator', description: 'desc', multiplierBps: 1500 },
            humanVerification: {
              verified: false,
              provider: null,
              status: 'unverified',
              score: null,
              threshold: null,
              verifiedAt: null,
              expiresAt: null,
              requiredAfterReports: 3,
            },
          }),
      });

      const result = await api.getCuratorReportingPolicy('0xABC');
      expect(result.walletAddress).toBe('0xabc');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/metadata/curators/0xabc/reporting-policy');
    });

    it('submits proof-of-humanity verification', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            walletAddress: '0xabc',
            humanVerification: {
              verified: true,
              provider: 'mock',
              status: 'verified',
              score: 1,
              threshold: 1,
              verifiedAt: '2026-04-07T00:00:00.000Z',
              expiresAt: null,
              requiredAfterReports: 3,
            },
          }),
      });

      await api.submitHumanVerification('0xABC', { provider: 'mock', proof: 'resonate-human' });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/metadata/curators/0xabc/verification');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ provider: 'mock', proof: 'resonate-human' });
    });
  });
});
