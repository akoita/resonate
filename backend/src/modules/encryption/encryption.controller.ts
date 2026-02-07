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

    /**
     * Download endpoint with ownership verification
     * 
     * Verifies the caller owns the stem via StemPurchase records,
     * then decrypts and returns the audio file for download.
     * 
     * Required fields:
     * - stemId: The stem ID to download
     * - walletAddress: The wallet address claiming ownership
     */
    @Post('download')
    async download(
        @Body() body: {
            stemId: string;
            walletAddress: string;
        },
        @Res({ passthrough: true }) res: Response,
    ) {
        const { stemId, walletAddress } = body;

        if (!stemId || !walletAddress) {
            this.logger.warn(`Invalid download request: missing stemId or walletAddress`);
            res.status(HttpStatus.BAD_REQUEST).send('Missing required fields: stemId and walletAddress are required.');
            return;
        }

        try {
            this.logger.log(`Download request for stem ${stemId} by ${walletAddress}`);

            // Verify ownership via StemPurchase
            const { prisma } = await import('../../db/prisma');

            const purchase = await prisma.stemPurchase.findFirst({
                where: {
                    buyerAddress: walletAddress.toLowerCase(),
                    listing: {
                        stem: { id: stemId }
                    }
                },
                include: {
                    listing: {
                        include: {
                            stem: true
                        }
                    }
                }
            });

            if (!purchase) {
                this.logger.warn(`Ownership verification failed: ${walletAddress} does not own stem ${stemId}`);
                res.status(HttpStatus.FORBIDDEN).send('You do not own this stem.');
                return;
            }

            const stem = purchase.listing.stem;
            if (!stem || !stem.uri) {
                this.logger.error(`Stem ${stemId} has no URI`);
                res.status(HttpStatus.NOT_FOUND).send('Stem file not found.');
                return;
            }

            // Fetch the stem content (decryption handled by service if needed)
            const stemUri = stem.uri;
            this.logger.log(`Fetching stem content from: ${stemUri}`);

            // For encrypted stems, use decryption; for unencrypted, fetch directly
            let audioBuffer: Buffer;

            if (stem.encryptionMetadata) {
                // Decrypt the content
                const authSig = {
                    address: walletAddress.toLowerCase(),
                    sig: 'ownership-verified',
                    signedMessage: 'Download authorized via ownership verification',
                };
                audioBuffer = await this.encryptionService.decrypt(
                    stemUri,
                    stem.encryptionMetadata,
                    [],
                    authSig,
                );
            } else {
                // No encryption, fetch directly
                const response = await fetch(stemUri);
                if (!response.ok) throw new Error(`Failed to fetch stem: ${response.status}`);
                audioBuffer = Buffer.from(await response.arrayBuffer());
            }

            // Set response headers for download
            const filename = `${stem.title || stem.type || 'stem'}.mp3`;
            res.set({
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBuffer.length,
                'Content-Disposition': `attachment; filename="${filename}"`,
            });

            return new StreamableFile(audioBuffer);
        } catch (error: any) {
            this.logger.error(`Download failed for stem ${stemId}: ${error.message}`);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(error.message || 'Download failed.');
        }
    }
}
