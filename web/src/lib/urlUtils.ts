/**
 * Sanitize a stem/catalog URL for browser playback.
 *
 * Handles two cases:
 * 1. Relative paths (e.g. `/catalog/stems/...`) → prefixed with apiBase
 * 2. Docker-internal hostnames (e.g. `http://host.docker.internal:3000/...`)
 *    → replaced with apiBase so the browser can resolve them
 */
export function sanitizeStemUrl(
  url: string | undefined | null,
  apiBase?: string,
): string | undefined {
  if (!url) return undefined;

  const base = apiBase ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

  // Replace Docker-internal hostname with browser-reachable base
  if (url.includes("host.docker.internal")) {
    return url.replace(/https?:\/\/host\.docker\.internal:\d+/, base);
  }

  // Resolve relative paths
  if (!url.startsWith("http")) {
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  return url;
}

/**
 * Build a browser-playable stream URL for a track.
 *
 * IMPORTANT: The raw stem.uri stored in the database is a storage path
 * (e.g. `/uploads/stems/<id>/vocals.wav`) that is NOT directly served
 * by the backend as a static file. The browser needs to go through the
 * catalog stream endpoint, which reads the data from storage and serves
 * it with the correct Content-Type header.
 *
 * Priority:
 * 1. Catalog stream endpoint (always preferred when releaseId + trackId available)
 * 2. Raw stem URI (fallback only — should not happen in practice)
 *
 * @see https://github.com/akoita/resonate/issues/XXX — regression: NotSupportedError on playback
 */
export function buildTrackStreamUrl(
  opts: {
    releaseId?: string | null;
    trackId?: string | null;
    stemUri?: string | null;
    apiBase?: string;
  },
): string | undefined {
  const base = opts.apiBase ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

  // Always prefer the catalog stream endpoint — it serves audio with proper Content-Type
  if (opts.releaseId && opts.trackId) {
    return `${base}/catalog/releases/${opts.releaseId}/tracks/${opts.trackId}/stream`;
  }

  // Fallback: sanitize and use raw stem URI (shouldn't be hit in normal flows)
  return sanitizeStemUrl(opts.stemUri, base);
}
