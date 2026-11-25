/**
 * HTTP byte ranges for audio delivery (#2661).
 *
 * Only a single range is supported (`bytes=a-b`, `bytes=a-`, `bytes=-n`), which
 * is what media elements send. Multi-range requests are treated as unsatisfiable.
 */
export interface ByteRange {
  start: number;
  end: number;
}

/** Resolves a Range header against a known size; null when unsatisfiable. */
export function parseByteRange(header: string | undefined | null, total: number): ByteRange | null {
  if (!header || total <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, total - suffix), end: total - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start >= total) return null;
  const end = rawEnd ? Math.min(Number(rawEnd), total - 1) : total - 1;
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { start, end };
}

/**
 * Caps a request to at most `maxBytes` from its start, before the object size
 * is known. A server may answer a smaller range than asked; media players
 * request the rest. Returns the header to forward, or null when malformed.
 */
export function capRangeHeader(header: string | undefined | null, maxBytes: number): string | null {
  if (!header) return `bytes=0-${maxBytes - 1}`;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return `bytes=-${Math.min(suffix, maxBytes)}`;
  }
  const start = Number(rawStart);
  if (!Number.isSafeInteger(start)) return null;
  const cappedEnd = start + maxBytes - 1;
  const end = rawEnd ? Math.min(Number(rawEnd), cappedEnd) : cappedEnd;
  if (!Number.isSafeInteger(end) || end < start) return null;
  return `bytes=${start}-${end}`;
}
