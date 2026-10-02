/**
 * Crate watching, notify only — Integration (#1967, #1966)
 *
 * Real Prisma (Testcontainers Postgres). Covers the matcher end to end through
 * CrateWatchService (a newly playable track is matched against watching crates,
 * recorded once, and notified within the daily cap), the PATCH/GET watch
 * behaviour of CratesService, the resolver being asked for every gated feature,
 * and the erasure of recorded matches.
 *
 * Nothing is bought, quoted or reserved by watching; there is no purchase code
 * to test.
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='crate_watch.integration'
 */

import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException } from "@nestjs/common";
import type { AiDisclosureLevel } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AgentLearningService } from "../modules/agents/agent_learning.service";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { PersonalDataResolverService } from "../modules/identity/personal_data_resolver.service";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { PersonalDataErasureService } from "../modules/privacy/personal_data_erasure.service";
import { NotificationService } from "../modules/notifications/notification.service";
import { CrateEntitlementsService, CRATE_FREE_SAVED_CRATES } from "../modules/crates/crate-entitlements";
import { defaultCrateFilters } from "../modules/crates/crate_filters";
import { deterministicCrateRequestParser } from "../modules/crates/crate_request_parser";
import {
  CRATE_WATCH_MAX_CRATES_PER_EVENT,
  CRATE_WATCH_NOTIFICATIONS_PER_DAY,
  CRATE_WATCH_RECENT_MATCHES_LIMIT,
} from "../modules/crates/crate_watch";
import { CrateWatchService } from "../modules/crates/crate_watch.service";
import { CratesService } from "../modules/crates/crates.service";
import type { CrateFilters } from "../modules/crates/crate.types";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { EventBus } from "../modules/shared/event_bus";

const RUN = Date.now().toString(16);
const P = `cw${RUN}_`;
const id = (key: string) => `${P}${key}`;

/** 0x + 40 hex, unique per run: a user id that has a notification inbox. */
function wallet(tag: string) {
  return `0x${(tag + RUN).padEnd(40, "0").slice(0, 40)}`;
}

const DJ = wallet("d1d1");
const OTHER_DJ = wallet("d2d2");
const CAPPED_DJ = wallet("d3d3");
const BOUND_DJ = wallet("d4d4");
const ARTIST_USER = wallet("a1a1");
/** Not a wallet address: has no notification inbox. */
const NO_INBOX_DJ = id("noinbox");
const ALL_USERS = [DJ, OTHER_DJ, CAPPED_DJ, BOUND_DJ, ARTIST_USER, NO_INBOX_DJ];

const ARTIST = id("artist");

const BPM_WINDOW = { min: 120, max: 130 };

function features(tempoBpm: number, camelot = "8A") {
  return {
    schemaVersion: "stem-audio-features/v1",
    extractor: { name: "librosa", version: "0.10" },
    sampleRate: 22050,
    durationSeconds: 200,
    tempoBpm,
    tempoConfidence: 0.8,
    beatCount: 400,
    firstBeatSec: 0.4,
    key: { tonic: "A", mode: "minor", confidence: 0.4 },
    energyRms: 0.15,
    onsetDensity: 4,
    camelot,
  };
}

type SeedRelease = {
  key: string;
  tempoBpm?: number | null;
  releaseStatus?: string;
  processingStatus?: string;
  contentStatus?: string;
  aiDisclosureLevel?: AiDisclosureLevel;
  title?: string;
};

/** One release with one track and its original stem; returns the ids. */
async function seedRelease(spec: SeedRelease) {
  const releaseId = id(`${spec.key}_release`);
  const trackId = id(spec.key);
  await prisma.release.create({
    data: {
      id: releaseId,
      title: `Release ${spec.key}`,
      artistId: ARTIST,
      status: spec.releaseStatus ?? "ready",
      genre: "Techno",
    },
  });
  await prisma.track.create({
    data: {
      id: trackId,
      title: spec.title ?? `Track ${spec.key}`,
      releaseId,
      position: 1,
      processingStatus: spec.processingStatus ?? "complete",
      aiDisclosureLevel: spec.aiDisclosureLevel ?? "NONE",
      contentStatus: spec.contentStatus ?? "clean",
    },
  });
  await prisma.stem.create({
    data: {
      id: id(`${spec.key}_original`),
      trackId,
      type: "original",
      uri: `local://${spec.key}.mp3`,
      ...(spec.tempoBpm === null
        ? {}
        : { audioFeatures: features(spec.tempoBpm ?? 125) as never }),
    },
  });
  return { releaseId, trackId };
}

