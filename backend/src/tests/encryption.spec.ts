/**
 * Encryption Service unit tests — Issue #362
 *
 * Tests the EncryptionService wrapper: URI resolution, provider delegation,
 * ready state, and provider name.
 */

import { createHash } from 'crypto';
import { rmSync } from 'fs';
import { join } from 'path';
import { EncryptionService } from '../modules/encryption/encryption.service';
import { StorageUriPolicyError } from '../modules/storage/storage_uri_policy';

const TEST_STEM_URI = 'https://storage.googleapis.com/resonate-stems-dev/private/stem.mp3';
const TEST_STEM_CACHE_PATH = join(
  process.cwd(),
  'uploads',
  'decrypted_cache',
  `${createHash('sha256').update(TEST_STEM_URI).digest('hex')}.mp3`,
);
const TEST_BUFFER_CACHE_PATH = join(
  process.cwd(),
  'uploads',
  'decrypted_cache',
  `${createHash('sha256').update('stem-1').digest('hex')}.mp3`,
);

const clearTestStemCache = () => {
  rmSync(TEST_STEM_CACHE_PATH, { force: true });
  rmSync(TEST_BUFFER_CACHE_PATH, { force: true });
};

const mockProvider = {
  providerName: 'noop',
  encrypt: jest.fn().mockResolvedValue(null),
  decrypt: jest.fn().mockResolvedValue(Buffer.from('decrypted')),
  verifyAccess: jest.fn().mockResolvedValue(true),
  isReady: jest.fn().mockReturnValue(true),
};

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, defaultVal?: any) => {
    if (key === 'PORT') return '3000';
    if (key === 'AES_ENCRYPTION_KEY') return 'test-key-32-bytes-0000000000000';
    return defaultVal;
  }),
};

