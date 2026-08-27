import { Injectable } from '@nestjs/common';
import { StorageProvider, StorageResult } from './storage_provider';
import { join } from 'path';
import { resolveContainedPath } from './path_containment';
import { writeFileSync, existsSync, mkdirSync, unlinkSync, readFileSync } from 'fs';
import {
    assertSafeLocalFilename,
    resolveLocalStorageUri,
} from './storage_uri_policy';

@Injectable()
export class LocalStorageProvider extends StorageProvider {
    private readonly uploadDir = process.env.LOCAL_STORAGE_PATH || join(process.cwd(), 'uploads', 'stems');
    private readonly backendOrigin = `http://localhost:${process.env.PORT || 3000}`;

    constructor() {
        super();
        this.ensureUploadDir();
    }

    private ensureUploadDir(): void {
        if (!existsSync(this.uploadDir)) {
            mkdirSync(this.uploadDir, { recursive: true });
        }
    }

    async upload(data: Buffer, filename: string, mimeType: string): Promise<StorageResult> {
        const safeFilename = assertSafeLocalFilename(filename);
        this.ensureUploadDir();
        const absolutePath = resolveContainedPath(this.uploadDir, safeFilename);
        if (!absolutePath) {
            throw new Error(`Refusing to write outside the upload directory: ${filename}`);
        }
        writeFileSync(absolutePath, data);

        return {
            uri: `/catalog/stems/${safeFilename}/blob`, // Relative path — consumers prepend their base URL
            provider: 'local',
            metadata: { path: absolutePath }
        };
    }

    async delete(uri: string): Promise<void> {
        const { filename } = resolveLocalStorageUri(uri, { backendOrigin: this.backendOrigin });
        this.ensureUploadDir();
        const absolutePath = resolveContainedPath(this.uploadDir, filename);

        if (absolutePath && existsSync(absolutePath)) {
            unlinkSync(absolutePath);
        }
    }

    async download(uri: string): Promise<Buffer | null> {
        const { filename } = resolveLocalStorageUri(uri, { backendOrigin: this.backendOrigin });
        this.ensureUploadDir();
        const absolutePath = resolveContainedPath(this.uploadDir, filename);

        if (absolutePath && existsSync(absolutePath)) {
            return readFileSync(absolutePath);
        }
        return null;
    }
}
