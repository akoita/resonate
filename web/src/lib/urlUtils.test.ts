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
