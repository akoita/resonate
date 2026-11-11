import { Injectable, Logger } from '@nestjs/common';
import { StorageProvider, StorageResult } from './storage_provider';
import { ConfigService } from '@nestjs/config';
import lighthouse from '@lighthouse-web3/sdk';
import {
    BOUNDED_REMOTE_RESPONSE_CEILING_BYTES,
    fetchBoundedRemote,
    IPFS_REMOTE_FETCH_TIMEOUT_MS,
    BoundedRemoteResponseLimitError,
} from './bounded_remote_fetch';
import {
    LighthouseStorageUri,
    resolveLighthouseStorageUri,
    StorageUriPolicyError,
} from './storage_uri_policy';

@Injectable()
export class LighthouseStorageProvider extends StorageProvider {
    private readonly logger = new Logger(LighthouseStorageProvider.name);
    private readonly apiKey: string;

    constructor(private readonly configService: ConfigService) {
        super();
        this.apiKey = this.configService.get<string>('LIGHTHOUSE_API_KEY') || '';
        if (!this.apiKey) {
            this.logger.error('LIGHTHOUSE_API_KEY is not configured: uploads through this provider will fail');
        }
    }

    async upload(data: Buffer, filename: string, mimeType: string): Promise<StorageResult> {
        if (!this.apiKey) {
            // No key means nothing can be stored. Failing here keeps a row from
            // pointing at a CID that was never pinned (#380).
            throw new Error('LIGHTHOUSE_API_KEY is not configured; the IPFS storage provider cannot upload');
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
        const resolved = this.resolveStorageUri(uri);
        // By design a no-op: content on public IPFS is addressed by its hash and
        // cannot be recalled once other nodes hold it, so nothing here claims a
        // file was deleted. The uri is still validated.
        this.logger.log(`Delete requested for ${resolved.cid}; public IPFS content is not removed`);
    }

    async download(uri: string): Promise<Buffer | null> {
        const resolved = this.resolveStorageUri(uri);
        try {
            // IPFS gateways can be slow for cold content - use generous timeout
            const response = await fetchBoundedRemote(resolved.target, {
                timeoutMs: IPFS_REMOTE_FETCH_TIMEOUT_MS,
                maxBytes: BOUNDED_REMOTE_RESPONSE_CEILING_BYTES,
                validateTarget: (target) => this.validateRedirectTarget(target),
            });
            if (response.status < 200 || response.status >= 300) {
                this.logger.error(`Failed to download from ${resolved.target}: ${response.status}`);
                return null;
            }
            return response.data;
        } catch (error: any) {
            if (error instanceof StorageUriPolicyError || error instanceof BoundedRemoteResponseLimitError) {
                throw error;
            }
            this.logger.error(`Lighthouse download failed: ${error?.message || error}`);
            return null;
        }
    }

    private resolveStorageUri(uri: string): LighthouseStorageUri {
        return resolveLighthouseStorageUri(uri);
    }

    private validateRedirectTarget(target: string): void {
        const resolved = this.resolveStorageUri(target);
        if (resolved.target !== target) {
            throw new StorageUriPolicyError('lighthouse', 'redirect target is not canonical');
        }
    }
}
