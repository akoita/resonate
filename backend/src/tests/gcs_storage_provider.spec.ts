import { ConfigService } from '@nestjs/config';
import { GcsStorageProvider } from '../modules/storage/gcs_storage_provider';

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
});
