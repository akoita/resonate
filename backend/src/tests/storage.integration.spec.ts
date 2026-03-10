/**
 * Tier 2 Integration Test — LocalStorageProvider
 *
 * Tests real file I/O operations through the storage provider.
 * Requires: writable filesystem (no external dependencies)
 *
 * Run: npm run test:integration
 */

import { LocalStorageProvider } from '../modules/storage/local_storage_provider';
import * as fs from 'fs';
import * as path from 'path';

describe('LocalStorageProvider Integration', () => {
  let storage: LocalStorageProvider;
  const testDir = path.join(process.cwd(), 'test-storage-integration');

  beforeAll(() => {
    // Ensure clean test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    // Set env to use test directory
    process.env.LOCAL_STORAGE_PATH = testDir;
    storage = new LocalStorageProvider();
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    delete process.env.LOCAL_STORAGE_PATH;
  });

  it('uploads a file and returns a URI', async () => {
    const data = Buffer.from('test audio content for integration test');
    const filename = 'test-audio.wav';

    const result = await storage.upload(data, filename, 'audio/wav');
    expect(result).toBeDefined();
    expect(result.uri).toContain(filename);
    expect(result.provider).toBe('local');
  });

  it('reads back uploaded file with correct content', async () => {
    const originalData = Buffer.from('exact content verification test');
    const filename = 'verify-content.mp3';

    const result = await storage.upload(originalData, filename, 'audio/mpeg');

    const readBack = await storage.download(result.uri);
    expect(readBack).not.toBeNull();
    expect(readBack!).toEqual(originalData);
  });

  it('returns null for non-existent file download', async () => {
    const readBack = await storage.download('/catalog/stems/nonexistent-file.mp3/blob');
    expect(readBack).toBeNull();
  });

  it('overwrites existing files', async () => {
    const filename = 'overwrite-test.wav';
    const data1 = Buffer.from('original content');
    const data2 = Buffer.from('updated content');

    await storage.upload(data1, filename, 'audio/wav');
    const result2 = await storage.upload(data2, filename, 'audio/wav');

    const readBack = await storage.download(result2.uri);
    expect(readBack!).toEqual(data2);
  });

  it('handles binary audio data correctly', async () => {
    // Create realistic binary data (WAV header + random bytes)
    const wavHeader = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x08, 0x00, 0x00, // file size
      0x57, 0x41, 0x56, 0x45, // WAVE
    ]);
    const audioData = Buffer.concat([wavHeader, Buffer.alloc(1024, 0xAB)]);
    const filename = 'binary-test.wav';

    const result = await storage.upload(audioData, filename, 'audio/wav');

    const readBack = await storage.download(result.uri);
    expect(readBack).not.toBeNull();
    expect(readBack!).toEqual(audioData);
    expect(readBack![0]).toBe(0x52); // R
    expect(readBack![4]).toBe(0x24); // file size byte
  });

  it('recreates the storage directory if it is deleted after startup', async () => {
    const filename = 'recreate-dir.mp3';
    const data = Buffer.from('recreate me');

    fs.rmSync(testDir, { recursive: true, force: true });
    expect(fs.existsSync(testDir)).toBe(false);

    const result = await storage.upload(data, filename, 'audio/mpeg');

    expect(fs.existsSync(testDir)).toBe(true);
    const readBack = await storage.download(result.uri);
    expect(readBack).toEqual(data);
  });
});
