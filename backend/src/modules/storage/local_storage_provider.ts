import { Injectable } from '@nestjs/common';
import { StorageProvider, StorageResult } from './storage_provider';
import { join } from 'path';
import { writeFileSync, existsSync, mkdirSync, unlinkSync, readFileSync } from 'fs';

@Injectable()
export class LocalStorageProvider extends StorageProvider {
    private readonly uploadDir = join(process.cwd(), 'uploads', 'stems');

    constructor() {
        super();
        if (!existsSync(this.uploadDir)) {
            mkdirSync(this.uploadDir, { recursive: true });
        }
    }

    async upload(data: Buffer, filename: string, mimeType: string): Promise<StorageResult> {
        const absolutePath = join(this.uploadDir, filename);
        writeFileSync(absolutePath, data);

        return {
            uri: `${process.env.BACKEND_URL || 'http://localhost:3001'}/catalog/stems/${filename}/blob`, // Mock URL
            provider: 'local',
            metadata: { path: absolutePath }
        };
    }

    async delete(uri: string): Promise<void> {
        // Extract filename from URI
        const parts = uri.split('/');
        const filename = parts[parts.length - 2];
        const absolutePath = join(this.uploadDir, filename);

        if (existsSync(absolutePath)) {
            unlinkSync(absolutePath);
        }
    }

    async download(uri: string): Promise<Buffer | null> {
        // Extract filename from URI (format: http://localhost:3000/catalog/stems/{filename}/blob)
        const parts = uri.split('/');
        const filename = parts[parts.length - 2];
        const absolutePath = join(this.uploadDir, filename);

        if (existsSync(absolutePath)) {
            return readFileSync(absolutePath);
        }
        return null;
    }
}
