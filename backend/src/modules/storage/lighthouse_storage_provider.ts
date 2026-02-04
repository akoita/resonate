import { Injectable, Logger } from '@nestjs/common';
import { StorageProvider, StorageResult } from './storage_provider';
import { ConfigService } from '@nestjs/config';
import lighthouse from '@lighthouse-web3/sdk';

@Injectable()
export class LighthouseStorageProvider extends StorageProvider {
    private readonly logger = new Logger(LighthouseStorageProvider.name);
    private readonly apiKey: string;

    constructor(private readonly configService: ConfigService) {
        super();
        this.apiKey = this.configService.get<string>('LIGHTHOUSE_API_KEY') || '';
    }

    async upload(data: Buffer, filename: string, mimeType: string): Promise<StorageResult> {
        if (!this.apiKey) {
            this.logger.warn('LIGHTHOUSE_API_KEY not configured. Falling back to local storage behavior (mock).');
            return {
                uri: `ipfs://mock-cid-${Date.now()}`,
                provider: 'ipfs',
                cid: `mock-cid-${Date.now()}`
            };
        }

        try {
            const response = await lighthouse.uploadBuffer(data, this.apiKey);
            const cid = response.data.Hash;

            return {
                uri: `https://gateway.lighthouse.storage/ipfs/${cid}`,
                provider: 'ipfs',
                cid: cid,
                metadata: response.data
            };
        } catch (error: any) {
            this.logger.error(`Lighthouse upload failed: ${error?.message || error}`);
            throw error;
        }
    }

    async delete(uri: string): Promise<void> {
        // Lighthouse doesn't support easy deletion for public CIDs (immutable), 
        // but you can "unpin" if using their API specifically for pinning.
        this.logger.log(`Unpinning/Deletion requested for ${uri} (Not implemented in mock/basic SDK flow)`);
    }
}
