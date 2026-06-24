/**
 * StemAudioMixer (#1182 slice 4, #1214) — integration (Testcontainers).
 *
 * Covers the mixer's stem-loading + decrypt-for-render boundary that is shared
 * between stem_mix render (#1189), audio-conditioned generation (#1182), and
 * layered rendering (#1209):
 *   - missing-stem / all-muted rejections (fail fast before any ffmpeg work);
 *   - the #1214 decrypt boundary: only authorized encrypted stems are
 *     decrypted, decrypt failures map to safe errors, muted encrypted stems are
 *     never decrypted, and ciphertext never reaches ffmpeg;
 *   - temp-dir cleanup on terminal failure paths.
 *
 * The successful mix path needs ffmpeg; the decrypt+mix end-to-end test is
 * gated on ffmpeg being present (verified on deploy, skipped in CI when absent).
 * The strict no-cache decryption guarantee is unit-tested separately in
 * encryption-render-decrypt.spec.ts.
 */

import { execFileSync } from "child_process";
import { readdirSync } from "fs";
import { tmpdir } from "os";
import { ConfigService } from "@nestjs/config";
import { prisma } from "../db/prisma";
import {
  EncryptionService,
  RenderDecryptionError,
} from "../modules/encryption/encryption.service";
import { AesEncryptionProvider } from "../modules/encryption/providers/aes_encryption_provider";
import { FfmpegStemAudioMixer } from "../modules/remix/stem-audio-mixer";
import type { StemRenderAuthorization } from "../modules/remix/remix-generation.provider";
import type { StorageProvider } from "../modules/storage/storage_provider";

const TEST_PREFIX = `mixer_${Date.now()}_`;
const TRACK_ID = `${TEST_PREFIX}track`;
const STEM_PLAIN = `${TEST_PREFIX}stem_plain`;
const STEM_ENCRYPTED = `${TEST_PREFIX}stem_encrypted`;
const STEM_ENC_NO_BYTES = `${TEST_PREFIX}stem_enc_empty`;
const STEM_STORED = `${TEST_PREFIX}stem_stored`;

const authFor = (ids: string[]): StemRenderAuthorization => ({
  userId: `${TEST_PREFIX}user`,
  remixProjectId: `${TEST_PREFIX}project`,
  authorizedStemIds: new Set(ids),
});

