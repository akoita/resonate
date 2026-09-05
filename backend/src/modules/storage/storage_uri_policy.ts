/**
 * Storage URI policy for server-side reads.
 *
 * Storage URIs are persisted data and therefore must not be treated as
 * arbitrary fetch destinations.  Each parser below accepts only the forms
 * produced by the corresponding provider (plus the documented compatibility
 * forms) and returns the one canonical network target that may be fetched.
 */

export type StorageUriPolicyProvider = 'gcs' | 'lighthouse' | 'local' | 'source';

export class StorageUriPolicyError extends Error {
    readonly code = 'STORAGE_URI_POLICY_REJECTED';

    constructor(
        readonly provider: StorageUriPolicyProvider,
        reason = 'unsupported storage URI',
    ) {
        super(`${provider} storage URI rejected: ${reason}`);
        this.name = 'StorageUriPolicyError';
    }
}

export interface GcsStorageUri {
    provider: 'gcs';
    bucket: string;
    objectPath: string;
    target: string;
}

export interface LighthouseStorageUri {
    provider: 'lighthouse';
    cid: string;
    target: string;
}

export interface LocalStorageUri {
    provider: 'local';
    filename: string;
    /** The relative catalog form, regardless of which accepted input form was used. */
    relativePath: string;
    target?: string;
}

export const LIGHTHOUSE_GATEWAY_ORIGIN = 'https://gateway.lighthouse.storage';
export const LIGHTHOUSE_GATEWAY_PREFIX = `${LIGHTHOUSE_GATEWAY_ORIGIN}/ipfs/`;

const CID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

function reject(provider: StorageUriPolicyProvider, reason: string): never {
    throw new StorageUriPolicyError(provider, reason);
}

function requireString(uri: string, provider: StorageUriPolicyProvider): string {
    if (typeof uri !== 'string' || uri.length === 0 || uri.trim() !== uri) {
        return reject(provider, 'URI must be a non-empty string without surrounding whitespace');
    }
    return uri;
}

