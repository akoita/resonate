import { Injectable } from '@nestjs/common';
import { StorageProvider, StorageRangeResult, StorageResult } from './storage_provider';
import { openSync, readSync, closeSync, statSync } from 'fs';
import { parseByteRange } from './byte_range';
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

    /**
     * Reads one byte range from disk without loading the whole file (#2661),
     * so the stream route's memory does not grow with file size.
     */
    async downloadRange(uri: string, range: string): Promise<StorageRangeResult | null> {
        const { filename } = resolveLocalStorageUri(uri, { backendOrigin: this.backendOrigin });
        const absolutePath = resolveContainedPath(this.uploadDir, filename);
        if (!absolutePath || !existsSync(absolutePath)) return null;
        const total = statSync(absolutePath).size;
        const parsed = parseByteRange(range, total);
        if (!parsed) return null;
        const length = parsed.end - parsed.start + 1;
        const data = Buffer.alloc(length);
        const fd = openSync(absolutePath, 'r');
        try {
            let read = 0;
            while (read < length) {
                const n = readSync(fd, data, read, length - read, parsed.start + read);
                if (n === 0) break;
                read += n;
            }
            return { data: data.subarray(0, read), start: parsed.start, end: parsed.start + read - 1, total };
        } finally {
            closeSync(fd);
        }
    }
}