type SeedCrate = {
  userId: string;
  filters?: Partial<CrateFilters>;
  status?: string;
  watchMode?: string;
  watchExpiresAt?: Date | null;
  title?: string | null;
  items?: string[];
  updatedAt?: Date;
};

const DAY = 24 * 60 * 60 * 1000;

/** A crate that is watching and whose filters the default seed track fits. */
async function seedCrate(spec: SeedCrate) {
  const crate = await prisma.crate.create({
    data: {
      userId: spec.userId,
      title: spec.title === undefined ? "Friday" : spec.title,
      filters: { ...defaultCrateFilters(), bpm: BPM_WINDOW, ...spec.filters } as never,
      status: spec.status ?? "saved",
      watchMode: spec.watchMode ?? "notify",
      watchExpiresAt:
        spec.watchExpiresAt === undefined ? new Date(Date.now() + 30 * DAY) : spec.watchExpiresAt,
      ...(spec.updatedAt ? { updatedAt: spec.updatedAt } : {}),
    },
  });
  if (spec.items?.length) {
    await prisma.crateItem.createMany({
      data: spec.items.map((trackId, position) => ({
        crateId: crate.id,
        userId: spec.userId,
        trackId,
        position,
      })),
    });
  }
  return crate;
}

const matchesFor = (userId: string) =>
  prisma.crateWatchMatch.findMany({ where: { userId }, orderBy: { matchedAt: "asc" } });

const notificationsFor = (userId: string) =>
  prisma.notification.findMany({
    where: { walletAddress: userId.toLowerCase(), type: "crate_watch_match" },
    orderBy: { createdAt: "asc" },
  });

