import { Injectable } from '@nestjs/common';

export interface StorageResult {
    uri: string;
    provider: 'local' | 'ipfs' | 'filecoin';
    cid?: string;
    metadata?: any;
}

export abstract class StorageProvider {
    abstract upload(data: Buffer, filename: string, mimeType: string): Promise<StorageResult>;
    abstract delete(uri: string): Promise<void>;
}
