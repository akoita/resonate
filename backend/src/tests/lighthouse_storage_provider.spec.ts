import { ConfigService } from '@nestjs/config';
import { LighthouseStorageProvider } from '../modules/storage/lighthouse_storage_provider';
import { BOUNDED_REMOTE_RESPONSE_CEILING_BYTES } from '../modules/storage/bounded_remote_fetch';
import { StorageUriPolicyError } from '../modules/storage/storage_uri_policy';

describe('LighthouseStorageProvider', () => {
    function makeProvider() {
        return new LighthouseStorageProvider(new ConfigService({}));
    }

    afterEach(() => jest.restoreAllMocks());

    it.each([
        'ipfs://bafybeigdyrmockcid123',
        'https://gateway.lighthouse.storage/ipfs/bafybeigdyrmockcid123',
    ])('downloads canonical IPFS form %s', async (uri) => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
            status: 200,
            ok: true,
            headers: new Headers({ 'content-type': 'audio/mpeg' }),
            body: null,
            arrayBuffer: async () => Buffer.from('audio'),
        } as any);

        await expect(makeProvider().download(uri)).resolves.toEqual(Buffer.from('audio'));
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://gateway.lighthouse.storage/ipfs/bafybeigdyrmockcid123',
            expect.objectContaining({ redirect: 'manual' }),
        );
    });

    it('rejects arbitrary HTTP before fetch', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch');

        await expect(makeProvider().download('http://evil.example/ipfs/bafybeigdyrmockcid123')).rejects.toBeInstanceOf(
            StorageUriPolicyError,
        );
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects a gateway redirect escape before following it', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
            status: 302,
            ok: false,
            headers: new Headers({ location: 'https://evil.example/escape' }),
            body: null,
            arrayBuffer: async () => new ArrayBuffer(0),
        } as any);

        await expect(makeProvider().download('ipfs://bafybeigdyrmockcid123')).rejects.toBeInstanceOf(
            StorageUriPolicyError,
        );
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects a declared oversized response', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
            status: 200,
            ok: true,
            headers: new Headers({
                'content-length': String(BOUNDED_REMOTE_RESPONSE_CEILING_BYTES + 1),
            }),
            body: null,
            arrayBuffer: async () => new ArrayBuffer(0),
        } as any);

        await expect(makeProvider().download('ipfs://bafybeigdyrmockcid123')).rejects.toThrow(
            /ceiling|declares/i,
        );
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('validates delete input before preserving the no-op delete semantics', async () => {
        await expect(makeProvider().delete('https://evil.example/ipfs/bafybeigdyrmockcid123')).rejects.toBeInstanceOf(
            StorageUriPolicyError,
        );
    });
});
