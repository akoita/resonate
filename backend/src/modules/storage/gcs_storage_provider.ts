import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageProvider, StorageResult } from './storage_provider';

@Injectable()
export class GcsStorageProvider extends StorageProvider {
    private readonly bucket: string;

    constructor(private readonly config: ConfigService) {
        super();
        this.bucket = config.get<string>('GCS_STEMS_BUCKET', 'resonate-stems-dev');
    }

    async upload(data: Buffer, filename: string, _mimeType: string): Promise<StorageResult> {
        const gcsPath = `originals/${filename}`;
        const uri = `https://storage.googleapis.com/${this.bucket}/${gcsPath}`;

        // Upload to GCS using the JSON API (no SDK required, uses ADC from Cloud Run)
        const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(gcsPath)}`;

        // Get access token from metadata server (automatic on Cloud Run)
        let headers: Record<string, string> = { 'Content-Type': _mimeType || 'application/octet-stream' };
        try {
            const tokenRes = await fetch(
                'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
                { headers: { 'Metadata-Flavor': 'Google' } }
            );
            if (tokenRes.ok) {
                const { access_token } = await tokenRes.json() as { access_token: string };
                headers['Authorization'] = `Bearer ${access_token}`;
            }
        } catch {
            console.warn('[GCS] Could not get metadata token, trying without auth (public bucket or local)');
        }

        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers,
            body: new Uint8Array(data),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`GCS upload failed (${response.status}): ${text}`);
        }

        console.log(`[GCS] Uploaded ${filename} to gs://${this.bucket}/${gcsPath}`);
        return { uri, provider: 'local' as const, metadata: { bucket: this.bucket, path: gcsPath } };
        // Note: provider is 'local' for compatibility with existing code that checks provider type
    }

    async download(uri: string): Promise<Buffer | null> {
        try {
            // Get access token for private bucket reads
            let headers: Record<string, string> = {};
            try {
                const tokenRes = await fetch(
                    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
                    { headers: { 'Metadata-Flavor': 'Google' } }
                );
                if (tokenRes.ok) {
                    const { access_token } = await tokenRes.json() as { access_token: string };
                    headers['Authorization'] = `Bearer ${access_token}`;
                }
            } catch {
                // Might be a public URL, try without auth
            }

            const response = await fetch(uri, { headers, signal: AbortSignal.timeout(30000) });
            if (!response.ok) return null;
            return Buffer.from(await response.arrayBuffer());
        } catch (err) {
            console.error(`[GCS] Download failed for ${uri}:`, err);
            return null;
        }
    }

    async delete(uri: string): Promise<void> {
        // Extract object path from GCS URL
        const match = uri.match(/storage\.googleapis\.com\/[^/]+\/(.+)/);
        if (!match) return;
        const objectPath = match[1];

        try {
            let headers: Record<string, string> = {};
            const tokenRes = await fetch(
                'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
                { headers: { 'Metadata-Flavor': 'Google' } }
            );
            if (tokenRes.ok) {
                const { access_token } = await tokenRes.json() as { access_token: string };
                headers['Authorization'] = `Bearer ${access_token}`;
            }

            await fetch(
                `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(objectPath)}`,
                { method: 'DELETE', headers }
            );
        } catch (err) {
            console.error(`[GCS] Delete failed for ${uri}:`, err);
        }
    }
}
