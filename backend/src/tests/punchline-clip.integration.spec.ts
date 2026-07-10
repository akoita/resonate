/**
 * Punchline clip extraction — Integration Test (Testcontainers) (#481)
 *
 * Exercises the real clip primitive against Testcontainer Postgres (no mocked
 * Prisma) + a real LocalStorageProvider + real ffmpeg. Seeds
 * User → Artist → Release → Track → Stem and asserts:
 *   (a) a valid range returns a stored, re-downloadable MP3 descriptor;
 *   (b) endMs <= startMs → invalid_range;
 *   (c) duration < min → clip_too_short;
 *   (d) duration > max → clip_too_long;
 *   (e) endMs beyond a known source length → range_exceeds_source;
 *   (f) a track with no vocals stem → no_vocals_stem.
 *
 * ffmpeg availability: this mirrors remix-stem-audio-mixer.integration.spec.ts
 * exactly — probe `ffmpeg -version` once and gate the ffmpeg-dependent success
 * test behind `(ffmpegAvailable ? describe : describe.skip)`. The validation
 * tests fail fast before any ffmpeg work, so they run unconditionally. No CI
 * workflow installs ffmpeg for the backend-integration job today, so we must
 * not add a test that hard-fails without the binary; the remix mixer spec sets
 * this precedent and we follow it. The fixture MP3 is itself generated with
 * ffmpeg lavfi inside the same guard.
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='punchline-clip'
 */

import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../db/prisma";
import { EncryptionService } from "../modules/encryption/encryption.service";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";
import {
  PunchlineClipException,
  PunchlineClipService,
} from "../modules/punchline/punchline-clip.service";
import {
  PUNCHLINE_CLIP_MAX_MS,
  PUNCHLINE_CLIP_MIN_MS,
} from "../modules/punchline/punchline-clip.config";

