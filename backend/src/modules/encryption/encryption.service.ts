import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
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
    ) {
        if (!existsSync(this.cacheDir)) {
            mkdirSync(this.cacheDir, { recursive: true });
        }
        this.logger.log(`Encryption Service initialized with provider: ${this.provider.providerName}`);
    }

    get isReady(): boolean {
        return this.provider.isReady();
    }

    get providerName(): string {
        return this.provider.providerName;
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

        // Fetch encrypted data from URI
        this.logger.log(`[Decrypt] Fetching encrypted data from: ${uri}`);
        const response = await fetch(uri);
        if (!response.ok) {
            throw new Error(`Failed to fetch encrypted data: ${response.status}`);
        }
        const encryptedData = Buffer.from(await response.arrayBuffer());

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
            this.logger.log(`[Decrypt] Provider is 'none', fetching raw: ${uri}`);
            const response = await fetch(uri);
            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        }

        // If no metadata or empty metadata, fall back to raw fetch
        // This handles: unencrypted tracks, old Lit tracks we can't decrypt
        if (!metadata || metadata === '{}' || metadata.trim() === '') {
            this.logger.log(`[Decrypt] No metadata provided, fetching raw: ${uri}`);
            const response = await fetch(uri);
            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        }

        // Try to parse metadata to check if it's AES format
        try {
            const parsed = JSON.parse(metadata);
            // Check if it's AES metadata (has iv, authTag, keyId)
            if (!parsed.iv || !parsed.authTag || !parsed.keyId) {
                this.logger.log(`[Decrypt] Metadata is not AES format, fetching raw: ${uri}`);
                const response = await fetch(uri);
                if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
                return Buffer.from(await response.arrayBuffer());
            }
        } catch (e) {
            // Invalid JSON, fall back to raw
            this.logger.log(`[Decrypt] Invalid metadata JSON, fetching raw: ${uri}`);
            const response = await fetch(uri);
            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        }

        return this.decryptFromUri(uri, metadata, authSig);
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