const mockStorageProvider = {
  download: jest.fn(),
};

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(() => {
    jest.clearAllMocks();
    clearTestStemCache();
    mockStorageProvider.download.mockReset();
    service = new EncryptionService(
      mockProvider as any,
      mockConfigService as any,
      mockStorageProvider as any,
    );
  });

  afterEach(() => {
    clearTestStemCache();
    jest.restoreAllMocks();
  });

  describe('isReady', () => {
    it('delegates to provider', () => {
      expect(service.isReady).toBe(true);
    });

    it('returns false when provider is not ready', () => {
      mockProvider.isReady.mockReturnValueOnce(false);
      expect(service.isReady).toBe(false);
    });
  });

  describe('providerName', () => {
    it('returns provider name', () => {
      expect(service.providerName).toBe('noop');
    });
  });

  describe('encrypt', () => {
    it('delegates to provider', async () => {
      const data = Buffer.from('test-audio-data');
      const context = { contentId: 'stem-1', ownerAddress: '0xABC' };

      await service.encrypt(data, context);

      expect(mockProvider.encrypt).toHaveBeenCalledWith(data, context);
    });

    it('returns null when provider returns null (noop)', async () => {
      const result = await service.encrypt(
        Buffer.from('test'),
        { contentId: 'stem-1', ownerAddress: '0xABC' },
      );
      expect(result).toBeNull();
    });
  });

  describe('verifyAccess', () => {
    it('delegates to provider with correct context', async () => {
      const result = await service.verifyAccess(
        '{"provider":"aes"}',
        '0xABC',
        { address: '0xABC', sig: '0x...', signedMessage: 'test' },
      );

      expect(result).toBe(true);
      expect(mockProvider.verifyAccess).toHaveBeenCalledWith({
        metadata: '{"provider":"aes"}',
        authSig: { address: '0xABC', sig: '0x...', signedMessage: 'test' },
        requesterAddress: '0xABC',
      });
    });
  });

  describe('decrypt source loading', () => {
    it('prefers storage provider download for encrypted content before raw fetch', async () => {
      const encryptedData = Buffer.from('ciphertext');
      mockStorageProvider.download.mockResolvedValue(encryptedData);
      const fetchSpy = jest.spyOn(global, 'fetch');

      await service.decrypt(
        TEST_STEM_URI,
        JSON.stringify({ iv: 'aa', authTag: 'bb', keyId: 'stem-1' }),
        [],
        { address: '0xABC', sig: '0x1234', signedMessage: 'test' },
      );

      expect(mockStorageProvider.download).toHaveBeenCalledWith(
        TEST_STEM_URI,
      );
      expect(mockProvider.decrypt).toHaveBeenCalledWith(
        encryptedData,
        expect.objectContaining({
          requesterAddress: '0xABC',
        }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('uses storage provider download for raw content fallback too', async () => {
      const rawData = Buffer.from('raw-audio');
      mockStorageProvider.download.mockResolvedValue(rawData);
      const fetchSpy = jest.spyOn(global, 'fetch');

      const result = await service.decrypt(
        TEST_STEM_URI,
        '',
        [],
        { address: '0xABC', sig: '0x1234', signedMessage: 'test' },
      );

      expect(result).toEqual(rawData);
      expect(mockStorageProvider.download).toHaveBeenCalledWith(
        TEST_STEM_URI,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('decrypts an already-loaded encrypted buffer without fetching', async () => {
      const encryptedData = Buffer.from('ciphertext');
      const fetchSpy = jest.spyOn(global, 'fetch');

      const result = await service.decryptBuffer(
        encryptedData,
        JSON.stringify({ iv: 'aa', authTag: 'bb', keyId: 'stem-1' }),
        { address: '0xABC', sig: '0x1234', signedMessage: 'test' },
        'stem-1',
      );

      expect(result).toEqual(Buffer.from('decrypted'));
      expect(mockProvider.decrypt).toHaveBeenCalledWith(
        encryptedData,
        expect.objectContaining({
          requesterAddress: '0xABC',
        }),
      );
      expect(mockStorageProvider.download).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('does not fall through to raw fetch after a storage policy rejection', async () => {
      mockStorageProvider.download.mockRejectedValueOnce(new StorageUriPolicyError('gcs', 'rejected'));
      const fetchSpy = jest.spyOn(global, 'fetch');

      await expect(
        service.decrypt(
          TEST_STEM_URI,
          '',
          [],
          { address: '0xABC', sig: '0x1234', signedMessage: 'test' },
        ),
      ).rejects.toBeInstanceOf(StorageUriPolicyError);

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('falls back through the bounded local catalog path only after provider failure', async () => {
      mockStorageProvider.download.mockRejectedValueOnce(new Error('provider unavailable'));
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: null,
        arrayBuffer: async () => Buffer.from('local-audio').buffer,
      } as any);

      const result = await service.decrypt(
        '/catalog/stems/local.mp3/blob',
        '',
        [],
        { address: '0xABC', sig: '0x1234', signedMessage: 'test' },
      );

      expect(result.toString()).toContain('local-audio');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3000/catalog/stems/local.mp3/blob',
        expect.objectContaining({ redirect: 'manual' }),
      );
      fetchSpy.mockRestore();
    });

    it('allows a provider policy rejection to fall back only for canonical local sources', async () => {
      mockStorageProvider.download.mockRejectedValueOnce(
        new StorageUriPolicyError('gcs', 'provider does not handle local URIs'),
      );
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: null,
        arrayBuffer: async () => Buffer.from('local-audio').buffer,
      } as any);

      const result = await service.decrypt(
        '/catalog/stems/local.mp3/blob',
        '',
        [],
        { address: '0xABC', sig: '0x1234', signedMessage: 'test' },
      );

      expect(result.toString()).toContain('local-audio');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3000/catalog/stems/local.mp3/blob',
        expect.objectContaining({ redirect: 'manual' }),
      );
      fetchSpy.mockRestore();
    });

    it('does not raw-fetch an arbitrary remote source after provider null', async () => {
      mockStorageProvider.download.mockResolvedValueOnce(null);
      const fetchSpy = jest.spyOn(global, 'fetch');

      await expect(
        service.decrypt(
          TEST_STEM_URI,
          '',
          [],
          { address: '0xABC', sig: '0x1234', signedMessage: 'test' },
        ),
      ).rejects.toThrow('approved remote source');

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('rejects an arbitrary source before calling storage or fetch', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');

      await expect(
        service.decrypt(
          'https://evil.example/source.mp3',
          '',
          [],
          { address: '0xABC', sig: '0x1234', signedMessage: 'test' },
        ),
      ).rejects.toBeInstanceOf(StorageUriPolicyError);

      expect(mockStorageProvider.download).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });
});
