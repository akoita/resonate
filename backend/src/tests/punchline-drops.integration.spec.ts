/**
 * Punchline Drops draft + publish APIs — Integration Test (Testcontainers) (#482)
 *
 * Exercises PunchlineDropService against Testcontainer Postgres (no mocked
 * Prisma) with a real LocalStorageProvider + real EventBus + real ffmpeg for
 * the publish path. Seeds an owner and a stranger (each User → Artist →
 * Release → Track → vocals Stem) and asserts the owner-scoped, draft-only
 * lifecycle, the #480 gate on create and publish, moment validation, and the
 * publish orchestration (gate → clip extraction → transaction → event).
 *
 * ffmpeg availability: mirrors punchline-clip.integration.spec.ts — probe
 * `ffmpeg -version` once and gate ONLY the publish-happy-path (which shells out
 * to ffmpeg via the clip service) behind `(ffmpegAvailable ? describe :
 * describe.skip)`. Everything else — create/add/update/remove/validation and
 * the zero-moment publish guard — fails fast before any ffmpeg work and runs
 * unconditionally. CI installs ffmpeg for the backend-integration job so the
 * publish path actually runs there.
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='punchline-drops'
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../db/prisma";
import { EncryptionService } from "../modules/encryption/encryption.service";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";
import { EventBus } from "../modules/shared/event_bus";
import { PunchlineDropPublishedEvent } from "../events/event_types";
import { PunchlineClipService } from "../modules/punchline/punchline-clip.service";
import { PunchlineDropService } from "../modules/punchline/punchline-drop.service";
import { PunchlineEligibilityService } from "../modules/punchline/punchline-eligibility.service";
import { PunchlineUnlockService } from "../modules/punchline/punchline-unlock.service";

const TEST_PREFIX = `punchline_drops_${Date.now()}_`;

const OWNER_USER = `${TEST_PREFIX}owner_user`;
const OWNER_ARTIST = `${TEST_PREFIX}owner_artist`;
const STRANGER_USER = `${TEST_PREFIX}stranger_user`;
const STRANGER_ARTIST = `${TEST_PREFIX}stranger_artist`;

const OWNER_RELEASE = `${TEST_PREFIX}owner_release`;
const STRANGER_RELEASE = `${TEST_PREFIX}stranger_release`;

const TRACK_ELIGIBLE = `${TEST_PREFIX}track_eligible`;
const TRACK_QUARANTINED = `${TEST_PREFIX}track_quarantined`;
const TRACK_STRANGER = `${TEST_PREFIX}track_stranger`;

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
  const dir = mkdtempSync(join(tmpdir(), "punchline-drops-fixture-"));
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

describe("Punchline Drops draft + publish (integration)", () => {
  const storageProvider = new LocalStorageProvider();
  // Plaintext path only (isEncrypted:false); a stub keeps the clip service
  // constructable without wiring the AES provider.
  const encryptionService = {
    decryptForRender: jest.fn(),
  } as unknown as EncryptionService;

  const eventBus = new EventBus();
  const clipService = new PunchlineClipService(
    storageProvider,
    encryptionService,
    undefined,
  );
  const eligibilityService = new PunchlineEligibilityService();
  const unlockService = new PunchlineUnlockService(
    eventBus,
    clipService,
    undefined,
  );
  const service = new PunchlineDropService(
    eventBus,
    eligibilityService,
    clipService,
    unlockService,
    undefined,
  );

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: OWNER_USER, email: `${OWNER_USER}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: OWNER_ARTIST,
        userId: OWNER_USER,
        displayName: "Punchline Owner",
      },
    });
    await prisma.user.create({
      data: { id: STRANGER_USER, email: `${STRANGER_USER}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: STRANGER_ARTIST,
        userId: STRANGER_USER,
        displayName: "Punchline Stranger",
      },
    });

    await prisma.release.create({
      data: {
        id: OWNER_RELEASE,
        artistId: OWNER_ARTIST,
        title: "Owner Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.release.create({
      data: {
        id: STRANGER_RELEASE,
        artistId: STRANGER_ARTIST,
        title: "Stranger Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });

    // Eligible track (owner): clean + ready + STANDARD_ESCROW + vocals stem.
    await prisma.track.create({
      data: {
        id: TRACK_ELIGIBLE,
        releaseId: OWNER_RELEASE,
        title: "Eligible Track",
        position: 1,
        processingStatus: "complete",
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    // Ineligible track (owner): quarantined.
    await prisma.track.create({
      data: {
        id: TRACK_QUARANTINED,
        releaseId: OWNER_RELEASE,
        title: "Quarantined Track",
        position: 2,
        processingStatus: "complete",
        contentStatus: "quarantined",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    // Stranger-owned track (for the ownership check on create).
    await prisma.track.create({
      data: {
        id: TRACK_STRANGER,
        releaseId: STRANGER_RELEASE,
        title: "Stranger Track",
        position: 1,
        processingStatus: "complete",
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });

    // The eligible track's vocals stem carries a real MP3 inline (data-first
    // load path) only when ffmpeg exists, so the publish path can extract. The
    // uri is always present so eligibility (which only needs a non-empty uri)
    // passes regardless.
    await prisma.stem.create({
      data: {
        id: `${TRACK_ELIGIBLE}_vocals`,
        trackId: TRACK_ELIGIBLE,
        type: "vocals",
        uri: `local://${TRACK_ELIGIBLE}-vocals`,
        durationSeconds: SOURCE_DURATION_SEC,
        isEncrypted: false,
        ...(ffmpegAvailable
          ? { data: generateFixtureMp3(SOURCE_DURATION_SEC), mimeType: "audio/mpeg" }
          : {}),
      },
    });
    await prisma.stem.create({
      data: {
        id: `${TRACK_QUARANTINED}_vocals`,
        trackId: TRACK_QUARANTINED,
        type: "vocals",
        uri: `local://${TRACK_QUARANTINED}-vocals`,
      },
    });
    await prisma.stem.create({
      data: {
        id: `${TRACK_STRANGER}_vocals`,
        trackId: TRACK_STRANGER,
        type: "vocals",
        uri: `local://${TRACK_STRANGER}-vocals`,
      },
    });
  });

  afterAll(async () => {
    // Drops use uuid ids; scope cleanup by the (prefixed) artist ids. Moments
    // cascade on drop delete (schema onDelete: Cascade).
    await prisma.punchlineDrop.deleteMany({
      where: { artistId: { startsWith: TEST_PREFIX } },
    });
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

  const validMoment = () => ({
    title: "The Line",
    lyricText: "Own the line everybody rewinds",
    startMs: 1000,
    endMs: 6000,
    editionSize: 100,
    priceCents: 500,
  });

  const responseOf = async (
    fn: () => Promise<unknown>,
  ): Promise<Record<string, unknown>> => {
    try {
      await fn();
    } catch (error) {
      if (error instanceof BadRequestException) {
        return error.getResponse() as Record<string, unknown>;
      }
      throw error;
    }
    throw new Error("Expected a BadRequestException");
  };

  // ---- create --------------------------------------------------------------

  it("creates a draft on an owned, eligible track", async () => {
    const drop = await service.createDraft(OWNER_USER, {
      trackId: TRACK_ELIGIBLE,
      title: "My First Drop",
    });

    expect(drop.id).toBeTruthy();
    expect(drop.status).toBe("draft");
    expect(drop.trackId).toBe(TRACK_ELIGIBLE);
    expect(drop.artistId).toBe(OWNER_ARTIST);
    expect(drop.title).toBe("My First Drop");
    expect(drop.rightsLabel).toBe("NON_COMMERCIAL_COLLECTIBLE");
    expect(drop.moments).toEqual([]);
  });

  it("rejects create on a track the caller does not own with Forbidden", async () => {
    await expect(
      service.createDraft(OWNER_USER, { trackId: TRACK_STRANGER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects create on an ineligible (quarantined) track with track_not_eligible", async () => {
    const response = await responseOf(() =>
      service.createDraft(OWNER_USER, { trackId: TRACK_QUARANTINED }),
    );
    expect(response.code).toBe("track_not_eligible");
    expect(Array.isArray(response.reasons)).toBe(true);
  });

  // ---- moments -------------------------------------------------------------

  it("adds a valid moment and persists it", async () => {
    const drop = await service.createDraft(OWNER_USER, {
      trackId: TRACK_ELIGIBLE,
    });
    const updated = await service.addMoment(OWNER_USER, drop.id, validMoment());

    expect(updated.moments).toHaveLength(1);
    const [moment] = updated.moments;
    expect(moment.title).toBe("The Line");
    expect(moment.sourceStemType).toBe("vocals");
    expect(moment.rightsLabel).toBe("NON_COMMERCIAL_COLLECTIBLE");
    expect(moment.clipAssetUri).toBeNull();
    expect(moment.collectedCount).toBe(0);
  });

  it("rejects a moment whose range exceeds the max clip length", async () => {
    const drop = await service.createDraft(OWNER_USER, {
      trackId: TRACK_ELIGIBLE,
    });
    // 0..16000 = 16s > 15s max.
    await expect(
      service.addMoment(OWNER_USER, drop.id, {
        ...validMoment(),
        startMs: 0,
        endMs: 16000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a moment with editionSize 0", async () => {
    const drop = await service.createDraft(OWNER_USER, {
      trackId: TRACK_ELIGIBLE,
    });
    await expect(
      service.addMoment(OWNER_USER, drop.id, {
        ...validMoment(),
        editionSize: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a moment whose lyric text is too long", async () => {
    const drop = await service.createDraft(OWNER_USER, {
      trackId: TRACK_ELIGIBLE,
    });
    await expect(
      service.addMoment(OWNER_USER, drop.id, {
        ...validMoment(),
        lyricText: "x".repeat(501),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("updates and removes a moment for the owner on a draft", async () => {
    const drop = await service.createDraft(OWNER_USER, {
      trackId: TRACK_ELIGIBLE,
    });
    const added = await service.addMoment(OWNER_USER, drop.id, validMoment());
    const momentId = added.moments[0].id;

    const afterUpdate = await service.updateMoment(
      OWNER_USER,
      drop.id,
      momentId,
      { title: "Renamed Line", editionSize: 25 },
    );
    expect(afterUpdate.moments[0].title).toBe("Renamed Line");
    expect(afterUpdate.moments[0].editionSize).toBe(25);
    // Unspecified fields are preserved.
    expect(afterUpdate.moments[0].lyricText).toBe(
      "Own the line everybody rewinds",
    );

    const afterRemove = await service.removeMoment(
      OWNER_USER,
      drop.id,
      momentId,
    );
    expect(afterRemove.moments).toHaveLength(0);
  });

  it("rejects a stranger mutating another artist's drop with Forbidden", async () => {
    const drop = await service.createDraft(OWNER_USER, {
      trackId: TRACK_ELIGIBLE,
    });
    await expect(
      service.addMoment(STRANGER_USER, drop.id, validMoment()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ---- publish guards ------------------------------------------------------

  it("rejects publishing a drop with zero moments", async () => {
    const drop = await service.createDraft(OWNER_USER, {
      trackId: TRACK_ELIGIBLE,
    });
    await expect(service.publish(OWNER_USER, drop.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // ---- publish happy path (ffmpeg-gated) -----------------------------------

  (ffmpegAvailable ? describe : describe.skip)("publish happy path", () => {
    it("gates, extracts clips, persists, emits the event, and enforces visibility", async () => {
      const events: PunchlineDropPublishedEvent[] = [];
      const subscription = eventBus.subscribe<PunchlineDropPublishedEvent>(
        "punchline.drop_published",
        (event) => {
          events.push(event);
        },
      );

      try {
        const drop = await service.createDraft(OWNER_USER, {
          trackId: TRACK_ELIGIBLE,
          title: "Publishable Drop",
        });
        await service.addMoment(OWNER_USER, drop.id, validMoment());
        await service.addMoment(OWNER_USER, drop.id, {
          ...validMoment(),
          title: "Second Line",
          startMs: 2000,
          endMs: 5000,
          editionSize: 10,
        });

        const published = await service.publish(OWNER_USER, drop.id);

        expect(published.status).toBe("published");
        expect(published.publishedAt).toBeTruthy();
        expect(published.moments).toHaveLength(2);
        for (const moment of published.moments) {
          expect(moment.clipAssetUri).toBeTruthy();
          const downloaded = await storageProvider.download(
            moment.clipAssetUri as string,
          );
          expect(downloaded).not.toBeNull();
          expect(downloaded!.length).toBeGreaterThan(0);
        }

        // Event emitted with aggregate counts (100 + 10 editions).
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          eventName: "punchline.drop_published",
          eventVersion: 1,
          dropId: drop.id,
          trackId: TRACK_ELIGIBLE,
          artistId: OWNER_ARTIST,
          momentCount: 2,
          totalEditions: 110,
        });

        // Published drop is publicly visible (no userId).
        const publicView = await service.getDropDetail(drop.id);
        expect(publicView.status).toBe("published");

        // Mutating a published drop is rejected.
        await expect(
          service.addMoment(OWNER_USER, drop.id, validMoment()),
        ).rejects.toBeInstanceOf(BadRequestException);

        // A published drop appears in the per-track list with its moments.
        const list = await service.listPublishedDropsForTrack(TRACK_ELIGIBLE);
        expect(list.meta.limit).toBe(24);
        expect(list.items.length).toBeGreaterThanOrEqual(1);
        const listed = list.items.find((item) => item.id === drop.id);
        expect(listed).toBeDefined();
        expect(listed!.moments.length).toBe(2);
        // Only published drops are listed.
        expect(list.items.every((item) => item.status === "published")).toBe(
          true,
        );
      } finally {
        subscription.unsubscribe();
      }
    });
  });

  // ---- owner track-drops listing (#484 resume) -----------------------------

  it("lists the owner's drops for a track, newest first, all statuses", async () => {
    const draft = await service.createDraft(OWNER_USER, {
      trackId: TRACK_ELIGIBLE,
      title: "Resume Me",
    });

    const list = await service.listDropsForTrackOwner(OWNER_USER, TRACK_ELIGIBLE);

    expect(list.meta.count).toBe(list.items.length);
    expect(list.items.length).toBeGreaterThanOrEqual(1);
    // Every returned drop belongs to the caller and this track — no leaks.
    expect(list.items.every((d) => d.artistId === OWNER_ARTIST)).toBe(true);
    expect(list.items.every((d) => d.trackId === TRACK_ELIGIBLE)).toBe(true);
    // Newest-first: the just-created draft heads the list and is resumable.
    expect(list.items[0].id).toBe(draft.id);
    expect(list.items[0].status).toBe("draft");
  });

  it("never leaks another artist's drops to a different artist", async () => {
    // Owner has drops on the eligible track; the stranger owns none there.
    await service.createDraft(OWNER_USER, { trackId: TRACK_ELIGIBLE });

    const strangerList = await service.listDropsForTrackOwner(
      STRANGER_USER,
      TRACK_ELIGIBLE,
    );

    expect(strangerList.items).toEqual([]);
    expect(strangerList.meta.count).toBe(0);
  });

  // ---- draft visibility ----------------------------------------------------

  it("hides a draft drop from a non-owner and anonymous callers", async () => {
    const drop = await service.createDraft(OWNER_USER, {
      trackId: TRACK_ELIGIBLE,
    });

    // Owner can read their own draft.
    const ownerView = await service.getDropDetail(drop.id, OWNER_USER);
    expect(ownerView.status).toBe("draft");

    // Stranger gets a 404 (existence not leaked).
    await expect(
      service.getDropDetail(drop.id, STRANGER_USER),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Anonymous gets a 404.
    await expect(service.getDropDetail(drop.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
