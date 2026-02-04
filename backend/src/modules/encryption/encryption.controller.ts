import { Controller, Post, Body, Res, HttpStatus, Logger, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { EncryptionService } from './encryption.service';

@Controller('encryption')
export class EncryptionController {
    private readonly logger = new Logger(EncryptionController.name);

    constructor(private readonly encryptionService: EncryptionService) { }

    /**
     * Decrypt endpoint - provider-agnostic
     * 
     * Required fields:
     * - uri: URL to the encrypted content
     * - authSig: { address, sig, signedMessage }
     * 
     * Optional (for backward compatibility with Lit Protocol):
     * - dataToEncryptHash: Used as metadata for AES provider
     * - accessControlConditions: Legacy Lit Protocol field
     * - metadata: Direct AES metadata (preferred for new clients)
     */
    @Post('decrypt')
    async decrypt(
        @Body() body: {
            uri: string;
            metadata?: string;
            dataToEncryptHash?: string;
            accessControlConditions?: any[];
            authSig: any;
        },
        @Res({ passthrough: true }) res: Response,
    ) {
        const { uri, metadata, dataToEncryptHash, accessControlConditions, authSig } = body;

        // Minimum required: uri and authSig
        if (!uri || !authSig) {
            this.logger.warn(`Invalid decryption request: missing uri or authSig`);
            res.status(HttpStatus.BAD_REQUEST).send('Missing required fields: uri and authSig are required.');
            return;
        }

        try {
            this.logger.log(`Received decryption request for URI: ${uri} (provider: ${this.encryptionService.providerName})`);

            // Use metadata directly if provided, otherwise use dataToEncryptHash as metadata
            // For AES provider, dataToEncryptHash contains the AES metadata JSON
            const effectiveMetadata = metadata || dataToEncryptHash || '';

            const decryptedBuffer = await this.encryptionService.decrypt(
                uri,
                effectiveMetadata,
                accessControlConditions || [],
                authSig,
            );

            // Set content type for audio
            res.set({
                'Content-Type': 'audio/mpeg',
                'Content-Length': decryptedBuffer.length,
            });

            return new StreamableFile(decryptedBuffer);
        } catch (error: any) {
            this.logger.error(`Decryption endpoint failed for URI ${uri}: ${error.message}`);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(error.message || 'Decryption failed.');
        }
    }
}
