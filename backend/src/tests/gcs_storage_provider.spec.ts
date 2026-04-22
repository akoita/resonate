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
