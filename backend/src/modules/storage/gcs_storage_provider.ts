import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import { StorageProvider, StorageResult } from './storage_provider';

@Injectable()
export class GcsStorageProvider extends StorageProvider {
    private readonly logger = new Logger(GcsStorageProvider.name);
    private readonly bucket: string;
    private readonly auth: GoogleAuth;

    constructor(private readonly config: ConfigService) {
        super();
        this.bucket = config.get<string>('GCS_STEMS_BUCKET', 'resonate-stems-dev');

        // GoogleAuth uses Application Default Credentials (ADC):
        //   - On Cloud Run/GCE: metadata server (automatic)
        //   - Locally: GOOGLE_APPLICATION_CREDENTIALS env var (service account key file)
        //   - gcloud CLI: `gcloud auth application-default login`
        this.auth = new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
        });
    }

    /**
     * Get an OAuth2 access token via ADC.
     * Works on GCE/Cloud Run (metadata server) and locally (service account key or gcloud CLI).
     */
    private async getAccessToken(): Promise<string | null> {
        try {
            const client = await this.auth.getClient();
            const token = await client.getAccessToken();
            return token?.token ?? null;
        } catch (err) {
            this.logger.warn(`Could not obtain GCS access token: ${err instanceof Error ? err.message : err}`);
            return null;
        }
    }

    private authHeaders(token: string | null, contentType?: string): Record<string, string> {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (contentType) headers['Content-Type'] = contentType;
        return headers;
    }

    async upload(data: Buffer, filename: string, _mimeType: string): Promise<StorageResult> {
        const gcsPath = `originals/${filename}`;
        const uri = `https://storage.googleapis.com/${this.bucket}/${gcsPath}`;

        const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(gcsPath)}`;

        const token = await this.getAccessToken();
        const headers = this.authHeaders(token, _mimeType || 'application/octet-stream');

        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers,
            body: new Uint8Array(data),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`GCS upload failed (${response.status}): ${text}`);
        }

        this.logger.log(`Uploaded ${filename} to gs://${this.bucket}/${gcsPath}`);
        return { uri, provider: 'gcs' as const, metadata: { bucket: this.bucket, path: gcsPath } };
    }

    async download(uri: string): Promise<Buffer | null> {
        try {
            const token = await this.getAccessToken();
            const headers = this.authHeaders(token);

            const response = await fetch(uri, { headers, signal: AbortSignal.timeout(30000) });
            if (!response.ok) return null;
            return Buffer.from(await response.arrayBuffer());
        } catch (err) {
            this.logger.error(`Download failed for ${uri}: ${err}`);
            return null;
        }
    }

    async delete(uri: string): Promise<void> {
        const match = uri.match(/storage\.googleapis\.com\/[^/]+\/(.+)/);
        if (!match) return;
        const objectPath = match[1];

        try {
            const token = await this.getAccessToken();
            const headers = this.authHeaders(token);

            await fetch(
                `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(objectPath)}`,
                { method: 'DELETE', headers }
            );
        } catch (err) {
            this.logger.error(`Delete failed for ${uri}: ${err}`);
        }
    }
}
