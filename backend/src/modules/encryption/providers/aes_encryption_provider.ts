import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';
import { verifyMessage, getAddress } from 'viem';
import {
    EncryptionProvider,
    EncryptionContext,
    EncryptedPayload,
    DecryptionContext,
} from '../encryption_provider';

interface AesMetadata {
    iv: string;          // Initialization vector (hex)
    authTag: string;     // GCM auth tag (hex)
    keyId: string;       // Key identifier for key rotation support
    ownerAddress: string;
    allowedAddresses: string[];
    version: number;     // Metadata version for future compatibility
}

/**
 * AES-256-GCM Encryption Provider
 * 
 * Server-side encryption using AES-256 in GCM mode.
 * Keys are derived from a master secret + content-specific salt.
 * 
 * Trade-offs:
 * - Centralized: Server holds the keys
 * - Fast: Hardware-accelerated AES
 * - No external dependencies or rate limits
 * 
 * Can be swapped for decentralized provider (Lit, Threshold) later.
 */
@Injectable()
export class AesEncryptionProvider extends EncryptionProvider {
    readonly providerName = 'aes';
    private readonly logger = new Logger(AesEncryptionProvider.name);
    private readonly masterKey: Buffer;
    private readonly keyVersion = 1;

    constructor(private readonly configService: ConfigService) {
        super();

        // Derive master key from secret (in production, use proper key management)
        const secret = this.configService.get<string>('ENCRYPTION_SECRET')
            || this.configService.get<string>('JWT_SECRET')
            || 'dev-encryption-secret-change-in-production';

        // Use SHA-256 to derive a 32-byte key from the secret
        this.masterKey = createHash('sha256').update(secret).digest();

        this.logger.log('AES-256-GCM Encryption Provider initialized');
    }

    isReady(): boolean {
        return true; // AES is always ready (no external dependencies)
    }

    /**
     * Derive a content-specific key from master key + content ID
     * This allows for key rotation and content-specific access control
     */
    private deriveKey(contentId: string): Buffer {
        const salt = createHash('sha256').update(contentId).digest();
        // HKDF-like derivation: HMAC(masterKey, salt)
        const hmac = createHash('sha256');
        hmac.update(Buffer.concat([this.masterKey, salt]));
        return hmac.digest();
    }

    async encrypt(data: Buffer, context: EncryptionContext): Promise<EncryptedPayload | null> {
        try {
            const key = this.deriveKey(context.contentId);
            const iv = randomBytes(16); // 128-bit IV for GCM

            const cipher = createCipheriv('aes-256-gcm', key, iv);
            const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
            const authTag = cipher.getAuthTag();

            const metadata: AesMetadata = {
                iv: iv.toString('hex'),
                authTag: authTag.toString('hex'),
                keyId: context.contentId,
                ownerAddress: context.ownerAddress.toLowerCase(),
                allowedAddresses: [
                    context.ownerAddress.toLowerCase(),
                    ...(context.allowedAddresses || []).map(a => a.toLowerCase()),
                ],
                version: this.keyVersion,
            };

            this.logger.log(`[AES] Encrypted ${data.length} bytes for content ${context.contentId}`);

            return {
                encryptedData: encrypted,
                metadata: JSON.stringify(metadata),
                provider: 'aes',
            };
        } catch (error: any) {
            this.logger.error(`[AES] Encryption failed: ${error.message}`);
            throw error;
        }
    }

    async decrypt(encryptedData: Buffer, context: DecryptionContext): Promise<Buffer> {
        try {
            const metadata: AesMetadata = JSON.parse(context.metadata);

            // Verify access before decrypting
            const hasAccess = await this.verifyAccess(context);
            if (!hasAccess) {
                throw new Error('Access denied: User not authorized to decrypt this content');
            }

            const key = this.deriveKey(metadata.keyId);
            const iv = Buffer.from(metadata.iv, 'hex');
            const authTag = Buffer.from(metadata.authTag, 'hex');

            const decipher = createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);

            const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

            this.logger.log(`[AES] Decrypted ${decrypted.length} bytes for ${context.requesterAddress}`);

            return decrypted;
        } catch (error: any) {
            this.logger.error(`[AES] Decryption failed: ${error.message}`);
            throw error;
        }
    }

    async verifyAccess(context: DecryptionContext): Promise<boolean> {
        try {
            // MVP: Allow any authenticated user (valid wallet signature)
            // Future: Check allowedAddresses, NFT ownership, purchase records, etc.

            if (!context.authSig) {
                this.logger.warn('[AES] No authSig provided - access denied');
                return false;
            }

            // Special case: allow preview address (used by backend to proxy previews)
            if (context.authSig.address === '0x0000000000000000000000000000000000000000') {
                this.logger.log('[AES] Access granted for internal preview request');
                return true;
            }

            // Special case: ownership already verified by download endpoint
            if (context.authSig.sig === 'ownership-verified') {
                this.logger.log(`[AES] Access granted via ownership verification for ${context.authSig.address}`);
                return true;
            }

            // Check if requester is the content owner (skip sig verification)
            if (context.metadata) {
                try {
                    const metadata: AesMetadata = JSON.parse(context.metadata);
                    const requesterAddr = context.authSig.address.toLowerCase();
                    if (metadata.ownerAddress === requesterAddr ||
                        metadata.allowedAddresses?.map(a => a.toLowerCase()).includes(requesterAddr)) {
                        this.logger.log(`[AES] Access granted for owner/allowed address: ${context.authSig.address}`);
                        return true;
                    }
                } catch (e) {
                    // metadata parse failure, continue with sig verification
                }
            }

            // Try standard EOA signature verification first
            try {
                const isValidSig = await verifyMessage({
                    address: getAddress(context.authSig.address),
                    message: context.authSig.signedMessage,
                    signature: context.authSig.sig as `0x${string}`,
                });

                if (isValidSig) {
                    this.logger.log(`[AES] Access granted for authenticated user: ${context.authSig.address}`);
                    return true;
                }
            } catch (eoaErr: any) {
                // EOA verification failed (e.g. invalid signature length for smart contract wallets)
                this.logger.debug(`[AES] EOA sig verification failed, trying EIP-1271: ${eoaErr.message}`);
            }

            // Fallback: EIP-1271 smart contract wallet verification (ZeroDev/Kernel)
            try {
                const { createPublicClient, http } = await import('viem');
                const { sepolia } = await import('viem/chains');
                const publicClient = createPublicClient({
                    chain: sepolia,
                    transport: http(),
                });
                const isValid = await publicClient.verifyMessage({
                    address: getAddress(context.authSig.address),
                    message: context.authSig.signedMessage,
                    signature: context.authSig.sig as `0x${string}`,
                });
                if (isValid) {
                    this.logger.log(`[AES] Access granted via EIP-1271 for: ${context.authSig.address}`);
                    return true;
                }
            } catch (eip1271Err: any) {
                this.logger.debug(`[AES] EIP-1271 verification also failed: ${eip1271Err.message}`);
            }

            this.logger.warn(`[AES] All verification methods failed for ${context.authSig.address}`);
            return false;
        } catch (error: any) {
            this.logger.error(`[AES] Access verification failed: ${error.message}`);
            return false;
        }
    }
}
