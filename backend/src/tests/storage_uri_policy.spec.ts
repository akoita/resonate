import {
    BoundedRemoteResponseLimitError,
    BoundedRemoteFetchError,
    fetchBoundedRemote,
} from '../modules/storage/bounded_remote_fetch';
import {
    resolveGcsStorageUri,
    resolveLighthouseStorageUri,
    resolveLocalStorageUri,
    StorageUriPolicyError,
} from '../modules/storage/storage_uri_policy';

describe('storage URI policy', () => {
    const bucket = 'resonate-stems-test';
    const objectPath = 'originals/stem.mp3';
    const gcsTarget = `https://storage.googleapis.com/${bucket}/${objectPath}`;

    it('resolves all supported GCS compatibility forms to one HTTPS target', () => {
        for (const uri of [
            `gs://${bucket}/${objectPath}`,
            gcsTarget,
            `/${bucket}/${objectPath}`,
            `${bucket}/${objectPath}`,
        ]) {
            expect(resolveGcsStorageUri(uri, bucket)).toMatchObject({
                bucket,
                objectPath,
                target: gcsTarget,
            });
        }
    });

    it.each([
        `gs://other-bucket/${objectPath}`,
        `http://storage.googleapis.com/${bucket}/${objectPath}`,
        `https://storage.googleapis.com.evil.example/${bucket}/${objectPath}`,
        `https://user:pass@storage.googleapis.com/${bucket}/${objectPath}`,
        `https://storage.googleapis.com:443/${bucket}/${objectPath}`,
        `${gcsTarget}?download=1`,
        `${gcsTarget}#fragment`,
        `gs://${bucket}/../secret.mp3`,
        `gs://${bucket}/originals/%2e%2e/secret.mp3`,
        `gs://${bucket}//originals/stem.mp3`,
        `gs://${bucket}`,
    ])('rejects unsafe GCS URI %s', (uri) => {
        expect(() => resolveGcsStorageUri(uri, bucket)).toThrow(StorageUriPolicyError);
    });

    it('resolves IPFS and exact Lighthouse gateway forms', () => {
        const cid = 'bafybeigdyrmockcid123';
        const target = `https://gateway.lighthouse.storage/ipfs/${cid}`;

        expect(resolveLighthouseStorageUri(`ipfs://${cid}`)).toMatchObject({ cid, target });
        expect(resolveLighthouseStorageUri(target)).toMatchObject({ cid, target });
        expect(resolveLighthouseStorageUri('ipfs://mock-cid-development')).toMatchObject({
            cid: 'mock-cid-development',
            target: 'https://gateway.lighthouse.storage/ipfs/mock-cid-development',
        });
    });

    it.each([
        'http://gateway.lighthouse.storage/ipfs/bafybeigdyrmockcid123',
        'https://evil.example/ipfs/bafybeigdyrmockcid123',
        'https://user:pass@gateway.lighthouse.storage/ipfs/bafybeigdyrmockcid123',
        'https://gateway.lighthouse.storage:443/ipfs/bafybeigdyrmockcid123',
        'ipfs://',
        'ipfs://bafybeigdyrmockcid123/extra',
        'ipfs://bafybeigdyr%2Fmockcid',
        'https://gateway.lighthouse.storage/ipfs/../secret',
        'https://gateway.lighthouse.storage/ipfs/bafybeigdyrmockcid123?x=1',
    ])('rejects unsafe IPFS URI %s', (uri) => {
        expect(() => resolveLighthouseStorageUri(uri)).toThrow(StorageUriPolicyError);
    });

    it('accepts only the canonical local catalog form and exact loopback origin', () => {
        expect(resolveLocalStorageUri('/catalog/stems/stem.mp3/blob')).toMatchObject({
            filename: 'stem.mp3',
            relativePath: '/catalog/stems/stem.mp3/blob',
        });
        expect(
            resolveLocalStorageUri('http://localhost:3000/catalog/stems/stem.mp3/blob', {
                backendOrigin: 'http://localhost:3000',
            }),
        ).toMatchObject({
            filename: 'stem.mp3',
            target: 'http://localhost:3000/catalog/stems/stem.mp3/blob',
        });
    });

    it.each([
        'http://evil.example/catalog/stems/stem.mp3/blob',
        'http://localhost:3001/catalog/stems/stem.mp3/blob',
        '/catalog/stems/../secret/blob',
        '/catalog/stems/stem%2Emp3/blob',
        '/catalog/stems/a/b/blob',
        '/catalog/stems//blob',
        '/catalog/stems/stem.mp3/blob?x=1',
    ])('rejects malformed local URI %s', (uri) => {
        expect(() =>
            resolveLocalStorageUri(uri, { backendOrigin: 'http://localhost:3000' }),
        ).toThrow(StorageUriPolicyError);
    });
});

describe('bounded remote fetch', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it('rejects a declared response larger than the configured ceiling', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue({
            status: 200,
            ok: true,
            headers: new Headers({ 'content-length': '5' }),
            body: null,
            arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer,
        } as any);

        await expect(
            fetchBoundedRemote('https://example.test/source', {
                timeoutMs: 1_000,
                maxBytes: 4,
            }),
        ).rejects.toBeInstanceOf(BoundedRemoteResponseLimitError);
    });

    it('counts streamed bytes before concatenating them', async () => {
        const reader = {
            read: jest
                .fn()
                .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
                .mockResolvedValueOnce({ done: false, value: new Uint8Array([4, 5]) }),
            cancel: jest.fn().mockResolvedValue(undefined),
            releaseLock: jest.fn(),
        };
        jest.spyOn(global, 'fetch').mockResolvedValue({
            status: 200,
            ok: true,
            headers: new Headers(),
            body: { getReader: () => reader },
        } as any);

        await expect(
            fetchBoundedRemote('https://example.test/source', {
                timeoutMs: 1_000,
                maxBytes: 4,
            }),
        ).rejects.toBeInstanceOf(BoundedRemoteResponseLimitError);
        expect(reader.cancel).toHaveBeenCalled();
    });

    it('validates a redirect before issuing the next request', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
            status: 302,
            ok: false,
            headers: new Headers({ location: 'https://evil.example/escape' }),
            body: null,
            arrayBuffer: async () => new ArrayBuffer(0),
        } as any);

        await expect(
            fetchBoundedRemote('https://example.test/source', {
                timeoutMs: 1_000,
                validateTarget: (target) => {
                    if (target !== 'https://example.test/source') {
                        throw new StorageUriPolicyError('gcs', 'redirect escaped');
                    }
                },
            }),
        ).rejects.toBeInstanceOf(StorageUriPolicyError);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('aborts a never-resolving request at the explicit timeout', async () => {
        jest.useFakeTimers();
        const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
            (_target, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                }),
        );

        const pending = fetchBoundedRemote('https://example.test/never', {
            timeoutMs: 1_000,
        });
        const rejection = expect(pending).rejects.toBeInstanceOf(BoundedRemoteFetchError);
        await jest.advanceTimersByTimeAsync(1_000);

        await rejection;
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});
