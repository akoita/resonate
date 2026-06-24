import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { StorageProvider } from '../storage/storage_provider';
import {
    EncryptionProvider,
    EncryptionContext,
    EncryptedPayload,
    DecryptionContext,
} from './encryption_provider';

// Re-export for backward compatibility
export { EncryptionContext, EncryptedPayload, DecryptionContext } from './encryption_provider';

// Legacy interface for backward compatibility with existing code
export interface EncryptionResult {
    encryptedData: Buffer;
    encryptionMetadata: string;
}

/**
 * Why a render decryption can fail, in caller-safe terms (#1214). The string
 * codes are deliberately opaque: they carry no key material, metadata, storage
 * URI, or raw provider message, so a render boundary can map them to a generic
 * user-facing error without leaking secrets.
 */
export type RenderDecryptionFailureReason =
    | 'encryption_disabled' // provider is 'none' but a row is flagged encrypted (misconfiguration)
    | 'invalid_metadata' // metadata missing/not AES-decryptable — never treat ciphertext as audio
    | 'unauthorized' // access check failed at decrypt time (e.g. permissions changed)
    | 'decryption_failed'; // key unavailable, corrupt ciphertext, or provider fault

/**
 * Raised by the strict render decryption path (#1214). Never include the
 * underlying provider error, metadata, URI, or any ciphertext in the message.
 */
export class RenderDecryptionError extends Error {
    constructor(readonly reason: RenderDecryptionFailureReason) {
        super(`render decryption failed: ${reason}`);
        this.name = 'RenderDecryptionError';
    }
}

/**
 * Encryption Service
 * 
 * Orchestrates encryption/decryption using the configured provider.
 * Adds caching layer for decrypted content to improve performance.
 * 
 * The actual encryption strategy is determined by the injected provider:
 * - AesEncryptionProvider: Server-side AES-256-GCM
 * - NoopEncryptionProvider: No encryption (development)
 * - Future: LitEncryptionProvider, ThresholdEncryptionProvider
 */
@Injectable()
export class EncryptionService {
    private readonly logger = new Logger(EncryptionService.name);
    private readonly cacheDir = join(process.cwd(), 'uploads', 'decrypted_cache');

    constructor(
        @Inject('ENCRYPTION_PROVIDER') private readonly provider: EncryptionProvider,
        private readonly configService: ConfigService,
        @Optional() @Inject(StorageProvider) private readonly storageProvider?: StorageProvider,
    ) {
        this.ensureCacheDir();
        this.logger.log(`Encryption Service initialized with provider: ${this.provider.providerName}`);
    }

