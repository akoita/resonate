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
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "../db/prisma";
import {
  EncryptionService,
  RenderDecryptionError,
} from "../modules/encryption/encryption.service";
import { AesEncryptionProvider } from "../modules/encryption/providers/aes_encryption_provider";
import { FfmpegStemAudioMixer } from "../modules/remix/stem-audio-mixer";
import { RemixWatermarkEmbedder } from "../modules/remix/remix-watermark";
import { renderDjExtended } from "../modules/remix/remix-dj-export";
import {
  djExtendedPlan,
  REMIX_CUES_SCHEMA_VERSION,
  REMIX_DRAFT_GRID_SCHEMA_VERSION,
} from "../modules/remix/remix-cues";
import { structureTimeline } from "../modules/remix/remix-structure";
import {
  REMIX_BEAT_SCHEMA_VERSION,
  type RemixBeat,
} from "../modules/remix/remix-beat";
import type { StemRenderAuthorization } from "../modules/remix/remix-generation.provider";
import {
  REMIX_STRETCH_ENGINE,
  REMIX_STRETCH_WASM_SHA256,
} from "../modules/remix/remix-stretch";
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
      // No effects → render metadata carries no fx fields (#1897).
      expect("effects" in mixed.renderMetadata).toBe(false);
      expect("effectsDspVersion" in mixed.renderMetadata).toBe(false);
    });

    it("renders with the effects recipe (reverb IR + AI layer) and records it (#1897)", async () => {
      const mixer = new FfmpegStemAudioMixer(
        storageProvider as unknown as StorageProvider,
        encryptionService,
      );
      const effects = {
        schemaVersion: "remix-fx/v1" as const,
        master: { speed: 0.85, space: 0.4, warmth: 0.3 },
        stems: { [E2E_STEM]: { echo: 0.5, tone: -0.4 } },
      };
      const before = remixMixTempDirs();
      const mixed = await mixer.mixUnmutedStemsWithAudioBuffers(
        [{ stemId: E2E_STEM, gainDb: 0, muted: false }],
        [
          {
            buffer: sineWav(330, 1),
            mimeType: "audio/wav",
            gainDb: 0,
            label: "generated-layer",
          },
        ],
        {
          userId: `${E2E_PREFIX}user`,
          remixProjectId: `${E2E_PREFIX}project`,
          authorizedStemIds: new Set([E2E_STEM]),
        },
        { effects, bpm: 120 },
      );

      expect(mixed.buffer.length).toBeGreaterThan(0);
      expect(mixed.inputCount).toBe(2);
      expect(mixed.renderMetadata).toMatchObject({
        schemaVersion: "remix-render-policy/v1",
        inputCount: 2,
        activeStemCount: 1,
        effects,
        effectsDspVersion: "remix-fx-dsp/v1",
      });
      // The generated IR lives only in the per-render temp dir.
      const after = remixMixTempDirs();
      expect([...after].filter((dir) => !before.has(dir))).toEqual([]);
    });

    it("renders Pro EQ and pan on the (mono) stem and records the Pro mapping (#1903)", async () => {
      const mixer = new FfmpegStemAudioMixer(
        storageProvider as unknown as StorageProvider,
        encryptionService,
      );
      const effects = {
        schemaVersion: "remix-fx/v4" as const,
        stems: { [E2E_STEM]: { eqLow: 3, eqHigh: -2, pan: -0.3 } },
      };
      const before = remixMixTempDirs();
      const mixed = await mixer.mixUnmutedStems(
        [{ stemId: E2E_STEM, gainDb: 0, muted: false }],
        {
          userId: `${E2E_PREFIX}user`,
          remixProjectId: `${E2E_PREFIX}project`,
          authorizedStemIds: new Set([E2E_STEM]),
        },
        { effects, bpm: null },
      );
      expect(mixed.buffer.length).toBeGreaterThan(1000);
      expect(mixed.renderMetadata).toMatchObject({
        effects,
        effectsDspVersion: "remix-fx-dsp/v1",
        effectsProDspVersion: "remix-fx-pro-dsp/v1",
      });
      // Panned left: the mono stem (probed, up-mixed at unity) is louder on
      // the left than on the right (L = 1 + gL ≈ 1.45, R = gR ≈ 0.89).
      const dir = mkdtempSync(join(tmpdir(), "remix-pro-mixer-"));
      try {
        const out = join(dir, "mix.mp3");
        writeFileSync(out, mixed.buffer);
        const raw = execFileSync(
          "ffmpeg",
          ["-hide_banner", "-loglevel", "error", "-i", out, "-f", "f32le", "-c:a", "pcm_f32le", "-"],
          { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
        );
        let left = 0;
        let right = 0;
        for (let frame = 0; frame < raw.length / 8; frame++) {
          left += raw.readFloatLE(frame * 8) ** 2;
          right += raw.readFloatLE(frame * 8 + 4) ** 2;
        }
        const ratioDb = 10 * Math.log10(left / right);
        expect(Math.abs(ratioDb - 20 * Math.log10(1.45399 / 0.891007))).toBeLessThan(0.3);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      // No Pro fields: no Pro mapping recorded.
      const plain = await mixer.mixUnmutedStems(
        [{ stemId: E2E_STEM, gainDb: 0, muted: false }],
        {
          userId: `${E2E_PREFIX}user`,
          remixProjectId: `${E2E_PREFIX}project`,
          authorizedStemIds: new Set([E2E_STEM]),
        },
        {
          effects: { schemaVersion: "remix-fx/v4", stems: { [E2E_STEM]: { echo: 0.2 } } },
          bpm: null,
        },
      );
      expect("effectsProDspVersion" in plain.renderMetadata).toBe(false);
      const after = remixMixTempDirs();
      expect([...after].filter((dir) => !before.has(dir))).toEqual([]);
    });

    it("renders structure blocks without effects and records them (#1899)", async () => {
      const mixer = new FfmpegStemAudioMixer(
        storageProvider as unknown as StorageProvider,
        encryptionService,
      );
      const grid = {
        kind: "time" as const,
        sectionSeconds: 0.5,
        bpm: null,
        durationSeconds: 1,
        sections: [
          { startSec: 0, endSec: 0.5 },
          { startSec: 0.5, endSec: 1 },
        ],
      };
      const structure = {
        schemaVersion: "remix-structure/v1" as const,
        blocks: [
          { section: 1 },
          { section: 0 },
          { section: 1, fadeOut: true as const },
        ],
      };
      const mixed = await mixer.mixUnmutedStems(
        [{ stemId: E2E_STEM, gainDb: 0, muted: false }],
        {
          userId: `${E2E_PREFIX}user`,
          remixProjectId: `${E2E_PREFIX}project`,
          authorizedStemIds: new Set([E2E_STEM]),
        },
        undefined,
        { structure, segments: structureTimeline(grid, structure.blocks) },
      );

      expect(mixed.renderMetadata).toMatchObject({
        schemaVersion: "remix-render-policy/v1",
        structure,
        structureVersion: "remix-structure-dsp/v1",
      });
      expect("effects" in mixed.renderMetadata).toBe(false);
      // The render lasts the 1.5 s timeline, not the 1 s source.
      const dir = mkdtempSync(join(tmpdir(), "remix-structure-mixer-"));
      try {
        const out = join(dir, "mix.mp3");
        writeFileSync(out, mixed.buffer);
        const raw = execFileSync(
          "ffmpeg",
          ["-hide_banner", "-loglevel", "error", "-i", out, "-ac", "1", "-f", "f32le", "-c:a", "pcm_f32le", "-"],
          { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
        );
        const seconds = raw.length / 4 / 48_000;
        expect(Math.abs(seconds - 1.5)).toBeLessThan(0.1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("synthesizes the beat into the temp dir, mixes it and records it (#1902)", async () => {
      const mixer = new FfmpegStemAudioMixer(
        storageProvider as unknown as StorageProvider,
        encryptionService,
      );
      const grid = {
        kind: "bars" as const,
        sectionSeconds: 2,
        bpm: 120,
        durationSeconds: 4,
        sections: [
          { startSec: 0, endSec: 2 },
          { startSec: 2, endSec: 4 },
        ],
      };
      const off = new Array<boolean>(16).fill(false);
      const beat: RemixBeat = {
        schemaVersion: REMIX_BEAT_SCHEMA_VERSION,
        kit: "punchy",
        pattern: {
          kick: Array.from({ length: 16 }, (_, step) => step % 4 === 0),
          snare: off,
          clap: off,
          hat: off,
          openHat: off,
        },
        swing: 0,
        gainDb: -2,
        blocks: null,
      };
      const before = remixMixTempDirs();
      const mixed = await mixer.mixUnmutedStems(
        [{ stemId: E2E_STEM, gainDb: 0, muted: false }],
        {
          userId: `${E2E_PREFIX}user`,
          remixProjectId: `${E2E_PREFIX}project`,
          authorizedStemIds: new Set([E2E_STEM]),
        },
        undefined,
        undefined,
        { beat, grid, segments: structureTimeline(grid, null) },
      );
      expect(mixed.renderMetadata).toMatchObject({
        schemaVersion: "remix-render-policy/v1",
        inputCount: 2,
        activeStemCount: 1,
        beat,
        beatDspVersion: "remix-beat-dsp/v1",
        addedParts: ["beat"],
      });
      expect("effects" in mixed.renderMetadata).toBe(false);
      expect("structure" in mixed.renderMetadata).toBe(false);
      // The beat WAV lives only in the per-render temp dir.
      const after = remixMixTempDirs();
      expect([...after].filter((dir) => !before.has(dir))).toEqual([]);
      // The 1 s source is extended by the 4 s beat timeline (+ decay tail).
      const dir = mkdtempSync(join(tmpdir(), "remix-beat-mixer-"));
      try {
        const out = join(dir, "mix.mp3");
        writeFileSync(out, mixed.buffer);
        const raw = execFileSync(
          "ffmpeg",
          ["-hide_banner", "-loglevel", "error", "-i", out, "-ac", "1", "-f", "f32le", "-c:a", "pcm_f32le", "-"],
          { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
        );
        expect(raw.length / 4 / 48_000).toBeGreaterThan(4.5);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }

      // A muted beat is skipped entirely: no input, no beat metadata.
      const mutedMix = await mixer.mixUnmutedStems(
        [{ stemId: E2E_STEM, gainDb: 0, muted: false }],
        {
          userId: `${E2E_PREFIX}user`,
          remixProjectId: `${E2E_PREFIX}project`,
          authorizedStemIds: new Set([E2E_STEM]),
        },
        undefined,
        undefined,
        {
          beat: { ...beat, muted: true },
          grid,
          segments: structureTimeline(grid, null),
        },
      );
      expect(mutedMix.renderMetadata.inputCount).toBe(1);
      expect("beat" in mutedMix.renderMetadata).toBe(false);
      expect("addedParts" in mutedMix.renderMetadata).toBe(false);
    });

    /** Decoded length of an mp3 render, in seconds. */
    function renderSeconds(buffer: Buffer): number {
      const dir = mkdtempSync(join(tmpdir(), "remix-stretch-mixer-"));
      try {
        const out = join(dir, "mix.mp3");
        writeFileSync(out, buffer);
        const raw = execFileSync(
          "ffmpeg",
          ["-hide_banner", "-loglevel", "error", "-i", out, "-ac", "1", "-f", "f32le", "-c:a", "pcm_f32le", "-"],
          { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
        );
        return raw.length / 4 / 48_000;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it("time-stretches the decrypted stem and the AI layer (keepPitch + key), records the engine and cleans up (#1898)", async () => {
      const mixer = new FfmpegStemAudioMixer(
        storageProvider as unknown as StorageProvider,
        encryptionService,
      );
      const effects = {
        schemaVersion: "remix-fx/v2" as const,
        master: { speed: 0.85, keepPitch: true as const, semitones: 2 },
      };
      const before = remixMixTempDirs();
      const mixed = await mixer.mixUnmutedStemsWithAudioBuffers(
        [{ stemId: E2E_STEM, gainDb: 0, muted: false }],
        [
          {
            buffer: sineWav(330, 1),
            mimeType: "audio/wav",
            gainDb: 0,
            label: "generated-layer",
          },
        ],
        {
          userId: `${E2E_PREFIX}user`,
          remixProjectId: `${E2E_PREFIX}project`,
          authorizedStemIds: new Set([E2E_STEM]),
        },
        { effects, bpm: 120 },
      );
      expect(mixed.inputCount).toBe(2);
      expect(mixed.renderMetadata).toMatchObject({
        effects,
        effectsDspVersion: "remix-fx-dsp/v1",
        stretch: {
          engine: REMIX_STRETCH_ENGINE,
          wasmSha256: REMIX_STRETCH_WASM_SHA256,
          tempo: 0.85,
          semitones: 2,
        },
      });
      // Tempo changed by the stretch (no varispeed): 1 s → 1/0.85 s.
      expect(Math.abs(renderSeconds(mixed.buffer) - 1 / 0.85)).toBeLessThan(0.08);
      // Decrypted plaintext, raw decodes and stretched WAVs all lived only in
      // the per-render temp dir.
      const after = remixMixTempDirs();
      expect([...after].filter((dir) => !before.has(dir))).toEqual([]);
    });

    it("records no stretch for a varispeed-only v2 recipe (#1898)", async () => {
      const mixer = new FfmpegStemAudioMixer(
        storageProvider as unknown as StorageProvider,
        encryptionService,
      );
      const mixed = await mixer.mixUnmutedStems(
        [{ stemId: E2E_STEM, gainDb: 0, muted: false }],
        {
          userId: `${E2E_PREFIX}user`,
          remixProjectId: `${E2E_PREFIX}project`,
          authorizedStemIds: new Set([E2E_STEM]),
        },
        { effects: { schemaVersion: "remix-fx/v2", master: { speed: 0.85 } }, bpm: null },
      );
      expect("stretch" in mixed.renderMetadata).toBe(false);
      expect(Math.abs(renderSeconds(mixed.buffer) - 1 / 0.85)).toBeLessThan(0.08);
    });

    it("stretches under a structure and synthesizes the beat in output time (#1898)", async () => {
      const mixer = new FfmpegStemAudioMixer(
        storageProvider as unknown as StorageProvider,
        encryptionService,
      );
      const grid = {
        kind: "bars" as const,
        sectionSeconds: 0.5,
        bpm: 480,
        durationSeconds: 1,
        sections: [
          { startSec: 0, endSec: 0.5 },
          { startSec: 0.5, endSec: 1 },
        ],
      };
      const structure = {
        schemaVersion: "remix-structure/v1" as const,
        blocks: [{ section: 1 }, { section: 0 }, { section: 1 }],
      };
      const segments = structureTimeline(grid, structure.blocks);
      const off = new Array<boolean>(16).fill(false);
      const beat: RemixBeat = {
        schemaVersion: REMIX_BEAT_SCHEMA_VERSION,
        kit: "punchy",
        pattern: { kick: [true, ...off.slice(1)], snare: off, clap: off, hat: off, openHat: off },
        swing: 0,
        gainDb: -6,
        blocks: null,
      };
      const before = remixMixTempDirs();
      const mixed = await mixer.mixUnmutedStems(
        [{ stemId: E2E_STEM, gainDb: 0, muted: false }],
        {
          userId: `${E2E_PREFIX}user`,
          remixProjectId: `${E2E_PREFIX}project`,
          authorizedStemIds: new Set([E2E_STEM]),
        },
        {
          effects: {
            schemaVersion: "remix-fx/v2",
            master: { speed: 1.25, keepPitch: true },
          },
          bpm: 480,
        },
        { structure, segments },
        { beat, grid, segments },
      );
      expect(mixed.renderMetadata).toMatchObject({
        structure,
        beat,
        stretch: { tempo: 1.25, semitones: 0 },
      });
      // 1.5 s timeline ÷ 1.25 = 1.2 s of stems; the beat track is synthesized
      // in output time: 1.2 s + its 0.9 s one-shot decay room = 2.1 s, at
      // rate 1. (Varispeeding a timeline-time beat would give 2.4/1.25 =
      // 1.92 s.)
      const seconds = renderSeconds(mixed.buffer);
      expect(Math.abs(seconds - 2.1)).toBeLessThan(0.06);
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

const audiowmarkAvailable = (() => {
  try {
    execFileSync("audiowmark", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

(ffmpegAvailable ? describe : describe.skip)(
  "FfmpegStemAudioMixer remix watermark (#2573)",
  () => {
    const WM_PREFIX = `mixer_wm_${Date.now()}_`;
    const WM_TRACK = `${WM_PREFIX}track`;
    const WM_STEM = `${WM_PREFIX}stem`;
    const KEY = "key 00112233445566778899aabbccddeeff";
    const storageProvider = {
      upload: jest.fn(),
      download: jest.fn().mockResolvedValue(null),
      downloadRange: jest.fn(),
      delete: jest.fn(),
    };
    const encryptionService = { decryptForRender: jest.fn() };
    let binDir: string;
    const auth = (): StemRenderAuthorization => ({
      userId: `${WM_PREFIX}user`,
      remixProjectId: `${WM_PREFIX}project`,
      authorizedStemIds: new Set([WM_STEM]),
    });
    const stems = [{ stemId: WM_STEM, gainDb: 0, muted: false }];

    /** A stand-in for audiowmark add: copies its input to its output (or fails). */
    function fakeAudiowmark(fail = false): string {
      const path = join(binDir, fail ? "fail.sh" : "copy.sh");
      writeFileSync(
        path,
        fail
          ? "#!/bin/sh\necho boom >&2\nexit 1\n"
          : '#!/bin/sh\nexec ffmpeg -y -loglevel error -i "$6" -c:a pcm_f32le "$7"\n',
      );
      chmodSync(path, 0o755);
      return path;
    }
    const mixerWith = (binary: string | null) =>
      new FfmpegStemAudioMixer(
        storageProvider as unknown as StorageProvider,
        encryptionService as unknown as EncryptionService,
        binary
          ? new RemixWatermarkEmbedder({ key: KEY, keyId: "test-key", strength: 15, binary })
          : null,
      );

    beforeAll(async () => {
      binDir = mkdtempSync(join(tmpdir(), "wm-bin-"));
      await prisma.user.create({
        data: { id: `${WM_PREFIX}user`, email: `${WM_PREFIX}@test.resonate` },
      });
      await prisma.artist.create({
        data: { id: `${WM_PREFIX}artist`, displayName: "WM Artist" },
      });
      await prisma.release.create({
        data: {
          id: `${WM_PREFIX}release`,
          artistId: `${WM_PREFIX}artist`,
          title: "WM Release",
          status: "ready",
        },
      });
      await prisma.track.create({
        data: { id: WM_TRACK, releaseId: `${WM_PREFIX}release`, title: "T", position: 1 },
      });
      await prisma.stem.create({
        data: {
          id: WM_STEM,
          trackId: WM_TRACK,
          type: "other",
          uri: "db://bytes",
          data: noisyWav(20),
          mimeType: "audio/wav",
          isEncrypted: false,
        },
      });
    });

    afterAll(async () => {
      rmSync(binDir, { recursive: true, force: true });
      await prisma.stem.deleteMany({ where: { trackId: WM_TRACK } });
      await prisma.track.deleteMany({ where: { id: WM_TRACK } });
      await prisma.release.deleteMany({ where: { id: `${WM_PREFIX}release` } });
      await prisma.artist.deleteMany({ where: { id: `${WM_PREFIX}artist` } });
      await prisma.user.deleteMany({ where: { id: `${WM_PREFIX}user` } });
    });

    it("embeds one token in the master and every stem tap, and records it without the token", async () => {
      const before = remixMixTempDirs();
      const stemFiles: Buffer[] = [];
      const mixed = await mixerWith(fakeAudiowmark()).mixUnmutedStems(
        stems,
        auth(),
        undefined,
        undefined,
        undefined,
        undefined,
        {
          watermark: true,
          stemTaps: async (_layer, path) => {
            stemFiles.push(readFileSync(path));
          },
        },
      );
      expect(mixed.mimeType).toBe("audio/mpeg");
      expect(mixed.buffer.subarray(0, 3).toString("latin1")).toMatch(/^(ID3|\xff)/);
      expect(mixed.watermark).toEqual({
        token: expect.stringMatching(/^[0-9a-f]{32}$/),
        scheme: "audiowmark",
        schemeVersion: "0.6.5",
        strength: 15,
        keyId: "test-key",
        stemIndexes: [0],
      });
      expect(mixed.renderMetadata.watermark).toEqual({
        status: "embedded",
        scheme: "audiowmark",
        schemeVersion: "0.6.5",
        strength: 15,
        keyId: "test-key",
        stemsEmbedded: 1,
      });
      expect(JSON.stringify(mixed.renderMetadata)).not.toContain(mixed.watermark!.token);
      expect(stemFiles).toHaveLength(1);
      expect(stemFiles[0].subarray(0, 4).toString("latin1")).toBe("fLaC");
      const after = remixMixTempDirs();
      expect([...after].filter((dir) => !before.has(dir))).toEqual([]);
    });

    it("ships the render unwatermarked when the embedder fails", async () => {
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const stemFiles: Buffer[] = [];
      const mixed = await mixerWith(fakeAudiowmark(true)).mixUnmutedStems(
        stems,
        auth(),
        undefined,
        undefined,
        undefined,
        undefined,
        {
          watermark: true,
          stemTaps: async (_layer, path) => {
            stemFiles.push(readFileSync(path));
          },
        },
      );
      expect(mixed.buffer.length).toBeGreaterThan(0);
      expect(mixed.watermark).toBeUndefined();
      expect(mixed.renderMetadata.watermark).toEqual({
        status: "none",
        reason: "embed_failed",
      });
      expect(stemFiles).toHaveLength(1);
      // The log says why, but never carries the command line (it holds the token).
      const logged = warn.mock.calls.map(([message]) => String(message)).join("\n");
      expect(logged).toContain("embed failed");
      expect(logged).toContain("code 1");
      expect(logged).not.toMatch(/[0-9a-f]{32}/);
      expect(logged).not.toContain("--key");
      warn.mockRestore();
    });

    it("records watermark none without a key, and nothing when the caller did not ask", async () => {
      const unkeyed = await mixerWith(null).mixUnmutedStems(
        stems,
        auth(),
        undefined,
        undefined,
        undefined,
        undefined,
        { watermark: true },
      );
      expect(unkeyed.watermark).toBeUndefined();
      expect(unkeyed.renderMetadata.watermark).toEqual({ status: "none", reason: "no_key" });

      // A conditioning mix (no watermark asked) is untouched even with a key.
      const conditioning = await mixerWith(fakeAudiowmark()).mixUnmutedStems(stems, auth());
      expect(conditioning.watermark).toBeUndefined();
      expect("watermark" in conditioning.renderMetadata).toBe(false);
    });

    (audiowmarkAvailable ? it : it.skip)(
      "embeds a token the real audiowmark decodes from the MP3 master, the DJ extended export and the stem FLAC",
      async () => {
        const dir = mkdtempSync(join(tmpdir(), "wm-real-"));
        try {
          const keyPath = join(dir, "key");
          writeFileSync(keyPath, `${KEY}\n`);
          const stemPaths: string[] = [];
          const mixed = await mixerWith("audiowmark").mixUnmutedStems(
            stems,
            auth(),
            undefined,
            undefined,
            undefined,
            undefined,
            {
              watermark: true,
              stemTaps: async (_layer, path) => {
                const copy = join(dir, `stem-${stemPaths.length}.flac`);
                writeFileSync(copy, readFileSync(path));
                stemPaths.push(copy);
              },
            },
          );
          const token = mixed.watermark!.token;
          const masterPath = join(dir, "master.mp3");
          writeFileSync(masterPath, mixed.buffer);
          // DJ extended (#2540) re-renders the stored master: the mark carries.
          const plan = djExtendedPlan(
            {
              schemaVersion: REMIX_DRAFT_GRID_SCHEMA_VERSION,
              bpm: 120,
              downbeatsSec: Array.from({ length: 10 }, (_, bar) => bar * 2),
              timelineEndSec: 20,
            },
            {
              schemaVersion: REMIX_CUES_SCHEMA_VERSION,
              intro: { startBar: 1, bars: 2, repeats: 1 },
              outro: null,
            },
          );
          if ("unavailable" in plan) throw new Error(plan.unavailable);
          const djPath = join(dir, "dj-extended.mp3");
          writeFileSync(djPath, await renderDjExtended(mixed.buffer, ".mp3", plan));
          for (const path of [masterPath, djPath, ...stemPaths]) {
            const out = execFileSync("audiowmark", ["get", "--key", keyPath, path], {
              encoding: "utf8",
            });
            expect(out).toContain(token);
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      60_000,
    );
  },
);

/** 16-bit mono 44.1 kHz noise + tone: a carrier audiowmark can hide a payload in. */
function noisyWav(seconds: number, sampleRate = 44_100): Buffer {
  const samples = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  let seed = 12345;
  for (let i = 0; i < samples; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const noise = (seed / 0x7fffffff - 0.5) * 6000;
    const tone = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 4000;
    data.writeInt16LE(Math.round(noise + tone), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