describe("Crate watching (integration)", () => {
  const eventBus = new EventBus();
  const notifications = new NotificationService(eventBus);
  const matcher = new CrateWatchService(new DiscoveryPolicyContextService(), eventBus, notifications);
  const entitlements = new CrateEntitlementsService();
  const crates = new CratesService(
    deterministicCrateRequestParser,
    new DiscoveryRankingService(),
    new DiscoveryPolicyContextService(),
    entitlements,
    new AgentLearningService(),
  );

  async function cleanCrates() {
    await prisma.notification.deleteMany({
      where: { walletAddress: { in: ALL_USERS.map((user) => user.toLowerCase()) } },
    });
    await prisma.crateItem.deleteMany({ where: { userId: { in: ALL_USERS } } });
    await prisma.crateWatchMatch.deleteMany({ where: { userId: { in: ALL_USERS } } });
    await prisma.crate.deleteMany({ where: { userId: { in: ALL_USERS } } });
  }

  beforeAll(async () => {
    for (const userId of ALL_USERS) {
      await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
    }
    await prisma.artist.create({
      data: {
        id: ARTIST,
        userId: ARTIST_USER,
        displayName: "Watch Artist",
        payoutAddress: `0x${"C".repeat(40)}`,
      },
    });
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanCrates();
  });

  afterAll(async () => {
    await cleanCrates();
    await prisma.stem.deleteMany({ where: { trackId: { startsWith: P } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: P } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: P } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { startsWith: P } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ALL_USERS } } }).catch(() => {});
  });

  // -------------------------------------------------------------------------
  describe("the matcher", () => {
    it("records a match and creates a notification linked to the crate", async () => {
      const { releaseId, trackId } = await seedRelease({ key: "m1", title: "Night Drive" });
      const crate = await seedCrate({ userId: DJ, title: "Friday" });

      const run = await matcher.evaluateRelease(releaseId);
      expect(run).toEqual({ tracksEvaluated: 1, matched: 1, notified: 1 });

      const matches = await matchesFor(DJ);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ crateId: crate.id, trackId, userId: DJ });
      expect(matches[0].notifiedAt).not.toBeNull();

      const inbox = await notificationsFor(DJ);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({
        type: "crate_watch_match",
        title: "New match for Friday",
        message: "Night Drive by Watch Artist fits your crate filters.",
        crateId: crate.id,
        read: false,
      });
    });

    it("ignores a track that fails the crate's filters", async () => {
      const { releaseId } = await seedRelease({ key: "m2", tempoBpm: 150 });
      await seedCrate({ userId: DJ });
      await expect(matcher.evaluateRelease(releaseId)).resolves.toMatchObject({ matched: 0 });
      expect(await matchesFor(DJ)).toHaveLength(0);
      expect(await notificationsFor(DJ)).toHaveLength(0);
    });

    it("never lets a track with no measured tempo satisfy a BPM filter", async () => {
      const { releaseId } = await seedRelease({ key: "m3", tempoBpm: null });
      await seedCrate({ userId: DJ });
      await matcher.evaluateRelease(releaseId);
      expect(await matchesFor(DJ)).toHaveLength(0);
    });

    it("ignores crates that are off, expired, draft or have no expiry", async () => {
      const { releaseId } = await seedRelease({ key: "m4" });
      await seedCrate({ userId: DJ, watchMode: "off", watchExpiresAt: null });
      await seedCrate({ userId: DJ, watchExpiresAt: new Date(Date.now() - 1000) });
      await seedCrate({ userId: DJ, status: "draft" });
      await seedCrate({ userId: DJ, watchExpiresAt: null });
      // The reserved mode is never treated as watching.
      await seedCrate({ userId: DJ, watchMode: "auto_buy" });
      await expect(matcher.evaluateRelease(releaseId)).resolves.toMatchObject({ matched: 0 });
      expect(await matchesFor(DJ)).toHaveLength(0);
      expect(await notificationsFor(DJ)).toHaveLength(0);
    });

    it("records a match once when the same release is announced twice", async () => {
      const { releaseId } = await seedRelease({ key: "m5" });
      await seedCrate({ userId: DJ });
      await matcher.evaluateRelease(releaseId);
      const again = await matcher.evaluateRelease(releaseId);
      expect(again).toMatchObject({ matched: 0, notified: 0 });
      // Two events at once: the queue runs them one after the other.
      await Promise.all([matcher.enqueueRelease(releaseId), matcher.enqueueRelease(releaseId)]);
      expect(await matchesFor(DJ)).toHaveLength(1);
      expect(await notificationsFor(DJ)).toHaveLength(1);
    });

    it("survives a concurrent duplicate insert (unique key)", async () => {
      const { releaseId, trackId } = await seedRelease({ key: "m5b" });
      const crate = await seedCrate({ userId: DJ });
      // Another process recorded it between our read and our insert.
      jest.spyOn(prisma.crateWatchMatch, "findMany").mockImplementationOnce((async () => {
        await prisma.crateWatchMatch.create({
          data: { crateId: crate.id, userId: DJ, trackId },
        });
        return [];
      }) as never);
      const run = await matcher.evaluateRelease(releaseId);
      expect(run).toMatchObject({ matched: 0, notified: 0 });
      expect(await matchesFor(DJ)).toHaveLength(1);
    });

    it("ignores the artist's own release in the artist's own crates", async () => {
      const { releaseId } = await seedRelease({ key: "m6" });
      await seedCrate({ userId: ARTIST_USER });
      await seedCrate({ userId: DJ });
      await matcher.evaluateRelease(releaseId);
      expect(await matchesFor(ARTIST_USER)).toHaveLength(0);
      expect(await notificationsFor(ARTIST_USER)).toHaveLength(0);
      expect(await matchesFor(DJ)).toHaveLength(1);
    });

    it("ignores a track already in the crate", async () => {
      const { releaseId, trackId } = await seedRelease({ key: "m7" });
      await seedCrate({ userId: DJ, items: [trackId] });
      await matcher.evaluateRelease(releaseId);
      expect(await matchesFor(DJ)).toHaveLength(0);
    });

    it("excludes a fully AI recording unless the crate allows it", async () => {
      const { releaseId } = await seedRelease({ key: "m8", aiDisclosureLevel: "ALL" });
      await seedCrate({ userId: DJ });
      await seedCrate({ userId: OTHER_DJ, filters: { allowFullyAi: true } });
      await matcher.evaluateRelease(releaseId);
      expect(await matchesFor(DJ)).toHaveLength(0);
      expect(await matchesFor(OTHER_DJ)).toHaveLength(1);
    });

    it("evaluates only publicly playable, fully processed tracks", async () => {
      await seedCrate({ userId: DJ });
      const cases: SeedRelease[] = [
        { key: "p1", releaseStatus: "withdrawn" },
        { key: "p2", releaseStatus: "processing" },
        { key: "p3", processingStatus: "separating" },
        { key: "p4", contentStatus: "quarantined" },
        { key: "p5", contentStatus: "dmca_removed" },
      ];
      for (const spec of cases) {
        const { releaseId } = await seedRelease(spec);
        await expect(matcher.evaluateRelease(releaseId)).resolves.toMatchObject({
          tracksEvaluated: 0,
          matched: 0,
        });
      }
      expect(await matchesFor(DJ)).toHaveLength(0);
    });

    it("keeps other users' crates unaffected", async () => {
      const { releaseId, trackId } = await seedRelease({ key: "m9" });
      const mine = await seedCrate({ userId: DJ });
      const theirsFits = await seedCrate({ userId: OTHER_DJ });
      const theirsMisses = await seedCrate({
        userId: CAPPED_DJ,
        filters: { bpm: { min: 170, max: 180 } },
      });
      await matcher.evaluateRelease(releaseId);

      expect((await matchesFor(DJ)).map((m) => m.crateId)).toEqual([mine.id]);
      expect((await matchesFor(OTHER_DJ)).map((m) => m.crateId)).toEqual([theirsFits.id]);
      expect(await matchesFor(CAPPED_DJ)).toHaveLength(0);
      // Each match belongs to its own crate's owner and nobody else.
      const all = await prisma.crateWatchMatch.findMany({ where: { trackId } });
      for (const match of all) {
        const owner = await prisma.crate.findUniqueOrThrow({ where: { id: match.crateId } });
        expect(match.userId).toBe(owner.userId);
      }
      expect(theirsMisses.id).toBeDefined();
      expect(await notificationsFor(CAPPED_DJ)).toHaveLength(0);
    });

    it("records a match without a notification for a person with no inbox", async () => {
      const { releaseId } = await seedRelease({ key: "m10" });
      await seedCrate({ userId: NO_INBOX_DJ });
      const run = await matcher.evaluateRelease(releaseId);
      expect(run).toMatchObject({ matched: 1, notified: 0 });
      const matches = await matchesFor(NO_INBOX_DJ);
      expect(matches).toHaveLength(1);
      expect(matches[0].notifiedAt).toBeNull();
    });

    it("caps notifications at 20 per rolling 24 hours, still recording the rest", async () => {
      expect(CRATE_WATCH_NOTIFICATIONS_PER_DAY).toBe(20);
      const cap = CRATE_WATCH_NOTIFICATIONS_PER_DAY;
      for (let i = 0; i < cap + 1; i += 1) {
        await seedCrate({ userId: CAPPED_DJ, title: `Crate ${i}` });
      }
      const first = await seedRelease({ key: "r1" });
      const run = await matcher.evaluateRelease(first.releaseId);
      expect(run).toMatchObject({ matched: cap + 1, notified: cap });

      let matches = await matchesFor(CAPPED_DJ);
      expect(matches).toHaveLength(cap + 1);
      expect(matches.filter((m) => m.notifiedAt !== null)).toHaveLength(cap);
      expect(matches.filter((m) => m.notifiedAt === null)).toHaveLength(1);
      expect(await notificationsFor(CAPPED_DJ)).toHaveLength(cap);

      // Inside the window nothing more is sent, but matches keep being recorded.
      const second = await seedRelease({ key: "r2" });
      const again = await matcher.evaluateRelease(second.releaseId);
      expect(again).toMatchObject({ matched: cap + 1, notified: 0 });
      expect(await notificationsFor(CAPPED_DJ)).toHaveLength(cap);

      // Five notifications age out of the 24-hour window: five more may go.
      matches = await matchesFor(CAPPED_DJ);
      const aged = matches.filter((m) => m.notifiedAt !== null).slice(0, 5);
      await prisma.crateWatchMatch.updateMany({
        where: { id: { in: aged.map((m) => m.id) } },
        data: { notifiedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
      });
      const third = await seedRelease({ key: "r3" });
      const afterWindow = await matcher.evaluateRelease(third.releaseId);
      expect(afterWindow).toMatchObject({ matched: cap + 1, notified: 5 });
      expect(await notificationsFor(CAPPED_DJ)).toHaveLength(cap + 5);
    });

    it("evaluates at most 500 watching crates per track, oldest-updated first, and says so", async () => {
      expect(CRATE_WATCH_MAX_CRATES_PER_EVENT).toBe(500);
      const total = CRATE_WATCH_MAX_CRATES_PER_EVENT + 1;
      const filters = { ...defaultCrateFilters(), bpm: BPM_WINDOW };
      await prisma.crate.createMany({
        data: Array.from({ length: total }, (_, index) => ({
          userId: BOUND_DJ,
          title: `Bulk ${index}`,
          filters: filters as never,
          status: "saved",
          watchMode: "notify",
          watchExpiresAt: new Date(Date.now() + 30 * DAY),
          // Index 500 is the most recently updated: it is the one left out.
          updatedAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
        })),
      });
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const { releaseId } = await seedRelease({ key: "b1" });
      const run = await matcher.evaluateRelease(releaseId);
      expect(run.matched).toBe(CRATE_WATCH_MAX_CRATES_PER_EVENT);
      const left = await prisma.crate.findFirstOrThrow({
        where: { userId: BOUND_DJ, title: "Bulk 500" },
      });
      expect(await prisma.crateWatchMatch.count({ where: { crateId: left.id } })).toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("more than 500 watching crates"));
    });

    it("never throws into the publishing pipeline and logs no filter or user data", async () => {
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      jest.spyOn(prisma.track, "findMany").mockRejectedValueOnce(
        Object.assign(new Error("boom: bpm 120-130 for dj"), { code: "P1001" }),
      );
      await expect(matcher.enqueueRelease("rel-x")).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = String(warn.mock.calls[0][0]);
      expect(logged).toContain("rel-x");
      expect(logged).toContain("P1001");
      expect(logged).not.toContain("bpm");
      expect(logged).not.toContain("boom");
    });

    it("evaluates a release announced on the event bus", async () => {
      const { releaseId } = await seedRelease({ key: "e1" });
      await seedCrate({ userId: DJ });
      matcher.onModuleInit();
      try {
        eventBus.publish({
          eventName: "catalog.release_ready",
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          releaseId,
          artistId: ARTIST,
        });
        const deadline = Date.now() + 10_000;
        while ((await matchesFor(DJ)).length === 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(await matchesFor(DJ)).toHaveLength(1);
      } finally {
        matcher.onModuleDestroy();
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("PATCH and GET /crates/:id watch", () => {
    it("turns watching on for a saved crate with a 90-day default and off in one action", async () => {
      const crate = await seedCrate({ userId: DJ, watchMode: "off", watchExpiresAt: null });
      const on = await crates.updateCrate(DJ, crate.id, { watch: { mode: "notify" } });
      expect(on.crate.watch.mode).toBe("notify");
      const expires = new Date(on.crate.watch.expiresAt as string).getTime();
      expect(Math.abs(expires - (Date.now() + 90 * DAY))).toBeLessThan(60_000);
      expect(on.crate.watch.summary.matches).toBe(0);
      expect(on.crate.watch.recentMatches).toEqual([]);

      const custom = await crates.updateCrate(DJ, crate.id, {
        watch: { mode: "notify", expiresInDays: 7 },
      });
      const customExpires = new Date(custom.crate.watch.expiresAt as string).getTime();
      expect(Math.abs(customExpires - (Date.now() + 7 * DAY))).toBeLessThan(60_000);

      const off = await crates.updateCrate(DJ, crate.id, { watch: { mode: "off" } });
      expect(off.crate.watch).toMatchObject({ mode: "off", expiresAt: null });
      const stored = await prisma.crate.findUniqueOrThrow({ where: { id: crate.id } });
      expect(stored).toMatchObject({ watchMode: "off", watchExpiresAt: null });
    });

    it("saves and watches in one request, but refuses to watch a draft", async () => {
      const draft = await seedCrate({
        userId: DJ,
        status: "draft",
        watchMode: "off",
        watchExpiresAt: null,
      });
      await expect(
        crates.updateCrate(DJ, draft.id, { watch: { mode: "notify" } }),
      ).rejects.toMatchObject({
        response: { code: "crate_not_saved" },
        status: 409,
      });
      await expect(
        crates.updateCrate(DJ, draft.id, { status: "draft", watch: { mode: "notify" } }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await prisma.crate.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
        watchMode: "off",
      });

      const both = await crates.updateCrate(DJ, draft.id, {
        status: "saved",
        watch: { mode: "notify", expiresInDays: 30 },
      });
      expect(both.crate.status).toBe("saved");
      expect(both.crate.watch.mode).toBe("notify");
    });

    it("always allows turning watching off, even on a draft", async () => {
      const draft = await seedCrate({ userId: DJ, status: "draft" });
      const off = await crates.updateCrate(DJ, draft.id, { watch: { mode: "off" } });
      expect(off.crate.watch).toMatchObject({ mode: "off", expiresAt: null });
    });

    it("rejects an invalid watch with fixed codes and changes nothing", async () => {
      const crate = await seedCrate({ userId: DJ, watchMode: "off", watchExpiresAt: null });
      const cases: Array<[unknown, string]> = [
        [{ mode: "auto_buy" }, "watch_mode_unavailable"],
        [{ mode: "auto_buy", expiresInDays: 30 }, "watch_mode_unavailable"],
        [{ mode: "email" }, "invalid_watch_mode"],
        [{ mode: "notify", expiresInDays: 0 }, "invalid_watch_expiry"],
        [{ mode: "notify", expiresInDays: 366 }, "invalid_watch_expiry"],
        [{ mode: "notify", expiresInDays: 2.5 }, "invalid_watch_expiry"],
        ["notify", "invalid_watch"],
      ];
      for (const [watch, code] of cases) {
        const failure = await crates
          .updateCrate(DJ, crate.id, { watch: watch as never })
          .catch((error) => error);
        expect(failure).toBeInstanceOf(BadRequestException);
        expect(failure.getResponse().code).toBe(code);
        expect(JSON.stringify(failure.getResponse())).not.toContain("email");
      }
      expect(await prisma.crate.findUniqueOrThrow({ where: { id: crate.id } })).toMatchObject({
        watchMode: "off",
        watchExpiresAt: null,
      });
    });

    it("is a 404 for someone else's crate", async () => {
      const crate = await seedCrate({ userId: OTHER_DJ });
      await expect(
        crates.updateCrate(DJ, crate.id, { watch: { mode: "off" } }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(crates.getCrate(DJ, crate.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("reports a draft crate and an expired watch as off", async () => {
      const draft = await seedCrate({ userId: DJ, status: "draft" });
      expect((await crates.getCrate(DJ, draft.id)).crate.watch.mode).toBe("off");

      const endedAt = new Date(Date.now() - DAY);
      const expired = await seedCrate({ userId: DJ, watchExpiresAt: endedAt });
      const read = (await crates.getCrate(DJ, expired.id)).crate.watch;
      expect(read.mode).toBe("off");
      expect(read.expiresAt).toBe(endedAt.toISOString());
    });

    it("summarises this month and lists the newest playable matches, at most 20", async () => {
      const crate = await seedCrate({ userId: DJ });
      const now = new Date();
      const total = CRATE_WATCH_RECENT_MATCHES_LIMIT + 3;
      const trackIds: string[] = [];
      for (let i = 0; i < total; i += 1) {
        const { trackId } = await seedRelease({ key: `s${i}`, title: `Match ${i}` });
        trackIds.push(trackId);
      }
      // A withdrawn release's match still counts but is not listed.
      const withdrawn = await seedRelease({ key: "sw", releaseStatus: "withdrawn", title: "Gone" });

      await prisma.crateWatchMatch.createMany({
        data: [
          ...trackIds.map((trackId, index) => ({
            crateId: crate.id,
            userId: DJ,
            trackId,
            // Newest last: index total-1 is the newest.
            matchedAt: new Date(now.getTime() - (total - index) * 1000),
            notifiedAt: index % 2 === 0 ? new Date(now.getTime() - 1000) : null,
          })),
          {
            crateId: crate.id,
            userId: DJ,
            trackId: withdrawn.trackId,
            matchedAt: new Date(now.getTime() - 500),
            notifiedAt: null,
          },
          // A match from another month is not in this month's summary.
          {
            crateId: crate.id,
            userId: DJ,
            trackId: id("long_gone"),
            matchedAt: new Date(Date.UTC(2020, 0, 15)),
            notifiedAt: new Date(Date.UTC(2020, 0, 15)),
          },
        ],
      });

      const { watch } = (await crates.getCrate(DJ, crate.id)).crate;
      expect(watch.summary.month).toBe(now.toISOString().slice(0, 7));
      expect(watch.summary.matches).toBe(total + 1);
      expect(watch.summary.notified).toBe(Math.ceil(total / 2));
      expect(watch.recentMatches).toHaveLength(CRATE_WATCH_RECENT_MATCHES_LIMIT);
      expect(watch.recentMatches[0]).toMatchObject({
        trackId: trackIds[total - 1],
        releaseId: id(`s${total - 1}_release`),
        title: `Match ${total - 1}`,
        artistName: "Watch Artist",
      });
      const times = watch.recentMatches.map((match) => match.matchedAt);
      expect([...times].sort().reverse()).toEqual(times);
      expect(watch.recentMatches.some((match) => match.trackId === withdrawn.trackId)).toBe(false);
      expect(watch.recentMatches.some((match) => match.trackId === id("long_gone"))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("the resolver is asked for every gated feature (#1966)", () => {
    const denied = {
      allowed: false,
      reason: "subscription_required",
      policyVersion: "crate-pro-policy/v2",
    };

    it("refuses turning watching on when the policy denies, never touching existing data", async () => {
      const crate = await seedCrate({ userId: DJ, watchMode: "off", watchExpiresAt: null });
      const trackId = (await seedRelease({ key: "d1" })).trackId;
      await prisma.crateWatchMatch.create({ data: { crateId: crate.id, userId: DJ, trackId } });

      const spy = jest.spyOn(CrateEntitlementsService.prototype, "watch").mockResolvedValue(denied);
      await expect(
        crates.updateCrate(DJ, crate.id, { watch: { mode: "notify" } }),
      ).rejects.toMatchObject({ response: { code: "pro_required" }, status: 403 });
      expect(spy).toHaveBeenCalledWith(DJ);
      expect(
        await prisma.crate.findUniqueOrThrow({ where: { id: crate.id } }),
      ).toMatchObject({ watchMode: "off" });

      // Off stays allowed, the recorded matches stay readable, and the DTO
      // carries the denied decision for the client.
      const read = await crates.updateCrate(DJ, crate.id, { watch: { mode: "off" } });
      expect(read.crate.entitlements.watch).toEqual(denied);
      expect(read.crate.watch.summary.matches).toBe(1);
      expect(await prisma.crateWatchMatch.count({ where: { crateId: crate.id } })).toBe(1);
    });

    it("refuses saving a crate beyond the free number when the policy denies", async () => {
      for (let i = 0; i < CRATE_FREE_SAVED_CRATES; i += 1) {
        await seedCrate({ userId: DJ, title: `Saved ${i}`, watchMode: "off", watchExpiresAt: null });
      }
      const fourth = await seedCrate({
        userId: DJ,
        status: "draft",
        watchMode: "off",
        watchExpiresAt: null,
      });
      jest.spyOn(CrateEntitlementsService.prototype, "pro").mockResolvedValue(denied);
      await expect(
        crates.updateCrate(DJ, fourth.id, { status: "saved" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // The three crates already saved stay readable.
      const stored = await prisma.crate.count({ where: { userId: DJ, status: "saved" } });
      expect(stored).toBe(CRATE_FREE_SAVED_CRATES);
      const read = await crates.getCrate(DJ, fourth.id);
      expect(read.crate.entitlements.pro).toEqual(denied);
    });

    it("exposes pro, export and watch decisions on the crate", async () => {
      const crate = await seedCrate({ userId: DJ });
      const { entitlements: seen } = (await crates.getCrate(DJ, crate.id)).crate;
      expect(Object.keys(seen).sort()).toEqual(["export", "pro", "watch"]);
      for (const decision of Object.values(seen)) {
        expect(decision).toMatchObject({ allowed: true, reason: "free_for_everyone" });
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("erasure", () => {
    it("removes the matches of the erased person and leaves the others", async () => {
      const { releaseId } = await seedRelease({ key: "x1" });
      await seedCrate({ userId: DJ });
      await seedCrate({ userId: OTHER_DJ });
      await matcher.evaluateRelease(releaseId);
      expect(await matchesFor(DJ)).toHaveLength(1);
      expect(await matchesFor(OTHER_DJ)).toHaveLength(1);

      const erasure = new PersonalDataErasureService(
        new PersonalDataResolverService(),
        new AnalyticsGovernanceService(),
        new AccountClosureService(),
      );
      const summary = await erasure.eraseAccount(DJ);
      expect(summary.status).toBe("erased");

      // The id rotates on erasure, so look the rows up by track, not by user:
      // only the other person's match is left for this track.
      const left = await prisma.crateWatchMatch.findMany({ where: { trackId: id("x1") } });
      expect(left.map((match) => match.userId)).toEqual([OTHER_DJ]);
    });
  });
});
