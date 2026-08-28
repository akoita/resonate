import { ConfigService } from '@nestjs/config';
import { prisma } from '../db/prisma';
import { EncryptionService } from '../modules/encryption/encryption.service';
import { SynthIdService } from '../modules/generation/synthid.service';
import { StorageUriPolicyError } from '../modules/storage/storage_uri_policy';

const TEST_PREFIX = `synthid_${Date.now()}_`;
const userId = `${TEST_PREFIX}user`;
const artistId = `${TEST_PREFIX}artist`;
const releaseId = `${TEST_PREFIX}release`;
const trackId = `${TEST_PREFIX}track`;
const stemId = `${TEST_PREFIX}stem`;
const stemUri = `https://storage.googleapis.com/resonate-stems-dev/${TEST_PREFIX}stem.mp3`;

describe('SynthIdService (integration)', () => {
  let synthIdService: SynthIdService;
  let loadSourceBuffer: jest.Mock;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@test.resonate`,
      },
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId,
        displayName: 'SynthID Integration Artist',
      },
    });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId,
        title: 'SynthID Integration Release',
        status: 'ready',
      },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: 'SynthID Integration Track',
      },
    });
    await prisma.stem.create({
      data: {
        id: stemId,
        trackId,
        type: 'vocals',
        uri: stemUri,
      },
    });

    loadSourceBuffer = jest.fn();
    const encryptionService = { loadSourceBuffer } as unknown as EncryptionService;
    const configService = new ConfigService({
      SYNTHID_PROJECT_ID: '',
      SYNTHID_LOCATION: 'us-central1',
    });
    synthIdService = new SynthIdService(configService, encryptionService);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    loadSourceBuffer.mockReset();
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected direct fetch'));
  });

  it('delegates an existing stem URI to the bounded source loader', async () => {
    const audio = Buffer.from('persisted-stem-audio');
    loadSourceBuffer.mockResolvedValue(audio);

    const result = await synthIdService.verifyStemById(stemId);

    expect(loadSourceBuffer).toHaveBeenCalledTimes(1);
    expect(loadSourceBuffer).toHaveBeenCalledWith(stemUri);
    expect(result).toMatchObject({ isAiGenerated: false, confidence: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails when the persisted stem does not exist', async () => {
    await expect(
      synthIdService.verifyStemById(`${TEST_PREFIX}missing-stem`),
    ).rejects.toThrow(`Stem ${TEST_PREFIX}missing-stem not found or has no URI`);

    expect(loadSourceBuffer).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('propagates source-loader policy rejection without direct fetch', async () => {
    const rejection = new StorageUriPolicyError('source', 'test policy rejection');
    loadSourceBuffer.mockRejectedValue(rejection);

    await expect(synthIdService.verifyStemById(stemId)).rejects.toBe(rejection);

    expect(loadSourceBuffer).toHaveBeenCalledWith(stemUri);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
