import { Injectable } from '@nestjs/common';

export interface StorageResult {
    uri: string;
    provider: 'local' | 'ipfs' | 'filecoin' | 'gcs';
    cid?: string;
    metadata?: any;
}

export interface StorageRangeResult {
    data: Buffer;
    start: number;
    end: number;
    total: number;
    mimeType?: string | null;
}

export abstract class StorageProvider {
    abstract upload(data: Buffer, filename: string, mimeType: string): Promise<StorageResult>;
    abstract download(uri: string): Promise<Buffer | null>;
    abstract delete(uri: string): Promise<void>;

    async downloadRange(_uri: string, _range: string): Promise<StorageRangeResult | null> {
        return null;
    }

    /**
     * Canonical absolute form of a stored URI that another service (the demucs
     * worker) can fetch on its own. Providers without one omit it and callers
     * keep their own mapping. Throws on a URI the provider rejects. Used by the
     * job-mode audio-feature backfill (#2013).
     */
    resolveFetchUri?(uri: string): string;
}
