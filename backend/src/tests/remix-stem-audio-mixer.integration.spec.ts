/**
 * StemAudioMixer (#1182 slice 4) — integration (Testcontainers).
 *
 * Covers the ffmpeg-INDEPENDENT validation logic the mixer shares between
 * stem_mix render (#1189) and audio-conditioned generation (#1182): the
 * encrypted-stem deferral, missing-stem, and all-muted rejections, all of
 * which fail fast before any ffmpeg invocation. The successful-mix path needs
 * ffmpeg (absent from the test env — the renderer is mocked elsewhere for the
 * same reason) and is verified on deploy, not in CI.
 */

import { prisma } from "../db/prisma";
import { FfmpegStemAudioMixer } from "../modules/remix/stem-audio-mixer";
import type { StorageProvider } from "../modules/storage/storage_provider";

const TEST_PREFIX = `mixer_${Date.now()}_`;
const TRACK_ID = `${TEST_PREFIX}track`;
const STEM_PLAIN = `${TEST_PREFIX}stem_plain`;
const STEM_ENCRYPTED = `${TEST_PREFIX}stem_encrypted`;
const STEM_STORED = `${TEST_PREFIX}stem_stored`;

describe("FfmpegStemAudioMixer validation (integration)", () => {
  const storageProvider = {
    upload: jest.fn(),
    download: jest.fn(),
    downloadRange: jest.fn(),
    delete: jest.fn(),
  };
  let mixer: FfmpegStemAudioMixer;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: { id: `${TEST_PREFIX}artist`, displayName: "Mixer Artist" },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: `${TEST_PREFIX}artist`,
        title: "Mixer Release",
        status: "ready",
      },
    });
    await prisma.track.create({
      data: { id: TRACK_ID, releaseId: `${TEST_PREFIX}release`, title: "T", position: 1 },
    });
    await prisma.stem.createMany({
      data: [
        {
          id: STEM_PLAIN,
          trackId: TRACK_ID,
          type: "drums",
          uri: "db://bytes",
          data: Buffer.from("fake-audio"),
        },
        {
          id: STEM_ENCRYPTED,
          trackId: TRACK_ID,
          type: "vocals",
          uri: "db://bytes",
          data: Buffer.from("ciphertext"),
          isEncrypted: true,
        },
        {
          id: STEM_STORED,
          trackId: TRACK_ID,
          type: "bass",
          uri: "/catalog/stems/stored.wav/blob",
          storageProvider: "local",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({ where: { trackId: TRACK_ID } });
    await prisma.track.deleteMany({ where: { id: TRACK_ID } });
    await prisma.release.deleteMany({ where: { id: `${TEST_PREFIX}release` } });
    await prisma.artist.deleteMany({ where: { id: `${TEST_PREFIX}artist` } });
    await prisma.user.deleteMany({ where: { id: `${TEST_PREFIX}user` } });
  });

  beforeEach(() => {
    storageProvider.download.mockReset().mockResolvedValue(null);
    mixer = new FfmpegStemAudioMixer(storageProvider as unknown as StorageProvider);
  });

  it("rejects an unmuted encrypted stem with a non-retryable invalid_input", async () => {
    await expect(
      mixer.mixUnmutedStems(
        [{ stemId: STEM_ENCRYPTED, gainDb: 0, muted: false }],
        TEST_PREFIX,
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      retryable: false,
      message: expect.stringContaining("Mute them before rendering"),
    });
  });

  it("rejects when a requested stem does not exist", async () => {
    await expect(
      mixer.mixUnmutedStems(
        [{ stemId: `${TEST_PREFIX}ghost`, gainDb: 0, muted: false }],
        TEST_PREFIX,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects when every stem is muted (nothing to mix)", async () => {
    await expect(
      mixer.mixUnmutedStems(
        [{ stemId: STEM_PLAIN, gainDb: 0, muted: true }],
        TEST_PREFIX,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("ignores muted stems and rejects only if an unmuted one is encrypted", async () => {
    // The plain stem is muted (excluded); the encrypted one is unmuted, so the
    // encrypted deferral must still fire rather than being skipped.
    await expect(
      mixer.mixUnmutedStems(
        [
          { stemId: STEM_PLAIN, gainDb: 0, muted: true },
          { stemId: STEM_ENCRYPTED, gainDb: 0, muted: false },
        ],
        TEST_PREFIX,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("maps a storage outage to retryable provider_unavailable without leaking details", async () => {
    const warn = jest
      .spyOn((mixer as any).logger, "warn")
      .mockImplementation(() => undefined);
    storageProvider.download.mockRejectedValueOnce(
      new Error("gs://private-bucket/internal-object.wav permission denied"),
    );

    const render = mixer.mixUnmutedStems(
      [{ stemId: STEM_STORED, gainDb: 0, muted: false }],
      TEST_PREFIX,
    );

    await expect(render).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
      message: expect.not.stringContaining("private-bucket"),
    });
    expect(warn).toHaveBeenCalledWith(
      `Storage download failed for stem ${STEM_STORED}`,
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-bucket");
    warn.mockRestore();
  });

  it("treats a missing stored object as non-retryable invalid_input", async () => {
    storageProvider.download.mockResolvedValueOnce(null);

    await expect(
      mixer.mixUnmutedStems(
        [{ stemId: STEM_STORED, gainDb: 0, muted: false }],
        TEST_PREFIX,
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      retryable: false,
      message: expect.stringContaining(`Audio for stem ${STEM_STORED} is unavailable`),
    });
  });
});
