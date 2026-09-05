import { StorageUriPolicyError } from './storage_uri_policy';

/** Maximum time allowed for a complete GCS read, including redirects/body. */
export const GCS_REMOTE_FETCH_TIMEOUT_MS = 30_000;
/** Maximum time allowed for a complete Lighthouse/IPFS read, including redirects/body. */
export const IPFS_REMOTE_FETCH_TIMEOUT_MS = 120_000;
/** Maximum response size for all bounded remote reads, including range reads. */
export const BOUNDED_REMOTE_RESPONSE_CEILING_BYTES = 200 * 1024 * 1024;
/** Maximum number of redirects followed by a bounded remote read. */
export const BOUNDED_REMOTE_MAX_REDIRECTS = 5;

// Short aliases make the fixed policy constants convenient to consume while
// retaining the explicit names above for documentation and call-site review.
export const GCS_FETCH_TIMEOUT_MS = GCS_REMOTE_FETCH_TIMEOUT_MS;
export const IPFS_FETCH_TIMEOUT_MS = IPFS_REMOTE_FETCH_TIMEOUT_MS;
export const MAX_REMOTE_RESPONSE_BYTES = BOUNDED_REMOTE_RESPONSE_CEILING_BYTES;

export interface BoundedRemoteFetchOptions {
    timeoutMs: number;
    requestTimeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
    headers?: HeadersInit;
    /** Called for the initial target and every redirect before the next fetch. */
    validateTarget?: (target: string) => void;
}

export interface BoundedRemoteFetchResult {
    data: Buffer;
    status: number;
    headers: Headers;
    url: string;
}

export class BoundedRemoteFetchError extends Error {
    readonly code: string = 'BOUNDED_REMOTE_FETCH_FAILED';

    constructor(message: string) {
        super(message);
        this.name = 'BoundedRemoteFetchError';
    }
}

export class BoundedRemoteResponseLimitError extends BoundedRemoteFetchError {
    readonly code = 'BOUNDED_REMOTE_RESPONSE_LIMIT';

    constructor(readonly limitBytes: number, readonly actualBytes?: number) {
        super(
            actualBytes === undefined
                ? `Remote response declares more than ${limitBytes} bytes`
                : `Remote response exceeds the ${limitBytes}-byte ceiling`,
        );
        this.name = 'BoundedRemoteResponseLimitError';
    }
}

function assertInitialHttpTarget(target: string): void {
    let parsed: URL;
    try {
        parsed = new URL(target);
    } catch {
        throw new BoundedRemoteFetchError('Remote target is not a valid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new BoundedRemoteFetchError('Remote target must use HTTP(S)');
    }
}

function normalizeHeaders(input: Headers | undefined): Headers {
    if (input && typeof input.get === 'function') return input;
    if (input) {
        try {
            return new Headers(input as HeadersInit);
        } catch {
            // Fall through to an empty header set for a non-standard test or
            // fetch implementation response shape.
        }
    }
    return new Headers();
}

function declaredContentLength(headers: Headers): number | null {
    const value = headers.get('content-length');
    if (value === null || value.trim() === '') return null;
    if (!/^\d+$/.test(value.trim())) {
        throw new BoundedRemoteFetchError('Remote response has an invalid content length');
    }
    return Number(value);
}

async function readResponseBody(
    response: Response,
    maxBytes: number,
    headers: Headers,
): Promise<Buffer> {
    const declaredLength = declaredContentLength(headers);
    if (declaredLength !== null && declaredLength > maxBytes) {
        throw new BoundedRemoteResponseLimitError(maxBytes, declaredLength);
    }

    if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let total = 0;
        try {
            while (true) {
                const result = await reader.read();
                if (result.done) break;
                const chunk = Buffer.from(result.value as Uint8Array);
                total += chunk.length;
                if (total > maxBytes) {
                    await reader.cancel().catch(() => undefined);
                    throw new BoundedRemoteResponseLimitError(maxBytes, total);
                }
                chunks.push(chunk);
            }
        } finally {
            reader.releaseLock?.();
        }
        return Buffer.concat(chunks, total);
    }

    // Lightweight test doubles and a few compatible fetch implementations do
    // not expose a ReadableStream.  arrayBuffer is still counted before the
    // resulting Buffer is returned.
    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    if (data.length > maxBytes) {
        throw new BoundedRemoteResponseLimitError(maxBytes, data.length);
    }
    return data;
}

