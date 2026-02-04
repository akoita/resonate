/**
 * Encryption Provider Interface
 * 
 * Abstraction layer for encryption strategies. Implementations can be:
 * - AesEncryptionProvider: Server-side AES-256-GCM (current MVP)
 * - LitEncryptionProvider: Decentralized via Lit Protocol (future)
 * - ThresholdEncryptionProvider: Threshold Network TACo (future)
 */

export interface EncryptionContext {
    /** Unique identifier for the content (e.g., stem ID, track ID) */
    contentId: string;
    /** Owner's wallet address for access control */
    ownerAddress: string;
    /** Optional: Additional addresses that should have access */
    allowedAddresses?: string[];
    /** Optional: NFT contract for token-gated access */
    nftContract?: string;
}

export interface EncryptedPayload {
    /** The encrypted data */
    encryptedData: Buffer;
    /** Provider-specific metadata needed for decryption */
    metadata: string;
    /** Which provider was used */
    provider: 'aes' | 'lit' | 'threshold' | 'none';
}

export interface DecryptionContext {
    /** The encrypted payload metadata */
    metadata: string;
    /** Auth signature from the requesting user */
    authSig?: {
        address: string;
        sig: string;
        signedMessage: string;
    };
    /** Wallet address of the requester */
    requesterAddress: string;
}

export abstract class EncryptionProvider {
    abstract readonly providerName: string;

    /**
     * Encrypt data with access control
     * @param data Raw data to encrypt
     * @param context Encryption context with access control info
     * @returns Encrypted payload or null if encryption is disabled/skipped
     */
    abstract encrypt(data: Buffer, context: EncryptionContext): Promise<EncryptedPayload | null>;

    /**
     * Decrypt data after verifying access
     * @param encryptedData The encrypted data buffer
     * @param context Decryption context with auth info
     * @returns Decrypted data buffer
     */
    abstract decrypt(encryptedData: Buffer, context: DecryptionContext): Promise<Buffer>;

    /**
     * Verify if a user has access to decrypt content
     * @param context Decryption context with auth info
     * @returns true if access is granted
     */
    abstract verifyAccess(context: DecryptionContext): Promise<boolean>;

    /**
     * Check if the provider is ready to use
     */
    abstract isReady(): boolean;
}
