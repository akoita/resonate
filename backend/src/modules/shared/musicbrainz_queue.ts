/**
 * One MusicBrainz request at a time, at most one per second, for the whole
 * process (#2538).
 *
 * MusicBrainz asks every client to stay at or under one request per second
 * per IP and to send a descriptive User-Agent with a contact
 * (https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting). Artist
 * enrichment and the local-library album lookup both call it from this
 * server's address, so they share this queue rather than each keeping its own
 * one-per-second budget.
 */

/** Identifies Resonate to the public metadata providers it reads. */
export const PROVIDER_USER_AGENT = "Resonate/0.1 (https://github.com/akoita/resonate)";

export const MUSICBRAINZ_ORIGIN = "https://musicbrainz.org";

const MUSICBRAINZ_MIN_INTERVAL_MS = 1_000;

let queue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

/**
 * Runs `operation` once every request queued before it has finished and at
 * least a second has passed since the previous one started. When the
 * operation fails with a provider's Retry-After, `retryAfterMs` returns it and
 * the next request waits that long instead.
 */
export function scheduleMusicBrainzRequest<T>(
    operation: () => Promise<T>,
    retryAfterMs: (error: unknown) => number = () => 0,
): Promise<T> {
    const pending = queue.then(async () => {
        const waitMs = nextRequestAt - Date.now();
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        nextRequestAt = Date.now() + MUSICBRAINZ_MIN_INTERVAL_MS;
        try {
            return await operation();
        } catch (error) {
            const retryMs = retryAfterMs(error);
            if (retryMs > 0) nextRequestAt = Math.max(nextRequestAt, Date.now() + retryMs);
            throw error;
        }
    });
    queue = pending.then(() => undefined, () => undefined);
    return pending;
}
