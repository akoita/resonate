import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import { StorageProvider, StorageRangeResult, StorageResult } from './storage_provider';

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

    private normalizeObjectPath(uri: string): string | null {
        const trimmed = uri.trim();
        if (!trimmed) return null;

        if (trimmed.startsWith(`gs://${this.bucket}/`)) {
            return trimmed.slice(`gs://${this.bucket}/`.length);
        }

        if (trimmed.startsWith('gs://')) {
            const withoutScheme = trimmed.slice('gs://'.length);
            const firstSlash = withoutScheme.indexOf('/');
            return firstSlash >= 0 ? withoutScheme.slice(firstSlash + 1) : null;
        }

        if (trimmed.startsWith(`https://storage.googleapis.com/${this.bucket}/`)) {
            return trimmed.slice(`https://storage.googleapis.com/${this.bucket}/`.length);
        }

        if (trimmed.startsWith(`http://storage.googleapis.com/${this.bucket}/`)) {
            return trimmed.slice(`http://storage.googleapis.com/${this.bucket}/`.length);
        }

        const withoutLeadingSlash = trimmed.replace(/^\/+/, '');
        if (withoutLeadingSlash.startsWith(`${this.bucket}/`)) {
            return withoutLeadingSlash.slice(this.bucket.length + 1);
        }

        if (/^https?:\/\//i.test(trimmed)) {
            try {
                const url = new URL(trimmed);
                const path = url.pathname.replace(/^\/+/, '');
                if (path.startsWith(`${this.bucket}/`)) {
                    return path.slice(this.bucket.length + 1);
                }
            } catch {
                return null;
            }
            return null;
        }

        return withoutLeadingSlash || null;
    }

    private resolveDownloadUrl(uri: string): string | null {
        const trimmed = uri.trim();
        if (!trimmed) return null;

        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }

        const objectPath = this.normalizeObjectPath(trimmed);
        if (!objectPath) {
            return null;
        }

        return `https://storage.googleapis.com/${this.bucket}/${objectPath}`;
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
            const downloadUrl = this.resolveDownloadUrl(uri);
            if (!downloadUrl) {
                this.logger.warn(`Could not resolve GCS download URL for ${uri}`);
                return null;
            }

            const token = await this.getAccessToken();
            const headers = this.authHeaders(token);

            const response = await fetch(downloadUrl, { headers, signal: AbortSignal.timeout(30000) });
            if (!response.ok) return null;
            return Buffer.from(await response.arrayBuffer());
        } catch (err) {
            this.logger.error(`Download failed for ${uri}: ${err}`);
            return null;
        }
    }

    async downloadRange(uri: string, range: string): Promise<StorageRangeResult | null> {
        try {
            const downloadUrl = this.resolveDownloadUrl(uri);
            if (!downloadUrl) {
                this.logger.warn(`Could not resolve GCS download URL for ${uri}`);
                return null;
            }

            const token = await this.getAccessToken();
            const headers = {
                ...this.authHeaders(token),
                Range: range,
            };

            const response = await fetch(downloadUrl, { headers, signal: AbortSignal.timeout(30000) });
            if (!response.ok) return null;

            const data = Buffer.from(await response.arrayBuffer());
            const contentRange = response.headers.get('content-range');
            const contentType = response.headers.get('content-type');

            if (response.status === 206 && contentRange) {
                const match = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
                if (match) {
                    return {
                        data,
                        start: Number(match[1]),
                        end: Number(match[2]),
                        total: Number(match[3]),
                        mimeType: contentType,
                    };
                }
            }

            return {
                data,
                start: 0,
                end: Math.max(data.length - 1, 0),
                total: data.length,
                mimeType: contentType,
            };
        } catch (err) {
            this.logger.error(`Range download failed for ${uri}: ${err}`);
            return null;
        }
    }

    async delete(uri: string): Promise<void> {
        const objectPath = this.normalizeObjectPath(uri);
        if (!objectPath) return;

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
