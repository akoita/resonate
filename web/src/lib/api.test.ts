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
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);
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

  describe('getArtistAnalyticsDashboard', () => {
    it('fetches the artist dashboard from the authenticated analytics endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            summary: {
              artistId: 'artist-1',
              days: 30,
              totalPlays: 4,
              totalPayoutUsd: 1.25,
              payoutsByAsset: [],
            },
            tracks: [],
            topTracks: [],
            sessions: [],
            sources: [],
            protection: {
              totalDecisions: 1,
              releasesWithDecisions: 1,
              marketplaceReadyReleases: 1,
              restrictedReleases: 0,
              blockedReleases: 0,
              routes: [
                {
                  route: 'STANDARD_ESCROW',
                  decisions: 1,
                  releases: 1,
                  latestDecisionAt: '2026-05-22T10:00:00.000Z',
                },
              ],
            },
            playsOverTime: [],
            trackPerformance: [],
            export: {
              artistId: 'artist-1',
              days: 30,
              totalPlays: 4,
              totalPayoutUsd: 1.25,
              payoutsByAsset: [],
              generatedAt: '2026-05-22T12:00:00.000Z',
              source: 'bigquery',
              freshness: { asOf: null, lagSeconds: null },
            },
            meta: {
              source: 'bigquery',
              generatedAt: '2026-05-22T12:00:00.000Z',
              timeWindow: {
                from: '2026-04-22T12:00:00.000Z',
                to: '2026-05-22T12:00:00.000Z',
                days: 30,
              },
              freshness: { asOf: null, lagSeconds: null },
              isEmpty: false,
              cache: { hit: false, ttlSeconds: 60 },
            },
          }),
      });

      const result = await api.getArtistAnalyticsDashboard('artist-token', 'artist-1', 30);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/analytics/artist/artist-1/v1?days=30');
      expect(opts.headers.get('Authorization')).toBe('Bearer artist-token');
      expect(opts.cache).toBe('no-store');
      expect(result.summary.totalPlays).toBe(4);
      expect(result.protection.marketplaceReadyReleases).toBe(1);
      expect(result.meta.source).toBe('bigquery');
    });
  });

  describe('recordPlaybackCompleted', () => {
    it('posts playback completion to the narrow analytics endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            status: 'ok',
            eventId: 'evt_playback_1',
            ingested: 1,
          }),
      });

      const result = await api.recordPlaybackCompleted('listener-token', {
        trackId: 'track-1',
        artistId: 'artist-1',
        releaseId: 'release-1',
        sessionId: 'session-1',
        source: 'web_player',
        completionRatio: 0.8,
        durationMs: 30000,
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/analytics/playback/completed');
      expect(opts.method).toBe('POST');
      expect(opts.headers.get('Authorization')).toBe('Bearer listener-token');
      expect(JSON.parse(opts.body)).toEqual({
        trackId: 'track-1',
        artistId: 'artist-1',
        releaseId: 'release-1',
        sessionId: 'session-1',
        source: 'web_player',
        completionRatio: 0.8,
        durationMs: 30000,
      });
      expect(result.eventId).toBe('evt_playback_1');
    });
  });

  describe('recordPlaybackEvent', () => {
    it('posts playback lifecycle events to the analytics endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            status: 'ok',
            eventId: 'evt_playback_lifecycle_1',
            ingested: 1,
          }),
      });

      const result = await api.recordPlaybackEvent('listener-token', {
        action: 'heartbeat',
        trackId: 'track-1',
        artistId: 'artist-1',
        releaseId: 'release-1',
        sessionId: 'session-1',
        playbackInstanceId: 'instance-1',
        source: 'web_player',
        positionMs: 30000,
        durationMs: 120000,
        heartbeatIntervalMs: 30000,
        queueIndex: 1,
        queueLength: 4,
        repeatMode: 'all',
        shuffle: true,
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/analytics/playback/event');
      expect(opts.method).toBe('POST');
      expect(opts.headers.get('Authorization')).toBe('Bearer listener-token');
      expect(JSON.parse(opts.body)).toEqual({
        action: 'heartbeat',
        trackId: 'track-1',
        artistId: 'artist-1',
        releaseId: 'release-1',
        sessionId: 'session-1',
        playbackInstanceId: 'instance-1',
        source: 'web_player',
        positionMs: 30000,
        durationMs: 120000,
        heartbeatIntervalMs: 30000,
        queueIndex: 1,
        queueLength: 4,
        repeatMode: 'all',
        shuffle: true,
      });
      expect(result.eventId).toBe('evt_playback_lifecycle_1');
    });
  });

  describe('recordProductAnalyticsEvent', () => {
    it('posts app-wide product events to the analytics endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            status: 'ok',
            eventId: 'evt_product_1',
            ingested: 1,
          }),
      });

      const result = await api.recordProductAnalyticsEvent('artist-token', {
        eventName: 'artist.upload_step_completed',
        sessionId: 'session-1',
        subjectType: 'release',
        subjectId: 'release-1',
        clientEventId: 'client-event-1',
        payload: {
          step: 'stems',
          fileCount: 8,
        },
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/analytics/product/event');
      expect(opts.method).toBe('POST');
      expect(opts.headers.get('Authorization')).toBe('Bearer artist-token');
      expect(JSON.parse(opts.body)).toEqual({
        eventName: 'artist.upload_step_completed',
        sessionId: 'session-1',
        subjectType: 'release',
        subjectId: 'release-1',
        clientEventId: 'client-event-1',
        payload: {
          step: 'stems',
          fileCount: 8,
        },
      });
      expect(result.eventId).toBe('evt_product_1');
    });
  });

  describe('getAgentNextPick', () => {
    it('posts session intent preferences when starting an agent session', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'started', sessionId: 'session-1' }),
      });

      const result = await api.startAgentSession('listener-token', {
        preferences: {
          mood: 'Hype',
          energy: 'high',
          genres: ['Bass', 'Club', 'Trap'],
          licenseType: 'remix',
          sessionIntent: 'Hype',
          sessionIntentName: 'Pulse Raid',
          queueStyle: 'Fast cuts',
          source: 'agent_session_intent',
        },
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/agents/config/session');
      expect(opts.method).toBe('POST');
      expect(opts.headers.get('Authorization')).toBe('Bearer listener-token');
      expect(JSON.parse(opts.body)).toEqual({
        preferences: {
          mood: 'Hype',
          energy: 'high',
          genres: ['Bass', 'Club', 'Trap'],
          licenseType: 'remix',
          sessionIntent: 'Hype',
          sessionIntentName: 'Pulse Raid',
          queueStyle: 'Fast cuts',
          source: 'agent_session_intent',
        },
      });
      expect(result.sessionId).toBe('session-1');
    });

    it('posts to the session runtime next-pick endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: 'ok',
            track: { id: 'track-1', title: 'Runtime Track', artistId: 'artist-1' },
            licenseType: 'remix',
            priceUsd: 5,
            runtimeStatus: 'approved',
            tracks: [{ trackId: 'track-1', licenseType: 'remix', priceUsd: 5 }],
          }),
      });

      const result = await api.getAgentNextPick(
        'listener-token',
        {
          sessionId: 'session-1',
          preferences: {
            genres: ['electronic'],
            licenseType: 'remix',
            sessionIntent: 'Hype',
            sessionIntentName: 'Pulse Raid',
            queueStyle: 'Fast cuts',
            source: 'agent_session_intent',
          },
        },
      );

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/sessions/agent/next');
      expect(opts.method).toBe('POST');
      expect(opts.headers.get('Authorization')).toBe('Bearer listener-token');
      expect(JSON.parse(opts.body)).toEqual({
        sessionId: 'session-1',
        preferences: {
          genres: ['electronic'],
          licenseType: 'remix',
          sessionIntent: 'Hype',
          sessionIntentName: 'Pulse Raid',
          queueStyle: 'Fast cuts',
          source: 'agent_session_intent',
        },
      });
      expect(result.status).toBe('ok');
      expect(result.track?.title).toBe('Runtime Track');
    });
  });

  describe('getSongRecommendations', () => {
    it('fetches personalized recommendations for a user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            userId: 'user-1',
            preferences: { genres: ['Hip Hop'] },
            items: [
              {
                id: 'track-1',
                title: 'Cipher Loop',
                artistId: 'artist-1',
                releaseId: 'release-1',
                genre: 'Hip Hop',
                score: 55,
                reasons: ['genre:Hip Hop'],
              },
            ],
          }),
      });

      const result = await api.getSongRecommendations('user-1', 'listener-token', 4);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/recommendations/user-1?limit=4');
      expect(opts.headers.get('Authorization')).toBe('Bearer listener-token');
      expect(result.items[0].title).toBe('Cipher Loop');
    });

    it('sends vibe preference overrides as recommendation query params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            userId: 'user-1',
            preferences: { mood: 'Focus', energy: 'low', genres: ['Ambient', 'Electronic'] },
            items: [],
          }),
      });

      await api.getSongRecommendations('user-1', 'listener-token', 6, {
        mood: 'Focus',
        energy: 'low',
        genres: ['Ambient', 'Electronic'],
        allowExplicit: true,
      });

      const [url] = mockFetch.mock.calls[0];
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/recommendations/user-1');
      expect(parsed.searchParams.get('limit')).toBe('6');
      expect(parsed.searchParams.get('mood')).toBe('Focus');
      expect(parsed.searchParams.get('energy')).toBe('low');
      expect(parsed.searchParams.get('genres')).toBe('Ambient,Electronic');
      expect(parsed.searchParams.get('allowExplicit')).toBe('true');
    });
  });

  describe('isGenerationStatusComplete', () => {
    it('accepts backend and legacy completion status values', () => {
      expect(api.isGenerationStatusComplete('completed')).toBe(true);
      expect(api.isGenerationStatusComplete('complete')).toBe(true);
      expect(api.isGenerationStatusComplete('generating')).toBe(false);
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

    it('invalidates stored auth when a token-backed request receives 401', async () => {
      const removedKeys: string[] = [];
      const dispatchEvent = vi.fn();
      vi.stubGlobal('window', {
        dispatchEvent,
      });
      vi.stubGlobal('localStorage', {
        getItem: vi.fn(() => null),
        removeItem: vi.fn((key: string) => removedKeys.push(key)),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => JSON.stringify({ message: 'Unauthorized', statusCode: 401 }),
      });

      await expect(api.fetchWallet('user-1', 'stale-token')).rejects.toThrow('API 401: Unauthorized');

      expect(removedKeys).toEqual([
        'resonate.token',
        'resonate.address',
        'resonate.smartAccountAddress',
        'resonate.privy.userId',
      ]);
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      expect(dispatchEvent.mock.calls[0][0].type).toBe('resonate:auth-invalidated');
    });

    it('keeps Playwright/local mock auth sessions when a mock token receives 401', async () => {
      const dispatchEvent = vi.fn();
      vi.stubGlobal('window', {
        dispatchEvent,
      });
      vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => key === 'resonate.mock_auth' ? 'true' : null),
        removeItem: vi.fn(),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => JSON.stringify({ message: 'Unauthorized', statusCode: 401 }),
      });

      await expect(api.fetchWallet('test-user', 'mock-token')).rejects.toThrow('API 401: Unauthorized');

      expect(localStorage.removeItem).not.toHaveBeenCalled();
      expect(dispatchEvent).not.toHaveBeenCalled();
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
        Reflect.deleteProperty(URL as unknown as Record<string, unknown>, "createObjectURL");
      }
      Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, "window");
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

    it('submits a release rights-upgrade request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'req-1',
            releaseId: 'rel-1',
            artistId: 'artist-1',
            requestedByAddress: '0xabc',
            status: 'submitted',
            requestedRoute: 'STANDARD_ESCROW',
            currentRouteAtSubmission: 'LIMITED_MONITORING',
            summary: 'I control the official distributor dashboard.',
            createdAt: '2026-04-11T00:00:00.000Z',
            updatedAt: '2026-04-11T00:00:00.000Z',
            evidenceBundles: [],
          }),
      });

      await api.submitReleaseRightsUpgradeRequest(
        'rel-1',
        {
          summary: 'I control the official distributor dashboard.',
          requestedRoute: 'STANDARD_ESCROW',
          evidences: [
            {
              kind: 'proof_of_control',
              title: 'Distributor dashboard',
              sourceUrl: 'https://example.com/dashboard',
              claimedRightsholder: 'Meta Artist',
              strength: 'high',
            },
          ],
        },
        'test-token',
      );

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/metadata/release-rights/releases/rel-1/request');
      expect(opts.method).toBe('POST');
      expect(opts.headers.get('Authorization')).toBe('Bearer test-token');
      expect(JSON.parse(opts.body)).toMatchObject({
        summary: 'I control the official distributor dashboard.',
        requestedRoute: 'STANDARD_ESCROW',
      });
    });

    it('submits a trusted-source link request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'tsr-1',
            artistId: 'artist-1',
            requesterAddress: '0xabc',
            requestedSourceType: 'distributor',
            sourceName: 'Distributor Portal',
            sourceKey: 'distributor-portal',
            requestedTrustLevel: 'high',
            proofSummary: 'I control the distributor dashboard for this catalog.',
            status: 'submitted',
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
            evidenceBundles: [],
          }),
      });

      await api.submitTrustedSourceLinkRequest(
        {
          requestedSourceType: 'distributor',
          sourceName: 'Distributor Portal',
          requestedTrustLevel: 'high',
          proofSummary: 'I control the distributor dashboard for this catalog.',
          evidences: [
            {
              kind: 'proof_of_control',
              title: 'Distributor dashboard',
              sourceUrl: 'https://example.com/dashboard',
              claimedRightsholder: 'Meta Artist',
              strength: 'high',
            },
          ],
        },
        'test-token',
      );

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/metadata/trusted-sources/link-requests');
      expect(opts.method).toBe('POST');
      expect(opts.headers.get('Authorization')).toBe('Bearer test-token');
      expect(JSON.parse(opts.body)).toMatchObject({
        requestedSourceType: 'distributor',
        sourceName: 'Distributor Portal',
        requestedTrustLevel: 'high',
      });
    });

    it('reviews a trusted-source link request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'tsr-1',
            artistId: 'artist-1',
            requesterAddress: '0xabc',
            requestedSourceType: 'distributor',
            sourceName: 'Distributor Portal',
            sourceKey: 'distributor-portal',
            requestedTrustLevel: 'high',
            proofSummary: 'I control the distributor dashboard for this catalog.',
            status: 'approved',
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
          }),
      });

      await api.reviewTrustedSourceLinkRequest(
        'tsr-1',
        {
          action: 'approve',
          trustLevel: 'high',
          decisionReason: 'Distributor dashboard checked.',
        },
        'admin-token',
      );

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/metadata/trusted-sources/link-requests/tsr-1/review');
      expect(opts.method).toBe('PATCH');
      expect(opts.headers.get('Authorization')).toBe('Bearer admin-token');
      expect(JSON.parse(opts.body)).toMatchObject({
        action: 'approve',
        trustLevel: 'high',
      });
    });

    it('creates a manual rights route reassessment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'rr-1',
            releaseId: 'rel-1',
            trigger: 'manual_review',
            status: 'pending_review',
            previousRoute: 'STANDARD_ESCROW',
            recommendedRoute: 'QUARANTINED_REVIEW',
            reason: 'New catalog signal requires review.',
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
          }),
      });

      await api.createRightsRouteReassessment(
        'rel-1',
        {
          trigger: 'manual_review',
          recommendedRoute: 'QUARANTINED_REVIEW',
          reason: 'New catalog signal requires review.',
        },
        'admin-token',
      );

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/metadata/rights-reassessments/releases/rel-1');
      expect(opts.method).toBe('POST');
      expect(opts.headers.get('Authorization')).toBe('Bearer admin-token');
      expect(JSON.parse(opts.body)).toMatchObject({
        trigger: 'manual_review',
        recommendedRoute: 'QUARANTINED_REVIEW',
      });
    });

    it('reviews a rights route reassessment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'rr-1',
            releaseId: 'rel-1',
            trigger: 'fingerprint_conflict',
            status: 'applied',
            previousRoute: 'STANDARD_ESCROW',
            nextRoute: 'QUARANTINED_REVIEW',
            reason: 'Fingerprint conflict confirmed.',
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
          }),
      });

      await api.reviewRightsRouteReassessment(
        'rr-1',
        {
          action: 'apply_route',
          nextRoute: 'QUARANTINED_REVIEW',
          reason: 'Fingerprint conflict confirmed.',
        },
        'admin-token',
      );

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/metadata/rights-reassessments/rr-1/review');
      expect(opts.method).toBe('PATCH');
      expect(opts.headers.get('Authorization')).toBe('Bearer admin-token');
      expect(JSON.parse(opts.body)).toMatchObject({
        action: 'apply_route',
        nextRoute: 'QUARANTINED_REVIEW',
      });
    });

    it('samples low-friction releases for route audits', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      });

      await api.sampleRightsRouteAudits(
        { limit: 10, reason: 'Weekly policy sample.' },
        'admin-token',
      );

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/metadata/rights-reassessments/audit-sample');
      expect(opts.method).toBe('POST');
      expect(opts.headers.get('Authorization')).toBe('Bearer admin-token');
      expect(JSON.parse(opts.body)).toEqual({
        limit: 10,
        reason: 'Weekly policy sample.',
      });
    });

    it('lists pending release rights-upgrade requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              id: 'req-1',
              releaseId: 'rel-1',
              artistId: 'artist-1',
              requestedByAddress: '0xabc',
              status: 'submitted',
              requestedRoute: 'STANDARD_ESCROW',
              currentRouteAtSubmission: 'LIMITED_MONITORING',
              summary: 'Please review this release.',
              createdAt: '2026-04-11T00:00:00.000Z',
              updatedAt: '2026-04-11T00:00:00.000Z',
            },
          ]),
      });

      await api.listPendingReleaseRightsUpgradeRequests('test-token', 50);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-api:3000/metadata/release-rights/requests/pending?limit=50');
      expect(opts.headers.get('Authorization')).toBe('Bearer test-token');
    });
  });
});
