import { Injectable, Logger } from '@nestjs/common';
import {
    EncryptionProvider,
    EncryptionContext,
    EncryptedPayload,
    DecryptionContext,
} from '../encryption_provider';

/**
 * No-Op Encryption Provider
 * 
 * Pass-through provider that performs no encryption.
 * Used when ENCRYPTION_ENABLED=false for development/testing.
 */
@Injectable()
export class NoopEncryptionProvider extends EncryptionProvider {
    readonly providerName = 'none';
    private readonly logger = new Logger(NoopEncryptionProvider.name);

    constructor() {
        super();
        this.logger.warn('NoOp Encryption Provider initialized - data will NOT be encrypted');
    }

    isReady(): boolean {
        return true;
    }

    async encrypt(data: Buffer, context: EncryptionContext): Promise<EncryptedPayload | null> {
        // Return null to indicate no encryption was performed
        this.logger.log(`[NoOp] Skipping encryption for ${context.contentId}`);
        return null;
    }

    async decrypt(encryptedData: Buffer, context: DecryptionContext): Promise<Buffer> {
        // Just return the data as-is (it's not actually encrypted)
        this.logger.log(`[NoOp] Passing through unencrypted data`);
        return encryptedData;
    }

    async verifyAccess(context: DecryptionContext): Promise<boolean> {
        // Always grant access when encryption is disabled
        return true;
    }
}