function isSafePath(path: string): boolean {
    // Percent escapes are intentionally rejected in storage paths.  They can
    // hide separators/dot segments and make policy decisions differ from the
    // URL parser or the filesystem resolver.
    if (!path || path.includes('%') || path.includes('\\')) return false;
    if (/^[\u0000-\u001f\u007f]/.test(path) || /[\u0000-\u001f\u007f]/.test(path)) {
        return false;
    }

    const segments = path.split('/');
    return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeBucket(bucket: string): string {
    if (!bucket || bucket.includes('/') || bucket.includes('%') || bucket.includes('\\')) {
        throw new Error('invalid configured GCS bucket');
    }
    return bucket;
}

/**
 * Resolve the supported GCS URI forms to the exact Google Storage target.
 *
 * Accepted inputs:
 *   - gs://{configuredBucket}/{object}
 *   - https://storage.googleapis.com/{configuredBucket}/{object}
 *   - /{configuredBucket}/{object} (and the historical no-leading-slash form)
 */
export function resolveGcsStorageUri(uri: string, configuredBucket: string): GcsStorageUri {
    const value = requireString(uri, 'gcs');
    const bucket = safeBucket(configuredBucket);
    const escapedBucket = escapeRegExp(bucket);

    let objectPath: string | undefined;

    const gsMatch = value.match(new RegExp(`^gs://${escapedBucket}/(.+)$`));
    if (gsMatch) {
        objectPath = gsMatch[1];
    } else if (value.startsWith('gs://')) {
        return reject('gcs', 'GCS URI must use the configured bucket and a non-empty object path');
    }

    const httpsMatch = value.match(
        new RegExp(`^https://storage\\.googleapis\\.com/${escapedBucket}/(.+)$`),
    );
    if (httpsMatch) {
        objectPath = httpsMatch[1];
    } else if (value.startsWith('http://') || value.startsWith('https://')) {
        return reject('gcs', 'GCS URI must use the exact HTTPS storage.googleapis.com authority');
    }

    if (objectPath === undefined) {
        const relativeMatch = value.match(new RegExp(`^/?${escapedBucket}/(.+)$`));
        if (!relativeMatch) {
            return reject('gcs', 'GCS URI must be bucket-prefixed');
        }
        objectPath = relativeMatch[1];
    }

    if (!isSafePath(objectPath) || objectPath.includes('?') || objectPath.includes('#')) {
        return reject('gcs', 'GCS object path is empty, ambiguous, or unsafe');
    }

    return {
        provider: 'gcs',
        bucket,
        objectPath,
        target: `https://storage.googleapis.com/${bucket}/${objectPath}`,
    };
}

/** Alias kept deliberately small for callers that prefer parser terminology. */
export const parseGcsStorageUri = resolveGcsStorageUri;
export const resolveGcsUri = resolveGcsStorageUri;

/**
 * Resolve the supported Lighthouse/IPFS URI forms to the exact Lighthouse
 * gateway target.
 */
export function resolveLighthouseStorageUri(uri: string): LighthouseStorageUri {
    const value = requireString(uri, 'lighthouse');
    let cid: string | undefined;

    const ipfsMatch = value.match(/^ipfs:\/\/([^/?#]+)$/);
    if (ipfsMatch) {
        cid = ipfsMatch[1];
    } else if (value.startsWith('ipfs://')) {
        return reject('lighthouse', 'IPFS URI must contain exactly one CID segment');
    }

    const gatewayMatch = value.match(/^https:\/\/gateway\.lighthouse\.storage\/ipfs\/([^/?#]+)$/);
    if (gatewayMatch) {
        cid = gatewayMatch[1];
    } else if (value.startsWith('http://') || value.startsWith('https://')) {
        return reject('lighthouse', 'IPFS URI must use the exact HTTPS Lighthouse gateway');
    }

    if (!cid || cid.includes('%') || cid.includes('\\') || !CID_PATTERN.test(cid)) {
        return reject('lighthouse', 'CID is empty, ambiguous, or unsafe');
    }

    return {
        provider: 'lighthouse',
        cid,
        target: `${LIGHTHOUSE_GATEWAY_PREFIX}${cid}`,
    };
}

/** Alias kept deliberately small for callers that prefer parser terminology. */
export const parseLighthouseStorageUri = resolveLighthouseStorageUri;
export const resolveIpfsStorageUri = resolveLighthouseStorageUri;
export const resolveIpfsUri = resolveLighthouseStorageUri;

export interface LocalStorageUriOptions {
    /** Exact backend origin accepted for the historical absolute URL form. */
    backendOrigin?: string;
}

function isSafeFilename(filename: string): boolean {
    return (
        filename.length > 0 &&
        filename !== '.' &&
        filename !== '..' &&
        !filename.includes('/') &&
        !filename.includes('\\') &&
        !filename.includes('%') &&
        !/[\u0000-\u001f\u007f]/.test(filename) &&
        !filename.includes('?') &&
        !filename.includes('#')
    );
}

/**
 * Resolve the provider-generated local catalog form.  Absolute URLs are
 * accepted only when they use the exact configured loopback backend origin.
 */
export function resolveLocalStorageUri(
    uri: string,
    options: LocalStorageUriOptions = {},
): LocalStorageUri {
    const value = requireString(uri, 'local');
    const relativeMatch = value.match(/^\/catalog\/stems\/([^/]+)\/blob$/);
    let filename: string | undefined;
    let target: string | undefined;

    if (relativeMatch) {
        filename = relativeMatch[1];
    } else if (value.startsWith('/')) {
        return reject('local', 'local URI must use /catalog/stems/{filename}/blob');
    } else {
        const backendOrigin = options.backendOrigin;
        if (!backendOrigin || !value.startsWith(`${backendOrigin}/`)) {
            return reject('local', 'absolute local URI must use the exact loopback backend origin');
        }

        const path = value.slice(backendOrigin.length);
        const absoluteMatch = path.match(/^\/catalog\/stems\/([^/]+)\/blob$/);
        if (!absoluteMatch) {
            return reject('local', 'local URI must use /catalog/stems/{filename}/blob');
        }
        filename = absoluteMatch[1];
        target = `${backendOrigin}/catalog/stems/${filename}/blob`;
    }

    if (!filename || !isSafeFilename(filename)) {
        return reject('local', 'local filename is empty, ambiguous, or unsafe');
    }

    return {
        provider: 'local',
        filename,
        relativePath: `/catalog/stems/${filename}/blob`,
        target,
    };
}

export const parseLocalStorageUri = resolveLocalStorageUri;
export const resolveLocalUri = resolveLocalStorageUri;

/** Validate a filename before a provider constructs its canonical URI. */
export function assertSafeLocalFilename(filename: string): string {
    if (typeof filename !== 'string' || !isSafeFilename(filename)) {
        return reject('local', 'local filename is empty, ambiguous, or unsafe');
    }
    return filename;
}
