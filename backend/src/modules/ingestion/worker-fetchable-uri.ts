/**
 * Maps a stored stem URI to one the demucs worker can fetch.
 *
 * - Local catalog stems (`/catalog/stems/<file>/...`) live on the shared
 *   `/outputs` volume, so the worker receives just the filename segment.
 * - Other root-relative paths are made absolute against the backend URL.
 * - http(s) URIs and any non-`/` value (e.g. a bare filename) pass through.
 *
 * Shared by separation dispatch (`StemsProcessor`) and the audio-feature
 * backfill so both hand the worker the same shape of URI.
 */
export function toWorkerFetchableUri(
  uri: string,
  storageProvider: string | null | undefined,
  backendBaseUrl: string,
): string {
  let resolved = uri;
  if (storageProvider === "local" && resolved.startsWith("/catalog/stems/")) {
    const parts = resolved.split("/");
    const filename = parts[parts.length - 2];
    if (filename) {
      resolved = filename;
    }
  }
  return resolved.startsWith("http") || !resolved.startsWith("/")
    ? resolved
    : `${backendBaseUrl}${resolved}`;
}
