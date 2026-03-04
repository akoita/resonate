/**
 * urlUtils unit tests — Issue #362
 *
 * Tests sanitizeStemUrl which handles:
 * - Relative paths → prefixed with API base
 * - Docker-internal hostnames → replaced with browser-reachable base
 * - Already-absolute URLs → passed through
 * - Null/undefined → returns undefined
 */
import { describe, it, expect } from 'vitest';
import { sanitizeStemUrl } from './urlUtils';

describe('sanitizeStemUrl', () => {
  const apiBase = 'http://localhost:3000';

  it('returns undefined for null/undefined/empty', () => {
    expect(sanitizeStemUrl(null)).toBeUndefined();
    expect(sanitizeStemUrl(undefined)).toBeUndefined();
    expect(sanitizeStemUrl('')).toBeUndefined();
  });

  it('prefixes relative paths starting with /', () => {
    expect(sanitizeStemUrl('/catalog/stems/stem-1/blob', apiBase)).toBe(
      'http://localhost:3000/catalog/stems/stem-1/blob',
    );
  });

  it('prefixes relative paths not starting with /', () => {
    expect(sanitizeStemUrl('catalog/stems/stem-1/blob', apiBase)).toBe(
      'http://localhost:3000/catalog/stems/stem-1/blob',
    );
  });

  it('replaces host.docker.internal hostname', () => {
    expect(
      sanitizeStemUrl(
        'http://host.docker.internal:3000/catalog/stems/abc/blob',
        apiBase,
      ),
    ).toBe('http://localhost:3000/catalog/stems/abc/blob');
  });

  it('replaces host.docker.internal with https', () => {
    expect(
      sanitizeStemUrl(
        'https://host.docker.internal:8443/catalog/stems/abc/blob',
        apiBase,
      ),
    ).toBe('http://localhost:3000/catalog/stems/abc/blob');
  });

  it('passes through absolute URLs unchanged', () => {
    const url = 'https://storage.googleapis.com/bucket/file.wav';
    expect(sanitizeStemUrl(url, apiBase)).toBe(url);
  });

  it('passes through IPFS gateway URLs unchanged', () => {
    const url = 'https://gateway.lighthouse.storage/ipfs/QmABC123';
    expect(sanitizeStemUrl(url, apiBase)).toBe(url);
  });
});

/**
 * Regression tests for buildTrackStreamUrl
 *
 * This function was introduced to fix a playback regression where the browser
 * received a raw storage path (e.g. /uploads/stems/...) as the audio source,
 * causing NotSupportedError: "Failed to load because no supported source was found."
 *
 * The fix ensures the catalog stream endpoint is ALWAYS preferred — it reads
 * audio data from storage and serves it with the correct Content-Type header.
 */
import { buildTrackStreamUrl } from './urlUtils';

describe('buildTrackStreamUrl', () => {
  const apiBase = 'http://localhost:3000';

  it('uses catalog stream endpoint when releaseId and trackId are available', () => {
    expect(buildTrackStreamUrl({
      releaseId: 'rel_123',
      trackId: 'trk_456',
      stemUri: '/uploads/stems/abc/vocals.wav',
      apiBase,
    })).toBe('http://localhost:3000/catalog/releases/rel_123/tracks/trk_456/stream');
  });

  it('REGRESSION: prefers stream endpoint over raw stem URI (prevents NotSupportedError)', () => {
    // This was the original bug: stem.uri is always non-null, so it was tried first.
    // The browser can't play raw storage paths → NotSupportedError.
    const result = buildTrackStreamUrl({
      releaseId: 'rel_abc',
      trackId: 'trk_def',
      stemUri: '/uploads/stems/xyz/vocals.wav', // raw storage path — not playable
      apiBase,
    });
    expect(result).toBe('http://localhost:3000/catalog/releases/rel_abc/tracks/trk_def/stream');
    expect(result).not.toContain('/uploads/stems/'); // must NOT use raw path
  });

  it('falls back to sanitized stem URI when releaseId is missing', () => {
    expect(buildTrackStreamUrl({
      releaseId: null,
      trackId: 'trk_456',
      stemUri: '/catalog/stems/stem-1/preview',
      apiBase,
    })).toBe('http://localhost:3000/catalog/stems/stem-1/preview');
  });

  it('falls back to sanitized stem URI when trackId is missing', () => {
    expect(buildTrackStreamUrl({
      releaseId: 'rel_123',
      trackId: null,
      stemUri: 'https://ipfs.io/ipfs/QmABC123',
      apiBase,
    })).toBe('https://ipfs.io/ipfs/QmABC123');
  });

  it('returns undefined when all inputs are missing', () => {
    expect(buildTrackStreamUrl({
      releaseId: null,
      trackId: null,
      stemUri: null,
      apiBase,
    })).toBeUndefined();
  });
});
