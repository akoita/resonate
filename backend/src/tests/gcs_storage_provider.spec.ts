import { ConfigService } from '@nestjs/config';
import { GcsStorageProvider } from '../modules/storage/gcs_storage_provider';
import { BOUNDED_REMOTE_RESPONSE_CEILING_BYTES } from '../modules/storage/bounded_remote_fetch';
import { StorageUriPolicyError } from '../modules/storage/storage_uri_policy';

describe('GcsStorageProvider', () => {
  const getClient = jest.fn();
  const getAccessToken = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    getAccessToken.mockResolvedValue({ token: 'test-token' });
    getClient.mockResolvedValue({ getAccessToken });
  });

  function makeProvider(bucket = 'resonate-stems-staging') {
    const config = new ConfigService({
      GCS_STEMS_BUCKET: bucket,
    });

    const provider = new GcsStorageProvider(config);
    (provider as any).auth = { getClient };
    return provider;
  }

  it('downloads full HTTPS storage URLs unchanged', async () => {
    const provider = makeProvider();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from('audio'),
    } as any);

    await provider.download('https://storage.googleapis.com/resonate-stems-staging/originals/stem.mp3');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://storage.googleapis.com/resonate-stems-staging/originals/stem.mp3',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it('normalizes bucket-prefixed relative object paths for download', async () => {
    const provider = makeProvider();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from('audio'),
    } as any);

    await provider.download('/resonate-stems-staging/originals/stem.mp3');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://storage.googleapis.com/resonate-stems-staging/originals/stem.mp3',
      expect.any(Object),
    );

    fetchSpy.mockRestore();
  });

  it('passes byte ranges through to GCS downloads', async () => {
    const provider = makeProvider();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 206,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === 'content-range') return 'bytes 10-29/100';
          if (name.toLowerCase() === 'content-type') return 'audio/mpeg';
          return null;
        },
      },
      arrayBuffer: async () => Buffer.alloc(20),
    } as any);

    const result = await provider.downloadRange(
      'gs://resonate-stems-staging/originals/stem.mp3',
      'bytes=10-29',
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://storage.googleapis.com/resonate-stems-staging/originals/stem.mp3',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          Range: 'bytes=10-29',
        }),
      }),
    );
    expect(result).toEqual({
      data: Buffer.alloc(20),
      start: 10,
      end: 29,
      total: 100,
      mimeType: 'audio/mpeg',
    });

    fetchSpy.mockRestore();
  });

  it('normalizes gs:// URIs for delete', async () => {
    const provider = makeProvider();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as any);

    await provider.delete('gs://resonate-stems-staging/originals/stem.mp3');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://storage.googleapis.com/storage/v1/b/resonate-stems-staging/o/originals%2Fstem.mp3',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it('rejects a hostile authority before token lookup or fetch', async () => {
    const provider = makeProvider();
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(
      provider.download('https://storage.googleapis.com.evil.example/resonate-stems-staging/originals/stem.mp3'),
    ).rejects.toBeInstanceOf(StorageUriPolicyError);

    expect(getClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects a URI for a different GCS bucket before token lookup or fetch', async () => {
    const provider = makeProvider();
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(
      provider.download('gs://another-bucket/originals/stem.mp3'),
    ).rejects.toBeInstanceOf(StorageUriPolicyError);

    expect(getClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects a redirect escape before a credentialed follow-up request', async () => {
    const provider = makeProvider();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 302,
      ok: false,
      headers: new Headers({ location: 'https://evil.example/steal' }),
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as any);

    await expect(
      provider.download('gs://resonate-stems-staging/originals/stem.mp3'),
    ).rejects.toBeInstanceOf(StorageUriPolicyError);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        redirect: 'manual',
      }),
    );
    fetchSpy.mockRestore();
  });

  it('rejects an explicitly ported redirect before URL normalization can widen it', async () => {
    const provider = makeProvider();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 302,
      ok: false,
      headers: new Headers({
        location: 'https://storage.googleapis.com:443/resonate-stems-staging/originals/stem.mp3',
      }),
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as any);

    await expect(
      provider.download('gs://resonate-stems-staging/originals/stem.mp3'),
    ).rejects.toBeInstanceOf(StorageUriPolicyError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('rejects a declared oversized response', async () => {
    const provider = makeProvider();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({
        'content-length': String(BOUNDED_REMOTE_RESPONSE_CEILING_BYTES + 1),
      }),
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as any);

    await expect(
      provider.download('gs://resonate-stems-staging/originals/stem.mp3'),
    ).rejects.toThrow(/ceiling|declares/i);
    fetchSpy.mockRestore();
  });

  it('validates an invalid delete URI before token lookup or fetch', async () => {
    const provider = makeProvider();
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(provider.delete('https://evil.example/other/stem.mp3')).rejects.toBeInstanceOf(
      StorageUriPolicyError,
    );
    expect(getClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
