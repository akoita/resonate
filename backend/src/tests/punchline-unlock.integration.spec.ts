/**
 * Punchline complete-set unlock rewards — Integration Test (Testcontainers) (#488)
 *
 * Real Prisma + real EventBus. Covers:
 *   (a) owner configures a bonus (validated range + note); replace + remove
 *   (b) non-owner / published-drop config attempts are rejected
 *   (c) collecting the full set grants the reward EXACTLY once (repeat call
 *       is a no-op; DB unique) and emits punchline.unlock_granted once
 *   (d) an incomplete set grants nothing
 *   (e) reward state queryable: collector (me/unlocks reveals content) and
 *       artist (owner view with grantedCount); public drop payload carries
 *       existence only — never the reward content
 *   (f) publish extracts the bonus clip into rewardMetadata (ffmpeg-guarded)
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='punchline-unlock'
 */

import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { EncryptionService } from "../modules/encryption/encryption.service";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";
import { PunchlineClipService } from "../modules/punchline/punchline-clip.service";
import { PunchlineCollectService } from "../modules/punchline/punchline-collect.service";
import { PunchlineDropService } from "../modules/punchline/punchline-drop.service";
import { PunchlineEligibilityService } from "../modules/punchline/punchline-eligibility.service";
import { PunchlineUnlockService } from "../modules/punchline/punchline-unlock.service";
import type { ResonateEvent } from "../events/event_types";

const TEST_PREFIX = `punchline_unlock_${Date.now()}_`;

const OWNER_USER = `${TEST_PREFIX}owner`;
const STRANGER_USER = `${TEST_PREFIX}stranger`;
const FAN_A = `${TEST_PREFIX}fan_a`;
const FAN_B = `${TEST_PREFIX}fan_b`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const STRANGER_ARTIST_ID = `${TEST_PREFIX}artist2`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const VOCALS_STEM_ID = `${TEST_PREFIX}vocals`;

