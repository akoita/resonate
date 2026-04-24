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

const TEST_STEM_URI = 'https://storage.googleapis.com/private/stem.mp3';
const TEST_STEM_CACHE_PATH = join(
  process.cwd(),
  'uploads',
  'decrypted_cache',
  `${createHash('sha256').update(TEST_STEM_URI).digest('hex')}.mp3`,
);

const clearTestStemCache = () => {
  rmSync(TEST_STEM_CACHE_PATH, { force: true });
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
  });
});
