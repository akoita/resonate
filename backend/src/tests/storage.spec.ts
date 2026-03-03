/**
 * Storage Module Tests — Issue #362
 *
 * Tests the StorageModule factory routing and individual provider behavior.
 * The factory routing bug was the root cause of LocalStorageProvider being used
 * in production when STORAGE_PROVIDER=gcs.
 */
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { StorageProvider, StorageResult } from '../modules/storage/storage_provider';
import { LocalStorageProvider } from '../modules/storage/local_storage_provider';
import { GcsStorageProvider } from '../modules/storage/gcs_storage_provider';
import { LighthouseStorageProvider } from '../modules/storage/lighthouse_storage_provider';
import { StorageModule } from '../modules/storage/storage.module';
import * as fs from 'fs';
import * as path from 'path';

// ============ StorageModule Factory Routing ============

describe('StorageModule factory routing', () => {
  async function createModuleWithProvider(providerValue: string): Promise<TestingModule> {
    return Test.createTestingModule({
      imports: [StorageModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string, defaultVal?: string) => {
          if (key === 'STORAGE_PROVIDER') return providerValue;
          if (key === 'GCS_STEMS_BUCKET') return 'test-bucket';
          if (key === 'LIGHTHOUSE_API_KEY') return 'test-key';
          return defaultVal;
        },
      })
      .compile();
  }

  it('routes "local" to LocalStorageProvider', async () => {
    const module = await createModuleWithProvider('local');
    const provider = module.get<StorageProvider>(StorageProvider);
    expect(provider).toBeInstanceOf(LocalStorageProvider);
  });

  it('routes "gcs" to GcsStorageProvider', async () => {
    const module = await createModuleWithProvider('gcs');
    const provider = module.get<StorageProvider>(StorageProvider);
    expect(provider).toBeInstanceOf(GcsStorageProvider);
  });

  it('routes "ipfs" to LighthouseStorageProvider', async () => {
    const module = await createModuleWithProvider('ipfs');
    const provider = module.get<StorageProvider>(StorageProvider);
    expect(provider).toBeInstanceOf(LighthouseStorageProvider);
  });

  it('routes "filecoin" to LighthouseStorageProvider', async () => {
    const module = await createModuleWithProvider('filecoin');
    const provider = module.get<StorageProvider>(StorageProvider);
    expect(provider).toBeInstanceOf(LighthouseStorageProvider);
  });

  it('defaults to LocalStorageProvider when STORAGE_PROVIDER is unset', async () => {
    const module = await Test.createTestingModule({
      imports: [StorageModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string, defaultVal?: string) => defaultVal,
      })
      .compile();

    const provider = module.get<StorageProvider>(StorageProvider);
    expect(provider).toBeInstanceOf(LocalStorageProvider);
  });
});

