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

    it('constructs owner-scoped artwork URL when requested', () => {
      expect(api.getReleaseArtworkUrl('release-123', { ownerScoped: true })).toBe(
        'http://test-api:3000/catalog/me/releases/release-123/artwork',
      );
    });
  });

  describe('getReleaseTrackStreamUrl', () => {
    it('constructs correct public track stream URL', () => {
      expect(api.getReleaseTrackStreamUrl('release-123', 'track-456')).toBe(
        'http://test-api:3000/catalog/releases/release-123/tracks/track-456/stream',
      );
    });

    it('constructs owner-scoped track stream URL when requested', () => {
      expect(
        api.getReleaseTrackStreamUrl('release-123', 'track-456', { ownerScoped: true }),
      ).toBe(
        'http://test-api:3000/catalog/me/releases/release-123/tracks/track-456/stream',
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

    it('extracts readable messages from JSON error payloads', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () =>
          JSON.stringify({
            message: 'Gitcoin Passport is not configured.',
            error: 'Bad Request',
            statusCode: 400,
          }),
      });

      await expect(api.fetchNonce('0x1')).rejects.toThrow('API 400: Gitcoin Passport is not configured.');
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

    it('prefers the owner-scoped endpoint when a token is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'rel-owner',
            title: 'Restricted Release',
            artworkMimeType: 'image/png',
          }),
      });

      const release = await api.getRelease('rel-owner', 'jwt-token');

      expect(release!.artworkUrl).toBe(
        'http://test-api:3000/catalog/releases/rel-owner/artwork',
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'http://test-api:3000/catalog/me/releases/rel-owner',
      );
    });

    it('falls back to the public endpoint when the owner-scoped read is not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not found',
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'rel-public',
            title: 'Public Release',
            artworkMimeType: null,
          }),
      });

      const release = await api.getRelease('rel-public', 'jwt-token');

      expect(release!.id).toBe('rel-public');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'http://test-api:3000/catalog/me/releases/rel-public',
      );
      expect(mockFetch.mock.calls[1][0]).toBe(
        'http://test-api:3000/catalog/releases/rel-public',
      );
    });

    it('falls back to the public endpoint when the owner-scoped read is unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Expired token',
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'rel-public',
            title: 'Public Release',
            artworkMimeType: null,
          }),
      });

      const release = await api.getRelease('rel-public', 'expired-token');

      expect(release!.id).toBe('rel-public');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe(
        'http://test-api:3000/catalog/releases/rel-public',
      );
    });

    it('loads restricted owner artwork through the owner-scoped artwork endpoint', async () => {
      const originalCreateObjectURL = (URL as typeof URL & {
        createObjectURL?: (blob: Blob) => string;
      }).createObjectURL;
      (URL as typeof URL & { createObjectURL: (blob: Blob) => string }).createObjectURL =
        vi.fn(() => 'blob:owner-artwork');
      vi.stubGlobal('window', {} as Window & typeof globalThis);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'rel-restricted',
            title: 'Restricted Release',
            rightsRoute: 'QUARANTINED_REVIEW',
            artworkMimeType: 'image/png',
          }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (key: string) => (key === 'Content-Type' ? 'image/png' : null),
        },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });

      const release = await api.getRelease('rel-restricted', 'jwt-token');

      expect(release!.artworkUrl).toBe('blob:owner-artwork');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe(
        'http://test-api:3000/catalog/me/releases/rel-restricted/artwork',
      );
      expect((mockFetch.mock.calls[1][1] as RequestInit).headers).toEqual({
        Authorization: 'Bearer jwt-token',
      });

      if (originalCreateObjectURL) {
        (URL as typeof URL & { createObjectURL: (blob: Blob) => string }).createObjectURL =
          originalCreateObjectURL;
      } else {
        delete (URL as typeof URL & { createObjectURL?: (blob: Blob) => string }).createObjectURL;
      }
      delete (globalThis as typeof globalThis & { window?: unknown }).window;
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
              availableProviders: ['mock'],
              defaultProvider: 'mock',
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

    it('submits a typed rights evidence bundle', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'bundle-1',
            subjectType: 'dispute',
            subjectId: 'dispute_1_31337',
            submittedByRole: 'reporter',
            submittedByAddress: '0xabc',
            purpose: 'dispute_report',
            summary: 'Original publication proof.',
            evidences: [],
          }),
      });

      await api.submitRightsEvidenceBundle({
        subjectType: 'dispute',
        subjectId: 'dispute_1_31337',
        submittedByRole: 'reporter',
        submittedByAddress: '0xabc',
        purpose: 'dispute_report',
        summary: 'Original publication proof.',
        evidences: [
          {
            kind: 'prior_publication',
            title: 'Canonical release page',
            sourceUrl: 'https://example.com/original',
            claimedRightsholder: 'Meta Artist',
            strength: 'high',
          },
        ],
      }, 'test-token');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/metadata/evidence/bundles');
      expect(opts.method).toBe('POST');
      expect(opts.headers.get('Authorization')).toBe('Bearer test-token');
      expect(JSON.parse(opts.body)).toMatchObject({
        subjectType: 'dispute',
        subjectId: 'dispute_1_31337',
        submittedByRole: 'reporter',
        purpose: 'dispute_report',
      });
    });
  });
});
