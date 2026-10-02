/**
 * AI DJ session picks — Integration Test (Testcontainers) (#2036)
 *
 * Session start and agentNext record the DJ's picks as License rows (the pick
 * log, never a purchase): priced 0, with no taste signal until the listener
 * acts. The preset's genres survive the learned-genre merge and a session never
 * writes AgentConfig.vibes.
 *
 * Run: npm run test:integration
 */

import { prisma } from "../db/prisma";
import { AgentConfigController } from "../modules/agents/agent_config.controller";
import { AgentLearningService } from "../modules/agents/agent_learning.service";
import { defaultCrateFilters } from "../modules/crates/crate_filters";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `agpick_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;
const TRACK_ID = `${TEST_PREFIX}track`;

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("AI DJ session picks (integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_ID, email: `${TEST_PREFIX}@test.resonate` } });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: USER_ID,
        displayName: "Pick Artist",
        payoutAddress: `0x${"c".repeat(40)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: `${TEST_PREFIX}artist`,
        title: "Pick Release",
        genre: "Industrial",
        status: "published",
      },
    });
    await prisma.track.create({
      data: { id: TRACK_ID, releaseId: `${TEST_PREFIX}release`, title: "Pick Track", position: 1 },
    });
    await prisma.agentConfig.create({
      data: { userId: USER_ID, name: "Pick DJ", vibes: ["Focus"], monthlyCapUsd: 10 },
    });
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.license.deleteMany({ where: { trackId: TRACK_ID } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.agentConfig.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: TRACK_ID } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: USER_ID } }).catch(() => {});
  });

  function makeController(runResult: unknown, parser?: { parse: jest.Mock }) {
    const runtimeService = { run: jest.fn().mockResolvedValue(runResult) };
    const learningService = new AgentLearningService();
    const recordSignal = jest.spyOn(learningService, "recordSignal");
    const controller = new AgentConfigController(
      {} as any,
      runtimeService as any,
      {} as any,
      learningService,
      new EventBus(),
      parser as any,
    );
    return { controller, runtimeService, recordSignal };
  }

  describe("session start", () => {
    it("records the pick with priceUsd 0, no AgentSignal, and leaves AgentConfig.vibes unchanged", async () => {
      const { controller, runtimeService, recordSignal } = makeController({
        status: "approved",
        tracks: [
          {
            trackId: TRACK_ID,
            mixPlan: {},
            pick: { licenseType: "personal", priceUsd: 0, reason: "selected" },
          },
        ],
        shortfall: 4,
      });

      const started = (await controller.startSession(
        { user: { userId: USER_ID } },
        { preferences: { genres: ["Dark", "Industrial"] } },
      )) as { status: string; sessionId: string };
      expect(started.status).toBe("started");

      const license = await waitFor(() =>
        prisma.license.findFirst({ where: { sessionId: started.sessionId, trackId: TRACK_ID } }),
      );
      expect(license).toMatchObject({ priceUsd: 0, durationSeconds: 0 });

      expect(recordSignal).not.toHaveBeenCalled();
      expect(await prisma.agentSignal.count({ where: { userId: USER_ID } })).toBe(0);

      // The preset's genres survive the learned-genre merge, after saved vibes.
      const input = runtimeService.run.mock.calls[0][0];
      expect(input.preferences.genres).toEqual(expect.arrayContaining(["Focus", "Dark", "Industrial"]));
      expect(input.preferences.genres.indexOf("Focus")).toBeLessThan(input.preferences.genres.indexOf("Dark"));

      // A session never writes the saved vibes.
      const config = await prisma.agentConfig.findUnique({ where: { userId: USER_ID } });
      expect(config?.vibes).toEqual(["Focus"]);
    });

    it("records LLM picks priced 0 too", async () => {
      const { controller, recordSignal } = makeController({
        status: "approved",
        reason: "vertex_llm",
        latencyMs: 5,
        picks: [{ trackId: TRACK_ID, licenseType: "remix", priceUsd: 3 }],
      });

      const started = (await controller.startSession({ user: { userId: USER_ID } }, {})) as {
        sessionId: string;
      };

      const license = await waitFor(() =>
        prisma.license.findFirst({ where: { sessionId: started.sessionId, trackId: TRACK_ID } }),
      );
      expect(license).toMatchObject({ priceUsd: 0, durationSeconds: 0 });
      expect(recordSignal).not.toHaveBeenCalled();
      expect(await prisma.agentSignal.count({ where: { userId: USER_ID } })).toBe(0);
    });
  });

  describe("a described session (#2037)", () => {
    const SENTENCE = "dark deep house for a late-night drive, 120-125 bpm";

    async function rowCounts() {
      return {
        sessions: await prisma.session.count({ where: { userId: USER_ID } }),
        licenses: await prisma.license.count({ where: { trackId: TRACK_ID } }),
        signals: await prisma.agentSignal.count({ where: { userId: USER_ID } }),
      };
    }

    it("parsing writes nothing: no Session, License or AgentSignal row, and AgentConfig.vibes unchanged", async () => {
      const parser = {
        parse: jest.fn().mockResolvedValue({
          filters: { ...defaultCrateFilters(), genres: ["Deep House"], bpm: { min: 120, max: 125 } },
          unparsed: [],
          strategy: "deterministic",
        }),
      };
      const { controller } = makeController({ status: "approved", tracks: [] }, parser);
      const before = await rowCounts();

      const parsed = await controller.parseSession({ text: SENTENCE });

      expect(parsed.request).toEqual({
        genres: ["Deep House"],
        moods: [],
        energy: null,
        bpm: { min: 120, max: 125 },
      });
      expect(await rowCounts()).toEqual(before);
      const config = await prisma.agentConfig.findUnique({ where: { userId: USER_ID } });
      expect(config?.vibes).toEqual(["Focus"]);
    });

    it("starts a session from a request without touching AgentConfig.vibes and keeps the sentence out of every row", async () => {
      const { controller, runtimeService, recordSignal } = makeController({
        status: "approved",
        tracks: [
          {
            trackId: TRACK_ID,
            mixPlan: {},
            pick: { licenseType: "personal", priceUsd: 0, reason: "selected" },
          },
        ],
        shortfall: 4,
        requestCoverage: { picks: 1, gaps: [{ filter: "bpm", matched: 0 }] },
      });
      const request = { genres: ["Deep House"], moods: ["Dark"], energy: "high", bpm: { min: 120, max: 125 } };

      const started = (await controller.startSession(
        { user: { userId: USER_ID } },
        { preferences: { request } },
      )) as { sessionId: string };

      await waitFor(() =>
        prisma.license.findFirst({ where: { sessionId: started.sessionId, trackId: TRACK_ID } }),
      );
      const input = runtimeService.run.mock.calls[0][0];
      expect(input.preferences.genres).toEqual(expect.arrayContaining(["Focus", "Deep House"]));
      expect(input.preferences.mood).toBe("Dark");
      expect(input.preferences.tempoBpm).toEqual({ min: 120, max: 125 });
      expect(input.preferences.request).toEqual(request);

      const config = await prisma.agentConfig.findUnique({ where: { userId: USER_ID } });
      expect(config?.vibes).toEqual(["Focus"]);
      expect(recordSignal).not.toHaveBeenCalled();
      expect(await prisma.agentSignal.count({ where: { userId: USER_ID } })).toBe(0);

      // Only filters ever reach the server's rows; the sentence never does.
      const rows = JSON.stringify({
        sessions: await prisma.session.findMany({ where: { userId: USER_ID } }),
        licenses: await prisma.license.findMany({ where: { trackId: TRACK_ID } }),
        config,
      });
      expect(rows).not.toContain("late-night");
      expect(rows).not.toContain(SENTENCE);
    });
  });
});