const TEST_PREFIX = `punchline_clip_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const VOCALS_STEM_ID = `${TEST_PREFIX}vocals`;
// A separate track with only a non-vocals stem for the no_vocals_stem case.
const TRACK_NO_VOCALS_ID = `${TEST_PREFIX}track_novox`;

const SOURCE_DURATION_SEC = 10;

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Generate a small real MP3 with ffmpeg lavfi and return its bytes. */
function generateFixtureMp3(durationSec: number): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "punchline-clip-fixture-"));
  const outPath = join(dir, "fixture.mp3");
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=440:duration=${durationSec}`,
        "-codec:a",
        "libmp3lame",
        outPath,
      ],
      { stdio: "ignore" },
    );
    return readFileSync(outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Punchline clip extraction (integration)", () => {
  const storageProvider = new LocalStorageProvider();
  // Real EncryptionService is unused on the plaintext path (isEncrypted:false);
  // a stub keeps the service constructable without wiring the AES provider.
  const encryptionService = {
    decryptForRender: jest.fn(),
  } as unknown as EncryptionService;
  let service: PunchlineClipService;

  beforeAll(async () => {
    service = new PunchlineClipService(
      storageProvider,
      encryptionService,
      undefined,
    );

    await prisma.user.create({
      data: { id: USER_ID, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: USER_ID,
        displayName: "Punchline Clip Artist",
      },
    });
    await prisma.release.create({
      data: {
        id: RELEASE_ID,
        artistId: ARTIST_ID,
        title: "Punchline Clip Release",
        status: "ready",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: RELEASE_ID,
        title: "Punchline Clip Track",
        position: 1,
        processingStatus: "complete",
        contentStatus: "clean",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_NO_VOCALS_ID,
        releaseId: RELEASE_ID,
        title: "Punchline Clip Track (no vocals)",
        position: 2,
        processingStatus: "complete",
        contentStatus: "clean",
      },
    });
    // Track with a drums stem only → no vocals source.
    await prisma.stem.create({
      data: {
        id: `${TEST_PREFIX}drums`,
        trackId: TRACK_NO_VOCALS_ID,
        type: "drums",
        uri: `local://${TEST_PREFIX}-drums`,
      },
    });

    // The vocals stem carries a real MP3 inline so the data-first load path is
    // exercised without a storage round-trip. Only seed it when ffmpeg exists.
    if (ffmpegAvailable) {
      const fixture = generateFixtureMp3(SOURCE_DURATION_SEC);
      await prisma.stem.create({
        data: {
          id: VOCALS_STEM_ID,
          trackId: TRACK_ID,
          type: "vocals",
          uri: `local://${TEST_PREFIX}-vocals`,
          data: fixture,
          mimeType: "audio/mpeg",
          durationSeconds: SOURCE_DURATION_SEC,
          isEncrypted: false,
        },
      });
    } else {
      // Without ffmpeg the success test is skipped, but the validation tests
      // still need a vocals stem present so they exercise range/length checks
      // (which run before any ffmpeg work) rather than tripping no_vocals_stem.
      await prisma.stem.create({
        data: {
          id: VOCALS_STEM_ID,
          trackId: TRACK_ID,
          type: "vocals",
          uri: `local://${TEST_PREFIX}-vocals`,
          durationSeconds: SOURCE_DURATION_SEC,
          isEncrypted: false,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.track.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.release.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.artist.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
  });

  const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
    } catch (error) {
      if (error instanceof PunchlineClipException) {
        return error.code;
      }
      throw error;
    }
    throw new Error("Expected extractClip to throw a PunchlineClipException");
  };

  (ffmpegAvailable ? it : it.skip)(
    "(a) extracts a valid range into a stored, re-downloadable MP3 descriptor",
    async () => {
      const result = await service.extractClip({
        trackId: TRACK_ID,
        startMs: 1000,
        endMs: 6000,
      });

      expect(result.durationMs).toBe(5000);
      expect(result.startMs).toBe(1000);
      expect(result.endMs).toBe(6000);
      expect(result.mimeType).toBe("audio/mpeg");
      expect(result.sourceStemType).toBe("vocals");
      expect(result.sourceStemId).toBe(VOCALS_STEM_ID);
      expect(result.byteSize).toBeGreaterThan(0);
      expect(result.clipAssetUri).toBeTruthy();
      expect(result.storageProvider).toBe("local");

      const downloaded = await storageProvider.download(result.clipAssetUri);
      expect(downloaded).not.toBeNull();
      expect(downloaded!.length).toBeGreaterThan(0);
      expect(downloaded!.length).toBe(result.byteSize);
    },
  );

  it("(b) rejects endMs <= startMs with invalid_range", async () => {
    expect(
      await codeOf(() =>
        service.extractClip({ trackId: TRACK_ID, startMs: 5000, endMs: 5000 }),
      ),
    ).toBe("invalid_range");
  });

  it("(c) rejects a clip shorter than the minimum with clip_too_short", async () => {
    expect(
      await codeOf(() =>
        service.extractClip({
          trackId: TRACK_ID,
          startMs: 1000,
          endMs: 1000 + PUNCHLINE_CLIP_MIN_MS - 1,
        }),
      ),
    ).toBe("clip_too_short");
  });

  it("(d) rejects a clip longer than the maximum with clip_too_long", async () => {
    expect(
      await codeOf(() =>
        service.extractClip({
          trackId: TRACK_ID,
          startMs: 0,
          endMs: PUNCHLINE_CLIP_MAX_MS + 1,
        }),
      ),
    ).toBe("clip_too_long");
  });

  it("(e) rejects a within-bounds range past the source length with range_exceeds_source", async () => {
    // 8000→12000 is 4000ms (within [min,max]) but endMs 12000 > 10000ms source.
    expect(
      await codeOf(() =>
        service.extractClip({ trackId: TRACK_ID, startMs: 8000, endMs: 12000 }),
      ),
    ).toBe("range_exceeds_source");
  });

  it("(f) rejects a track with no vocals stem with no_vocals_stem", async () => {
    expect(
      await codeOf(() =>
        service.extractClip({
          trackId: TRACK_NO_VOCALS_ID,
          startMs: 1000,
          endMs: 6000,
        }),
      ),
    ).toBe("no_vocals_stem");
  });
});