    private ensureCacheDir(): void {
        if (!existsSync(this.cacheDir)) {
            mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Resolve a URI for server-side fetch.
     * Relative paths (e.g. /catalog/stems/...) are prefixed with the backend's own base URL
     * because Node.js fetch() requires absolute URLs.
     */
    private resolveUri(uri: string): string {
        if (uri.startsWith('http://') || uri.startsWith('https://')) {
            return uri;
        }
        const port = this.configService.get('PORT') || process.env.PORT || '3000';
        const baseUrl = `http://localhost:${port}`;
        return `${baseUrl}${uri.startsWith('/') ? '' : '/'}${uri}`;
    }

    get isReady(): boolean {
        return this.provider.isReady();
    }

    get providerName(): string {
        return this.provider.providerName;
    }

    private async fetchSourceBuffer(uri: string): Promise<Buffer> {
        if (this.storageProvider) {
            try {
                const downloaded = await this.storageProvider.download(uri);
                if (downloaded) {
                    this.logger.log(`[Decrypt] Loaded source via storage provider: ${uri}`);
                    return downloaded;
                }
            } catch (error: any) {
                this.logger.warn(
                    `[Decrypt] Storage provider download failed for ${uri}: ${error?.message || error}`,
                );
            }
        }

        const resolvedUri = this.resolveUri(uri);
        this.logger.log(`[Decrypt] Fetching source via HTTP: ${resolvedUri}`);
        const response = await fetch(resolvedUri);
        if (!response.ok) {
            throw new Error(`Failed to fetch encrypted data: ${response.status}`);
        }
        return Buffer.from(await response.arrayBuffer());
    }

    /**
     * Encrypt data with the configured provider
     * 
     * @param data Raw data to encrypt
     * @param context Encryption context (contentId, ownerAddress, etc.)
     * @returns EncryptedPayload or null if encryption is disabled
     */
    async encrypt(data: Buffer, context: EncryptionContext): Promise<EncryptedPayload | null> {
        return this.provider.encrypt(data, context);
    }

    /**
     * Legacy encrypt method for backward compatibility
     * Maps old access control conditions to new context format
     */
    async encryptLegacy(data: Buffer, accessControlConditions: any[]): Promise<EncryptionResult | null> {
        // Extract owner address from legacy ACC format
        let ownerAddress = '';
        for (const condition of accessControlConditions) {
            if (condition.returnValueTest?.value) {
                ownerAddress = condition.returnValueTest.value;
                break;
            }
        }

        const context: EncryptionContext = {
            contentId: `stem_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
            ownerAddress,
            allowedAddresses: [],
        };

        const result = await this.encrypt(data, context);
        if (!result) return null;

        return {
            encryptedData: result.encryptedData,
            encryptionMetadata: result.metadata,
        };
    }

    /**
     * Decrypt data from a URI with caching
     * 
     * @param uri URI to the encrypted content
     * @param metadata Provider-specific metadata
     * @param authSig Auth signature from the user
     * @returns Decrypted data buffer
     */
    async decryptFromUri(
        uri: string,
        metadata: string,
        authSig: { address: string; sig: string; signedMessage: string },
    ): Promise<Buffer> {
        // Check cache first
        const cacheKey = createHash('sha256').update(uri).digest('hex');
        const cachePath = join(this.cacheDir, `${cacheKey}.mp3`);
        this.ensureCacheDir();

        if (existsSync(cachePath)) {
            this.logger.log(`[Cache] Hit for URI: ${uri}`);

            // Verify access even for cached content
            const context: DecryptionContext = {
                metadata,
                authSig,
                requesterAddress: authSig.address,
            };

            const hasAccess = await this.provider.verifyAccess(context);
            if (hasAccess) {
                return readFileSync(cachePath);
            }
            this.logger.warn(`[Cache] Access denied for ${authSig.address}, fetching fresh`);
        }

        const encryptedData = await this.fetchSourceBuffer(uri);

        // Decrypt
        const context: DecryptionContext = {
            metadata,
            authSig,
            requesterAddress: authSig.address,
        };

        const decrypted = await this.provider.decrypt(encryptedData, context);

        // Cache the decrypted content
        writeFileSync(cachePath, decrypted);
        this.logger.log(`[Cache] Saved decrypted content for ${uri}`);

        return decrypted;
    }

    async decryptBuffer(
        encryptedData: Buffer,
        metadata: string,
        authSig: { address: string; sig: string; signedMessage: string },
        cacheKey?: string,
    ): Promise<Buffer> {
        if (this.provider.providerName === 'none') {
            return encryptedData;
        }

        if (!metadata || metadata === '{}' || metadata.trim() === '') {
            return encryptedData;
        }

        try {
            const parsed = JSON.parse(metadata);
            if (!parsed.iv || !parsed.authTag || !parsed.keyId) {
                this.logger.log('[Decrypt] Metadata is not AES format, returning raw buffer');
                return encryptedData;
            }
        } catch (e) {
            this.logger.log('[Decrypt] Invalid metadata JSON, returning raw buffer');
            return encryptedData;
        }

        const context: DecryptionContext = {
            metadata,
            authSig,
            requesterAddress: authSig.address,
        };

        if (cacheKey) {
            const cachePath = join(
                this.cacheDir,
                `${createHash('sha256').update(cacheKey).digest('hex')}.mp3`,
            );
            this.ensureCacheDir();

            if (existsSync(cachePath)) {
                this.logger.log(`[Cache] Hit for source: ${cacheKey}`);
                const hasAccess = await this.provider.verifyAccess(context);
                if (hasAccess) {
                    return readFileSync(cachePath);
                }
                this.logger.warn(`[Cache] Access denied for ${authSig.address}, decrypting fresh`);
            }

            const decrypted = await this.provider.decrypt(encryptedData, context);
            writeFileSync(cachePath, decrypted);
            this.logger.log(`[Cache] Saved decrypted content for ${cacheKey}`);
            return decrypted;
        }

        return this.provider.decrypt(encryptedData, context);
    }

    /**
     * Legacy decrypt method for backward compatibility with existing controller
     */
    async decrypt(
        uri: string,
        metadata: string, // Can be AES metadata JSON or empty
        accessControlConditions: any[], // Legacy param, kept for compatibility
        authSig: any,
    ): Promise<Buffer> {
        // For unencrypted content (provider = 'none'), just fetch
        if (this.provider.providerName === 'none') {
            return this.fetchSourceBuffer(uri);
        }

        // If no metadata or empty metadata, fall back to raw fetch
        // This handles: unencrypted tracks, old Lit tracks we can't decrypt
        if (!metadata || metadata === '{}' || metadata.trim() === '') {
            return this.fetchSourceBuffer(uri);
        }

        // Try to parse metadata to check if it's AES format
        try {
            const parsed = JSON.parse(metadata);
            // Check if it's AES metadata (has iv, authTag, keyId)
            if (!parsed.iv || !parsed.authTag || !parsed.keyId) {
                this.logger.log(`[Decrypt] Metadata is not AES format, fetching raw: ${uri}`);
                return this.fetchSourceBuffer(uri);
            }
        } catch (e) {
            // Invalid JSON, fall back to raw
            this.logger.log(`[Decrypt] Invalid metadata JSON, fetching raw: ${uri}`);
            return this.fetchSourceBuffer(uri);
        }

        return this.decryptFromUri(uri, metadata, authSig);
    }

    /**
     * Strict, in-memory decryption for server-side rendering (#1214).
     *
     * Unlike {@link decryptBuffer} and {@link decryptFromUri}, this method:
     * - NEVER writes plaintext to the on-disk decrypted cache (plaintext stays
     *   in memory; the caller keeps it process-local and short-lived);
     * - NEVER falls back to returning the raw input buffer — a row flagged
     *   `isEncrypted` must yield real plaintext or fail closed, so ciphertext
     *   can never reach ffmpeg or a generation provider;
     * - verifies access explicitly before decrypting and maps every failure to
     *   a {@link RenderDecryptionError} whose reason leaks no key, metadata,
     *   URI, or provider internals.
     *
     * @param ciphertext Already-loaded encrypted bytes (caller fetches via the
     *   contained storage boundary, so this method never touches storage).
     * @param metadata Provider-specific decryption metadata (AES JSON).
     * @param authSig Internal/owner auth context. For backend-initiated renders
     *   use the `remix-render-authorized` internal purpose plus INTERNAL_SERVICE_KEY.
     */
    async decryptForRender(
        ciphertext: Buffer,
        metadata: string,
        authSig: {
            address: string;
            sig: string;
            signedMessage: string;
            internalKey?: string;
        },
    ): Promise<Buffer> {
        // Encryption disabled but the row claims to be encrypted: a real
        // configuration error. Returning the input here would feed ciphertext
        // straight into a render, so fail closed instead.
        if (this.provider.providerName === 'none') {
            throw new RenderDecryptionError('encryption_disabled');
        }

        // Require well-formed AES metadata. Missing iv/authTag/keyId means we
        // cannot decrypt; we must NOT silently pass the raw buffer through.
        if (!metadata || metadata.trim() === '' || metadata === '{}') {
            throw new RenderDecryptionError('invalid_metadata');
        }
        try {
            const parsed = JSON.parse(metadata);
            if (!parsed?.iv || !parsed?.authTag || !parsed?.keyId) {
                throw new RenderDecryptionError('invalid_metadata');
            }
        } catch (error) {
            if (error instanceof RenderDecryptionError) throw error;
            throw new RenderDecryptionError('invalid_metadata');
        }

        const context: DecryptionContext = {
            metadata,
            authSig,
            requesterAddress: authSig.address,
        };

        // Explicit access check so an authorization failure is distinguishable
        // from a cryptographic failure without parsing provider error strings.
        let hasAccess: boolean;
        try {
            hasAccess = await this.provider.verifyAccess(context);
        } catch {
            throw new RenderDecryptionError('decryption_failed');
        }
        if (!hasAccess) {
            throw new RenderDecryptionError('unauthorized');
        }

        try {
            return await this.provider.decrypt(ciphertext, context);
        } catch {
            // Swallow the provider message: it can name keys, addresses, or
            // ciphertext sizes. Corrupt data, key rotation, or provider faults
            // all collapse to one opaque reason.
            throw new RenderDecryptionError('decryption_failed');
        }
    }

    /**
     * Verify if a user has access to content
     */
    async verifyAccess(metadata: string, requesterAddress: string, authSig?: any): Promise<boolean> {
        const context: DecryptionContext = {
            metadata,
            authSig,
            requesterAddress,
        };
        return this.provider.verifyAccess(context);
    }
}