// ============ LocalStorageProvider ============

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider;
  const testFilename = `test-${Date.now()}.wav`;
  const testData = Buffer.from('fake audio data');

  beforeAll(() => {
    provider = new LocalStorageProvider();
  });

  afterAll(() => {
    // Clean up test file
    const uploadDir = path.join(process.cwd(), 'uploads', 'stems');
    const filePath = path.join(uploadDir, testFilename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  it('upload returns a relative URI (no localhost)', async () => {
    const result = await provider.upload(testData, testFilename, 'audio/wav');
    expect(result.provider).toBe('local');
    expect(result.uri).toContain(`/catalog/stems/${testFilename}/blob`);
    // Critical: URI must NOT contain localhost — the production bug
    expect(result.uri).not.toContain('localhost');
    expect(result.uri).not.toContain('http://');
    expect(result.uri).not.toContain('https://');
  });

  it('upload writes file to disk', async () => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'stems');
    const filePath = path.join(uploadDir, testFilename);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('download retrieves uploaded file', async () => {
    const uri = `/catalog/stems/${testFilename}/blob`;
    const downloaded = await provider.download(uri);
    expect(downloaded).not.toBeNull();
    expect(downloaded!.equals(testData)).toBe(true);
  });

  it('download returns null for non-existent file', async () => {
    const result = await provider.download('/catalog/stems/nonexistent-file.wav/blob');
    expect(result).toBeNull();
  });

  it('delete removes file from disk', async () => {
    const uri = `/catalog/stems/${testFilename}/blob`;
    await provider.delete(uri);
    const uploadDir = path.join(process.cwd(), 'uploads', 'stems');
    const filePath = path.join(uploadDir, testFilename);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});

// ============ GcsStorageProvider ============

describe('GcsStorageProvider', () => {
  let provider: GcsStorageProvider;
  const mockConfigService = {
    get: (key: string, defaultVal?: string) => {
      if (key === 'GCS_STEMS_BUCKET') return 'test-resonate-bucket';
      return defaultVal;
    },
  } as unknown as ConfigService;

  beforeAll(() => {
    provider = new GcsStorageProvider(mockConfigService);
  });

  it('upload constructs correct GCS URI', async () => {
    // Mock fetch for GCS upload
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{}',
    }) as any;

    // Mock the auth — getAccessToken is private, so we mock via prototype
    jest.spyOn(provider as any, 'getAccessToken').mockResolvedValue('mock-token');

    const result = await provider.upload(
      Buffer.from('test data'),
      'track-123.wav',
      'audio/wav',
    );

    expect(result.provider).toBe('gcs');
    expect(result.uri).toBe(
      'https://storage.googleapis.com/test-resonate-bucket/originals/track-123.wav',
    );
    expect(result.uri).not.toContain('localhost');
    expect(result.metadata?.bucket).toBe('test-resonate-bucket');

    // Verify fetch was called with correct upload URL
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('storage.googleapis.com/upload/storage/v1/b/test-resonate-bucket'),
      expect.objectContaining({ method: 'POST' }),
    );

    global.fetch = originalFetch;
  });

  it('upload throws on GCS failure', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    }) as any;

    jest.spyOn(provider as any, 'getAccessToken').mockResolvedValue('mock-token');

    await expect(
      provider.upload(Buffer.from('data'), 'file.wav', 'audio/wav'),
    ).rejects.toThrow('GCS upload failed (403)');

    global.fetch = originalFetch;
  });

  it('download returns buffer on success', async () => {
    const originalFetch = global.fetch;
    const testData = Buffer.from('downloaded audio');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => testData.buffer.slice(testData.byteOffset, testData.byteOffset + testData.byteLength),
    }) as any;

    jest.spyOn(provider as any, 'getAccessToken').mockResolvedValue('mock-token');

    const result = await provider.download('https://storage.googleapis.com/test-bucket/originals/file.wav');
    expect(result).not.toBeNull();

    global.fetch = originalFetch;
  });

  it('download returns null on HTTP error', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as any;

    jest.spyOn(provider as any, 'getAccessToken').mockResolvedValue('mock-token');

    const result = await provider.download('https://storage.googleapis.com/test-bucket/originals/missing.wav');
    expect(result).toBeNull();

    global.fetch = originalFetch;
  });

  it('delete calls correct GCS API endpoint', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
    jest.spyOn(provider as any, 'getAccessToken').mockResolvedValue('mock-token');

    await provider.delete('https://storage.googleapis.com/test-resonate-bucket/originals/file.wav');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('storage.googleapis.com/storage/v1/b/test-resonate-bucket/o/'),
      expect.objectContaining({ method: 'DELETE' }),
    );

    global.fetch = originalFetch;
  });
});

// ============ LighthouseStorageProvider ============

describe('LighthouseStorageProvider', () => {
  it('upload returns mock CID when API key is missing', async () => {
    const mockConfig = {
      get: (key: string) => {
        if (key === 'LIGHTHOUSE_API_KEY') return '';
        return undefined;
      },
    } as unknown as ConfigService;

    const provider = new LighthouseStorageProvider(mockConfig);
    const result = await provider.upload(Buffer.from('data'), 'file.wav', 'audio/wav');

    expect(result.provider).toBe('ipfs');
    expect(result.uri).toContain('ipfs://mock-cid-');
    expect(result.cid).toContain('mock-cid-');
  });

  it('download converts ipfs:// URI to gateway URL', async () => {
    const mockConfig = {
      get: () => 'test-api-key',
    } as unknown as ConfigService;
    const provider = new LighthouseStorageProvider(mockConfig);

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    }) as any;

    await provider.download('ipfs://QmTestCid123');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://gateway.lighthouse.storage/ipfs/QmTestCid123',
      expect.any(Object),
    );

    global.fetch = originalFetch;
  });

  it('download returns null on fetch failure', async () => {
    const mockConfig = {
      get: () => 'test-api-key',
    } as unknown as ConfigService;
    const provider = new LighthouseStorageProvider(mockConfig);

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as any;

    const result = await provider.download('https://gateway.lighthouse.storage/ipfs/QmTest');
    expect(result).toBeNull();

    global.fetch = originalFetch;
  });
});