function redirectStatus(status: number): boolean {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function absoluteRedirectLocation(location: string, target: string): string | null {
    if (location.startsWith('//')) {
        return `${new URL(target).protocol}${location}`;
    }
    return /^[a-z][a-z\d+.-]*:\/\//i.test(location) ? location : null;
}

function assertUnambiguousRedirectLocation(location: string): void {
    if (location.trim() !== location || location.includes('%') || location.includes('\\')) {
        throw new BoundedRemoteFetchError('Remote redirect Location is ambiguous');
    }

    const path = location.split(/[?#]/, 1)[0];
    if (path.split('/').some((segment) => segment === '.' || segment === '..')) {
        throw new BoundedRemoteFetchError('Remote redirect Location is ambiguous');
    }
}

function remainingTime(deadline: number): number {
    return Math.max(0, deadline - Date.now());
}

/**
 * Fetch a remote body with redirect, timeout, and response-size boundaries.
 * The target validator runs before the first request and before each redirect
 * request, while `redirect: manual` ensures a fetch implementation cannot
 * follow an unvalidated Location internally.
 */
export async function fetchBoundedRemote(
    initialTarget: string,
    options: BoundedRemoteFetchOptions,
): Promise<BoundedRemoteFetchResult> {
    const maxBytes = options.maxBytes ?? BOUNDED_REMOTE_RESPONSE_CEILING_BYTES;
    const maxRedirects = options.maxRedirects ?? BOUNDED_REMOTE_MAX_REDIRECTS;
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new BoundedRemoteFetchError('Remote fetch timeout must be positive');
    }
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
        throw new BoundedRemoteFetchError('Remote response ceiling must be positive');
    }

    assertInitialHttpTarget(initialTarget);
    options.validateTarget?.(initialTarget);

    const deadline = Date.now() + options.timeoutMs;
    let target = initialTarget;
    let redirects = 0;

    while (true) {
        const remaining = remainingTime(deadline);
        if (remaining <= 0) {
            throw new BoundedRemoteFetchError('Remote fetch timed out');
        }

        const requestTimeout = Math.min(
            remaining,
            options.requestTimeoutMs ?? options.timeoutMs,
        );
        const controller = new AbortController();
        let rejectTimeout: (reason?: unknown) => void = () => undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            rejectTimeout = reject;
        });
        const timer = setTimeout(() => {
            controller.abort();
            rejectTimeout(new BoundedRemoteFetchError('Remote fetch timed out'));
        }, requestTimeout);
        let response: Response;
        try {
            response = await Promise.race([
                fetch(target, {
                    headers: options.headers,
                    redirect: 'manual',
                    signal: controller.signal,
                }),
                timeoutPromise,
            ]);
        } catch (error) {
            clearTimeout(timer);
            if (controller.signal.aborted) {
                throw new BoundedRemoteFetchError('Remote fetch timed out');
            }
            throw error;
        }

        const status = response.status ?? (response.ok === false ? 500 : 200);
        const headers = normalizeHeaders(response.headers);
        if (redirectStatus(status)) {
            const location = headers.get('location');
            if (!location) {
                clearTimeout(timer);
                throw new BoundedRemoteFetchError('Remote redirect did not include a Location');
            }
            if (redirects >= maxRedirects) {
                clearTimeout(timer);
                throw new BoundedRemoteFetchError('Remote redirect limit exceeded');
            }

            let nextTarget: string;
            try {
                assertUnambiguousRedirectLocation(location);
                // Validate an absolute Location in its raw form before URL
                // normalization can hide explicit default ports, dot
                // segments, or other syntax that the provider policy rejects.
                const rawAbsoluteLocation = absoluteRedirectLocation(location, target);
                if (rawAbsoluteLocation) {
                    options.validateTarget?.(rawAbsoluteLocation);
                }
                nextTarget = new URL(location, target).toString();
                options.validateTarget?.(nextTarget);
            } catch (error) {
                clearTimeout(timer);
                // Preserve the typed storage-policy rejection so callers can
                // distinguish a redirect escape from provider downtime.
                if (error instanceof StorageUriPolicyError) throw error;
                throw new BoundedRemoteFetchError('Remote redirect Location is invalid');
            }
            try {
                assertInitialHttpTarget(nextTarget);
            } catch (error) {
                clearTimeout(timer);
                throw error;
            }
            target = nextTarget;
            redirects += 1;
            clearTimeout(timer);
            continue;
        }

        try {
            const data = await Promise.race([
                readResponseBody(response, maxBytes, headers),
                timeoutPromise,
            ]);
            return {
                data,
                status,
                headers,
                url: target,
            };
        } catch (error) {
            if (controller.signal.aborted) {
                throw new BoundedRemoteFetchError('Remote fetch timed out');
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }
}

export const boundedRemoteFetch = fetchBoundedRemote;