function remixMixTempDirs(): Set<string> {
  return new Set(
    readdirSync(tmpdir()).filter((entry) => entry.startsWith("remix-mix-")),
  );
}

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("FfmpegStemAudioMixer decrypt-for-render boundary (integration)", () => {
  const storageProvider = {
    upload: jest.fn(),
    download: jest.fn(),
    downloadRange: jest.fn(),
    delete: jest.fn(),
  };
  const encryptionService = {
    decryptForRender: jest.fn(),
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
          encryptionMetadata: JSON.stringify({
            iv: "00",
            authTag: "11",
            keyId: STEM_ENCRYPTED,
          }),
        },
        {
          id: STEM_ENC_NO_BYTES,
          trackId: TRACK_ID,
          type: "vocals",
          uri: "/catalog/stems/missing.enc/blob",
          storageProvider: "local",
          isEncrypted: true,
          encryptionMetadata: JSON.stringify({
            iv: "00",
            authTag: "11",
            keyId: STEM_ENC_NO_BYTES,
          }),
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
    encryptionService.decryptForRender.mockReset();
    mixer = new FfmpegStemAudioMixer(
      storageProvider as unknown as StorageProvider,
      encryptionService as unknown as EncryptionService,
    );
  });

  it("rejects when a requested stem does not exist", async () => {
    await expect(
      mixer.mixUnmutedStems(
        [{ stemId: `${TEST_PREFIX}ghost`, gainDb: 0, muted: false }],
        authFor([`${TEST_PREFIX}ghost`]),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(encryptionService.decryptForRender).not.toHaveBeenCalled();
  });

  it("rejects when every stem is muted (nothing to mix)", async () => {
    await expect(
      mixer.mixUnmutedStems(
        [{ stemId: STEM_PLAIN, gainDb: 0, muted: true }],
        authFor([STEM_PLAIN]),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("refuses to decrypt an encrypted stem outside the authorized set", async () => {
    await expect(
      mixer.mixUnmutedStems(
        [{ stemId: STEM_ENCRYPTED, gainDb: 0, muted: false }],
        // Authorized set deliberately omits the encrypted stem.
        authFor([STEM_PLAIN]),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      retryable: false,
      message: expect.stringContaining("no longer authorized"),
    });
    expect(encryptionService.decryptForRender).not.toHaveBeenCalled();
  });

  it("never decrypts a muted encrypted stem", async () => {
    // The encrypted stem is muted (excluded); only the plain stem is active.
    // decryptForRender must not be invoked for the muted ciphertext.
    await mixer
      .mixUnmutedStems(
        [
          { stemId: STEM_ENCRYPTED, gainDb: 0, muted: true },
          { stemId: STEM_PLAIN, gainDb: 0, muted: false },
        ],
        authFor([STEM_PLAIN, STEM_ENCRYPTED]),
      )
      .catch(() => undefined); // ffmpeg may be absent; we only assert the spy.
    expect(encryptionService.decryptForRender).not.toHaveBeenCalled();
  });

  it("maps an authorization failure at decrypt time to non-retryable invalid_input", async () => {
    encryptionService.decryptForRender.mockRejectedValueOnce(
      new RenderDecryptionError("unauthorized"),
    );
    await expect(
      mixer.mixUnmutedStems(
        [{ stemId: STEM_ENCRYPTED, gainDb: 0, muted: false }],
        authFor([STEM_ENCRYPTED]),
      ),
    ).rejects.toMatchObject({ code: "invalid_input", retryable: false });
  });

  it("maps invalid encryption metadata to non-retryable invalid_input", async () => {
    encryptionService.decryptForRender.mockRejectedValueOnce(
      new RenderDecryptionError("invalid_metadata"),
    );
    await expect(
      mixer.mixUnmutedStems(
        [{ stemId: STEM_ENCRYPTED, gainDb: 0, muted: false }],
        authFor([STEM_ENCRYPTED]),
      ),
    ).rejects.toMatchObject({ code: "invalid_input", retryable: false });
  });

  it("maps a decryption infrastructure failure to retryable provider_unavailable without leaking", async () => {
    const warn = jest
      .spyOn((mixer as any).logger, "warn")
      .mockImplementation(() => undefined);
    encryptionService.decryptForRender.mockRejectedValueOnce(
      new RenderDecryptionError("decryption_failed"),
    );
    await expect(
      mixer.mixUnmutedStems(
        [{ stemId: STEM_ENCRYPTED, gainDb: 0, muted: false }],
        authFor([STEM_ENCRYPTED]),
      ),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
      message: expect.stringContaining(STEM_ENCRYPTED),
    });
    // The opaque reason is logged; no ciphertext/metadata/key leaks.
    expect(JSON.stringify(warn.mock.calls)).not.toContain("ciphertext");
    warn.mockRestore();
  });

  it("treats an authorized encrypted stem with no stored bytes as unavailable, without decrypting", async () => {
    storageProvider.download.mockResolvedValueOnce(null);
    await expect(
      mixer.mixUnmutedStems(
        [{ stemId: STEM_ENC_NO_BYTES, gainDb: 0, muted: false }],
        authFor([STEM_ENC_NO_BYTES]),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: expect.stringContaining(`Audio for stem ${STEM_ENC_NO_BYTES} is unavailable`),
    });
    expect(encryptionService.decryptForRender).not.toHaveBeenCalled();
  });

  it("maps a storage outage to retryable provider_unavailable without leaking details", async () => {
    const warn = jest
      .spyOn((mixer as any).logger, "warn")
      .mockImplementation(() => undefined);
    storageProvider.download.mockRejectedValueOnce(
      new Error("gs://private-bucket/internal-object.wav permission denied"),
    );

    await expect(
      mixer.mixUnmutedStems(
        [{ stemId: STEM_STORED, gainDb: 0, muted: false }],
        authFor([STEM_STORED]),
      ),
    ).rejects.toMatchObject({
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
        authFor([STEM_STORED]),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      retryable: false,
      message: expect.stringContaining(`Audio for stem ${STEM_STORED} is unavailable`),
    });
  });

  it("removes the temp work dir on a terminal decrypt failure", async () => {
    encryptionService.decryptForRender.mockRejectedValueOnce(
      new RenderDecryptionError("decryption_failed"),
    );
    const before = remixMixTempDirs();
    await mixer
      .mixUnmutedStems(
        [{ stemId: STEM_ENCRYPTED, gainDb: 0, muted: false }],
        authFor([STEM_ENCRYPTED]),
      )
      .catch(() => undefined);
    const after = remixMixTempDirs();
    const leaked = [...after].filter((dir) => !before.has(dir));
    expect(leaked).toEqual([]);
  });
});

(ffmpegAvailable ? describe : describe.skip)(
  "FfmpegStemAudioMixer encrypted decrypt+mix end-to-end (#1214)",
  () => {
    const E2E_PREFIX = `mixer_e2e_${Date.now()}_`;
    const E2E_TRACK = `${E2E_PREFIX}track`;
    const E2E_STEM = `${E2E_PREFIX}stem`;
    const originalInternalKey = process.env.INTERNAL_SERVICE_KEY;

    const storageProvider = {
      upload: jest.fn(),
      download: jest.fn().mockResolvedValue(null),
      downloadRange: jest.fn(),
      delete: jest.fn(),
    };

    // Real AES encryption service so we decrypt genuine ciphertext, proving the
    // mixer never feeds ciphertext to ffmpeg.
    const configService = {
      get: (key: string) => process.env[key],
    } as unknown as ConfigService;
    let encryptionService: EncryptionService;
    let ciphertext: Buffer;
    let encryptionMetadata: string;

    beforeAll(async () => {
      process.env.INTERNAL_SERVICE_KEY = "test-internal-key-1214";
      process.env.ENCRYPTION_SECRET =
        process.env.ENCRYPTION_SECRET ?? "test-encryption-secret-1214";
      const provider = new AesEncryptionProvider(configService);
      encryptionService = new EncryptionService(provider, configService);

      const payload = sineWav(440, 1);
      const encrypted = await provider.encrypt(payload, {
        contentId: E2E_STEM,
        ownerAddress: "0x000000000000000000000000000000000000dEaD",
        allowedAddresses: [],
      });
      ciphertext = encrypted!.encryptedData;
      encryptionMetadata = encrypted!.metadata;

      await prisma.user.create({
        data: { id: `${E2E_PREFIX}user`, email: `${E2E_PREFIX}@test.resonate` },
      });
      await prisma.artist.create({
        data: { id: `${E2E_PREFIX}artist`, displayName: "E2E Artist" },
      });
      await prisma.release.create({
        data: {
          id: `${E2E_PREFIX}release`,
          artistId: `${E2E_PREFIX}artist`,
          title: "E2E Release",
          status: "ready",
        },
      });
      await prisma.track.create({
        data: { id: E2E_TRACK, releaseId: `${E2E_PREFIX}release`, title: "T", position: 1 },
      });
      await prisma.stem.create({
        data: {
          id: E2E_STEM,
          trackId: E2E_TRACK,
          type: "vocals",
          uri: "db://bytes",
          data: ciphertext,
          isEncrypted: true,
          encryptionMetadata,
        },
      });
    });

    afterAll(async () => {
      await prisma.stem.deleteMany({ where: { trackId: E2E_TRACK } });
      await prisma.track.deleteMany({ where: { id: E2E_TRACK } });
      await prisma.release.deleteMany({ where: { id: `${E2E_PREFIX}release` } });
      await prisma.artist.deleteMany({ where: { id: `${E2E_PREFIX}artist` } });
      await prisma.user.deleteMany({ where: { id: `${E2E_PREFIX}user` } });
      if (originalInternalKey === undefined) delete process.env.INTERNAL_SERVICE_KEY;
      else process.env.INTERNAL_SERVICE_KEY = originalInternalKey;
    });

    it("decrypts an authorized encrypted stem and mixes plaintext (never ciphertext)", async () => {
      const mixer = new FfmpegStemAudioMixer(
        storageProvider as unknown as StorageProvider,
        encryptionService,
      );
      const before = remixMixTempDirs();
      const mixed = await mixer.mixUnmutedStems(
        [{ stemId: E2E_STEM, gainDb: 0, muted: false }],
        {
          userId: `${E2E_PREFIX}user`,
          remixProjectId: `${E2E_PREFIX}project`,
          authorizedStemIds: new Set([E2E_STEM]),
        },
      );

      expect(mixed.buffer.length).toBeGreaterThan(0);
      // The rendered mp3 must not be the raw ciphertext we stored.
      expect(mixed.buffer.equals(ciphertext)).toBe(false);
      expect(mixed.mimeType).toBe("audio/mpeg");

      // Temp work dir cleaned up after a successful render.
      const after = remixMixTempDirs();
      expect([...after].filter((dir) => !before.has(dir))).toEqual([]);
    });
  },
);

/** Minimal 16-bit mono PCM WAV so the smoke test needs no audio deps. */
function sineWav(
  frequency: number,
  seconds: number,
  sampleRate = 8000,
  amplitude = 12000,
): Buffer {
  const samples = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = Math.round(
      Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude,
    );
    data.writeInt16LE(value, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
