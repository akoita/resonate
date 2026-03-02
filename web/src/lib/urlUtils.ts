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