const DROP_SET = `${TEST_PREFIX}drop_set`;
const MOMENT_A = `${TEST_PREFIX}m_a`;
const MOMENT_B = `${TEST_PREFIX}m_b`;

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function generateFixtureMp3(durationSec: number): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "punchline-unlock-fixture-"));
  const outPath = join(dir, "fixture.mp3");
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", `sine=frequency=440:duration=${durationSec}`,
        "-codec:a", "libmp3lame", outPath,
      ],
      { stdio: "ignore" },
    );
    return readFileSync(outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Punchline complete-set unlock rewards (integration)", () => {
  const storageProvider = new LocalStorageProvider();
  const encryptionService = {
    decryptForRender: jest.fn(),
  } as unknown as EncryptionService;
  const eventBus = new EventBus();
  const events: ResonateEvent[] = [];
  const clipService = new PunchlineClipService(
    storageProvider,
    encryptionService,
    undefined,
  );
  const unlockService = new PunchlineUnlockService(
    eventBus,
    clipService,
    undefined,
  );
  const collectService = new PunchlineCollectService(eventBus, unlockService);
  const dropService = new PunchlineDropService(
    eventBus,
    new PunchlineEligibilityService(),
    clipService,
    unlockService,
    undefined,
  );

  beforeAll(async () => {
    eventBus.subscribe("punchline.unlock_granted", (e) => {
      events.push(e);
    });

    for (const [user, artist] of [
      [OWNER_USER, ARTIST_ID],
      [STRANGER_USER, STRANGER_ARTIST_ID],
    ] as const) {
      await prisma.user.create({
        data: { id: user, email: `${user}@test.resonate` },
      });
      await prisma.artist.create({
        data: { id: artist, userId: user, displayName: user },
      });
    }
    for (const fan of [FAN_A, FAN_B]) {
      await prisma.user.create({
        data: { id: fan, email: `${fan}@test.resonate` },
      });
    }
    await prisma.release.create({
      data: {
        id: RELEASE_ID,
        artistId: ARTIST_ID,
        title: "Unlock Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: RELEASE_ID,
        title: "Unlock Track",
        position: 1,
        processingStatus: "complete",
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.create({
      data: {
        id: VOCALS_STEM_ID,
        trackId: TRACK_ID,
        type: "vocals",
        uri: `local://${TEST_PREFIX}-vocals`,
        durationSeconds: 10,
        ...(ffmpegAvailable ? { data: generateFixtureMp3(10) } : {}),
      },
    });
    // A published two-moment drop for the grant-path cases.
    await prisma.punchlineDrop.create({
      data: {
        id: DROP_SET,
        trackId: TRACK_ID,
        artistId: ARTIST_ID,
        status: "published",
        publishedAt: new Date(),
        moments: {
          create: [
            {
              id: MOMENT_A,
              title: "Set A",
              lyricText: "line a",
              startMs: 1000,
              endMs: 5000,
              editionSize: 10,
              priceCents: 0,
            },
            {
              id: MOMENT_B,
              title: "Set B",
              lyricText: "line b",
              startMs: 5000,
              endMs: 9000,
              editionSize: 10,
              priceCents: 0,
            },
          ],
        },
        unlocks: {
          create: [
            {
              unlockType: "complete_set",
              rewardMetadata: {
                kind: "bonus_clip",
                startMs: 2000,
                endMs: 6000,
                message: "You caught them all — this one's just for you.",
                clipAssetUri: null,
              },
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.punchlineUnlockGrant.deleteMany({
      where: { collectorUserId: { startsWith: TEST_PREFIX } },
    });
    await prisma.punchlineCollectible.deleteMany({
      where: { collectorUserId: { startsWith: TEST_PREFIX } },
    });
    // Service-created drops carry uuid ids — delete by track, not id prefix.
    await prisma.punchlineDrop.deleteMany({
      where: { trackId: TRACK_ID },
    });
    await prisma.stem.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.artist.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it("(a) owner configures, replaces, and removes a draft's bonus", async () => {
    const draft = await dropService.createDraft(OWNER_USER, {
      trackId: TRACK_ID,
      title: "Config drop",
    });

    const first = await unlockService.setDropUnlock(OWNER_USER, draft.id, {
      startMs: 1000,
      endMs: 4000,
      message: "  First note  ",
    });
    expect(first?.unlockType).toBe("complete_set");
    expect(first?.reward).toMatchObject({
      kind: "bonus_clip",
      startMs: 1000,
      endMs: 4000,
      message: "First note",
      clipAssetUri: null,
    });

    // Replace keeps exactly one unlock per drop.
    await unlockService.setDropUnlock(OWNER_USER, draft.id, {
      startMs: 2000,
      endMs: 5000,
    });
    const count = await prisma.punchlineUnlock.count({
      where: { dropId: draft.id },
    });
    expect(count).toBe(1);

    // Invalid ranges rejected.
    await expect(
      unlockService.setDropUnlock(OWNER_USER, draft.id, {
        startMs: 0,
        endMs: 500,
      }),
    ).rejects.toMatchObject({ status: 400 });

    const removed = await unlockService.removeDropUnlock(OWNER_USER, draft.id);
    expect(removed).toEqual({ removed: true });
    expect(
      await prisma.punchlineUnlock.count({ where: { dropId: draft.id } }),
    ).toBe(0);

    await prisma.punchlineDrop.delete({ where: { id: draft.id } });
  });

  it("(b) rejects non-owner config and published-drop config", async () => {
    const draft = await dropService.createDraft(OWNER_USER, {
      trackId: TRACK_ID,
    });
    await expect(
      unlockService.setDropUnlock(STRANGER_USER, draft.id, {
        startMs: 1000,
        endMs: 4000,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await prisma.punchlineDrop.delete({ where: { id: draft.id } });

    await expect(
      unlockService.setDropUnlock(OWNER_USER, DROP_SET, {
        startMs: 1000,
        endMs: 4000,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("(d) an incomplete set grants nothing", async () => {
    const first = await collectService.collectMoment(FAN_A, MOMENT_A);
    expect(first.setCompleted).toBe(false);
    expect(first.unlock).toBeNull();
    expect(
      await prisma.punchlineUnlockGrant.count({
        where: { collectorUserId: FAN_A },
      }),
    ).toBe(0);
  });

  it("(c) completing the set grants exactly once and emits the event once", async () => {
    const second = await collectService.collectMoment(FAN_A, MOMENT_B);
    expect(second.setCompleted).toBe(true);
    expect(second.unlock).toMatchObject({
      newlyGranted: true,
      unlockType: "complete_set",
    });
    expect(second.unlock?.reward?.message).toContain("just for you");

    // Repeat grant is a no-op (exactly-once).
    const repeat = await unlockService.grantForCompletedSet(FAN_A, DROP_SET);
    expect(repeat?.newlyGranted).toBe(false);
    expect(
      await prisma.punchlineUnlockGrant.count({
        where: { collectorUserId: FAN_A },
      }),
    ).toBe(1);
    expect(
      events.filter(
        (e) =>
          e.eventName === "punchline.unlock_granted" &&
          (e as any).collectorUserId === FAN_A,
      ),
    ).toHaveLength(1);
  });

  it("(e) reward state is queryable for collector and artist; public sees existence only", async () => {
    const mine = await unlockService.listMyUnlocks(FAN_A);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].reward?.message).toContain("just for you");
    expect(mine.items[0].drop.trackTitle).toBe("Unlock Track");

    const ownerView = await unlockService.getOwnerUnlock(DROP_SET);
    expect(ownerView?.grantedCount).toBe(1);
    expect(ownerView?.reward?.startMs).toBe(2000);

    // Fan B (not completed) sees existence, not content.
    const summaryB = await unlockService.summarizeForDrop(DROP_SET, FAN_B);
    expect(summaryB).toEqual({ unlockType: "complete_set", granted: false });

    // Public drop payload: unlock presence only, no reward field.
    const publicList = await dropService.listPublishedDropsForTrack(TRACK_ID);
    const publicDrop = publicList.items.find((d) => d.id === DROP_SET)!;
    expect(publicDrop.unlock).toEqual({ unlockType: "complete_set" });
    expect((publicDrop.unlock as any).reward).toBeUndefined();

    // Owner list reveals the config.
    const ownerList = await dropService.listDropsForTrackOwner(
      OWNER_USER,
      TRACK_ID,
    );
    const ownerDrop = ownerList.items.find((d) => d.id === DROP_SET)!;
    expect((ownerDrop.unlock as any).reward?.startMs).toBe(2000);
  });

  (ffmpegAvailable ? it : it.skip)(
    "(f) publish extracts the bonus clip into rewardMetadata",
    async () => {
      const draft = await dropService.createDraft(OWNER_USER, {
        trackId: TRACK_ID,
        title: "Publish with bonus",
      });
      await dropService.addMoment(OWNER_USER, draft.id, {
        title: "Only moment",
        lyricText: "the line",
        startMs: 1000,
        endMs: 5000,
        editionSize: 5,
        priceCents: 0,
      });
      await unlockService.setDropUnlock(OWNER_USER, draft.id, {
        startMs: 3000,
        endMs: 8000,
        message: "Bonus!",
      });

      const published = await dropService.publish(OWNER_USER, draft.id);
      expect(published.status).toBe("published");

      const unlock = await unlockService.getOwnerUnlock(draft.id);
      expect(unlock?.reward?.clipAssetUri).toBeTruthy();

      const downloaded = await storageProvider.download(
        unlock!.reward!.clipAssetUri!,
      );
      expect(downloaded).not.toBeNull();
      expect(downloaded!.length).toBeGreaterThan(0);
    },
  );
});
