/**
 * Operator view of a session's raw agent events (#2259) against real Postgres.
 *
 * The events are written the way production writes them: published on the event
 * bus and recorded by the analytics bridge into the real `AnalyticsEvent`
 * table, so the spec also pins what the bridge keeps (coverage counts, no
 * reasoning, no summary text). A second group inserts rows directly with
 * hostile payloads to prove the view whitelists whatever is stored.
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AnalyticsDomainEventBridgeService } from "../modules/analytics/analytics_domain_event_bridge.service";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { PrismaAnalyticsEventStore } from "../modules/analytics/analytics_event_store";
import { EventBus } from "../modules/shared/event_bus";
import {
  AdminAgentSessionsService,
  AGENT_SESSION_EVENTS_LIMIT,
} from "../modules/admin_agent_sessions/admin_agent_sessions.service";

const TEST_PREFIX = `agent_events_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;
const ADMIN_ID = `${TEST_PREFIX}admin`;
const SESSION_ID = `${TEST_PREFIX}session`;
const ORPHAN_SESSION_ID = `${TEST_PREFIX}orphan`;
const HOSTILE_SESSION_ID = `${TEST_PREFIX}hostile`;
const EMPTY_SESSION_ID = `${TEST_PREFIX}empty`;
const OTHER_SESSION_ID = `${TEST_PREFIX}other`;
const SESSION_IDS = [SESSION_ID, ORPHAN_SESSION_ID, HOSTILE_SESSION_ID, EMPTY_SESSION_ID, OTHER_SESSION_ID];

const TYPED_SENTENCE = "something sad for a rainy Sunday with my ex";
const track = (n: number) => `${TEST_PREFIX}track${String(n).padStart(2, "0")}`;
const T0 = Date.parse("2026-10-24T12:00:00.000Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

describe("AdminAgentSessionsService (integration)", () => {
  const service = new AdminAgentSessionsService(new AnalyticsGovernanceService());
  const eventBus = new EventBus();
  const bridge = new AnalyticsDomainEventBridgeService(
    eventBus,
    new AnalyticsIngestService(new PrismaAnalyticsEventStore()),
  );

  const sessionEvents = (sessionId: string) =>
    prisma.analyticsEvent.findMany({ where: { sessionId }, orderBy: { occurredAt: "asc" } });
  const publishedCount = () => prisma.analyticsEvent.count({ where: { sessionId: { in: SESSION_IDS } } });
  const auditFor = (sessionId: string) =>
    prisma.adminAuditEvent.findMany({
      where: { actorUserId: ADMIN_ID, action: "agent_session.events_viewed", detail: { path: ["sessionId"], equals: sessionId } },
    });

  async function waitForEvents(sessionId: string, expected: number) {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const found = await prisma.analyticsEvent.count({ where: { sessionId } });
      if (found >= expected) return;
      if (Date.now() > deadline) throw new Error(`Only ${found} of ${expected} events reached analytics for ${sessionId}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_ID, email: `${USER_ID}@test.resonate` } });
    await prisma.session.create({ data: { id: SESSION_ID, userId: USER_ID, budgetCapUsd: 0 } });
    bridge.onModuleInit();

    // A 12-pick LLM batch exactly as the session start publishes it: published out
    // of order on purpose, batch fields (reasoning, coverage) on pickIndex 0.
    const picks = Array.from({ length: 12 }, (_, index) => index);
    const batchFields = {
      reasoning: TYPED_SENTENCE,
      latencyMs: 1200,
      coverage: {
        picks: 12,
        gaps: [{ filter: "genres", matched: 9 }],
        heldBack: { variety: 2, explicit: 0 },
        capRelaxed: { artists: 1, top: { artist: "Private Artist Name", tracks: 4 } },
        shortfallReason: "catalog_short",
        note: TYPED_SENTENCE,
      },
      coverageSummary: `not matched: ${TYPED_SENTENCE} (9 of 12)`,
    };
    for (const index of [...picks].reverse()) {
      eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: at(1000),
        sessionId: SESSION_ID,
        trackId: track(index),
        licenseType: "personal",
        reason: "llm",
        curatedBy: "llm",
        pickIndex: index,
        pickCount: 12,
        ...(index === 0 ? batchFields : {}),
      } as any);
    }
    eventBus.publish({
      eventName: "agent.selection",
      eventVersion: 1,
      occurredAt: at(0),
      sessionId: SESSION_ID,
      trackId: track(0),
      candidates: [track(0), track(1), track(2)],
      count: 3,
      strategy: "hybrid_rrf_v1",
    } as any);
    eventBus.publish({
      eventName: "agent.mix_planned",
      eventVersion: 1,
      occurredAt: at(2000),
      sessionId: SESSION_ID,
      trackId: track(0),
      trackTitle: "A Private Title",
      transition: "crossfade",
    } as any);
    // A rules decision with a shortfall and a runtime fallback.
    eventBus.publish({
      eventName: "agent.decision_made",
      eventVersion: 1,
      occurredAt: at(3000),
      sessionId: SESSION_ID,
      trackCount: 0,
      reason: "no_tracks",
      curatedBy: "rules",
      shortfall: 5,
      unmetIntent: { genres: ["Drill"], mood: TYPED_SENTENCE, energy: "high" },
      runtimeFallback: { from: "adk", reason: "timeout" },
    } as any);
    // Another session and a non-agent event must stay out.
    eventBus.publish({
      eventName: "agent.selection",
      eventVersion: 1,
      occurredAt: at(0),
      sessionId: OTHER_SESSION_ID,
      trackId: track(99),
      candidates: [track(99)],
      count: 1,
      strategy: "recent-first",
    } as any);
    await waitForEvents(SESSION_ID, 12 + 3);
    await waitForEvents(OTHER_SESSION_ID, 1);

    await prisma.analyticsEvent.create({
      data: {
        eventId: `${TEST_PREFIX}non_agent`,
        eventName: "playback.started",
        eventVersion: 1,
        occurredAt: new Date(T0),
        receivedAt: new Date(T0),
        producer: "test",
        environment: "test",
        privacyTier: "pseudonymous",
        sessionId: SESSION_ID,
        payload: { trackId: track(0) },
        envelope: {},
      },
    });

    // Rows with payloads a faulty or hostile emitter could have stored.
    const hostile = (suffix: string, occurredOffset: number, eventName: string, payload: Record<string, unknown>) =>
      prisma.analyticsEvent.create({
        data: {
          eventId: `${TEST_PREFIX}hostile_${suffix}`,
          eventName,
          eventVersion: 1,
          occurredAt: new Date(T0 + occurredOffset),
          receivedAt: new Date(T0),
          producer: "agent-runtime",
          environment: "test",
          privacyTier: "pseudonymous",
          sessionId: HOSTILE_SESSION_ID,
          payload: payload as any,
          envelope: {},
        },
      });
    await hostile("a", 0, "agent.decision_made", {
      trackId: track(1),
      reason: TYPED_SENTENCE,
      strategy: "Sad Rainy Mood Mix",
      reasoning: TYPED_SENTENCE,
      coverageSummary: TYPED_SENTENCE,
      prompt: TYPED_SENTENCE,
      note: TYPED_SENTENCE,
      error: TYPED_SENTENCE,
      userId: USER_ID,
      walletAddress: "0xabc",
      trackTitle: "A Private Title",
      preferences: { mood: TYPED_SENTENCE },
      pickIndex: 0,
      coverage: {
        picks: 4,
        gaps: [
          { filter: "genres", matched: 1 },
          { filter: TYPED_SENTENCE, matched: 2 },
        ],
        summary: TYPED_SENTENCE,
      },
      unmetIntent: { genres: [TYPED_SENTENCE], free: TYPED_SENTENCE },
      runtimeFallback: { from: TYPED_SENTENCE, reason: "timeout" },
    });
    await hostile("b", 10, "agent.something_new", { reasoning: TYPED_SENTENCE, trackId: `${TYPED_SENTENCE}` });
    await prisma.analyticsEvent.createMany({
      data: Array.from({ length: AGENT_SESSION_EVENTS_LIMIT + 3 }, (_, index) => ({
        eventId: `${TEST_PREFIX}many_${index}`,
        eventName: "agent.selection",
        eventVersion: 1,
        occurredAt: new Date(T0 + index),
        receivedAt: new Date(T0),
        producer: "agent-runtime",
        environment: "test",
        privacyTier: "pseudonymous",
        sessionId: ORPHAN_SESSION_ID,
        payload: { strategy: "recent-first", count: index },
        envelope: {},
      })),
    });
  }, 60_000);

  afterAll(async () => {
    bridge.onModuleDestroy();
    await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: ADMIN_ID } });
    await prisma.analyticsEvent.deleteMany({
      where: { OR: [{ sessionId: { in: SESSION_IDS } }, { eventId: { startsWith: TEST_PREFIX } }] },
    });
    await prisma.session.deleteMany({ where: { id: SESSION_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.$disconnect();
  });

  it("returns the session's agent events oldest first, picks in order", async () => {
    const view = await service.events(ADMIN_ID, SESSION_ID);

    expect(view.sessionId).toBe(SESSION_ID);
    expect(view.userId).toBe(USER_ID);
    expect(view.truncated).toBe(false);
    expect(view.eventCount).toBe(view.events.length);
    expect(view.events).toHaveLength(15);
    expect(view.events.map((event) => event.eventName)).toEqual([
      "agent.selection",
      ...Array(12).fill("agent.decision_made"),
      "agent.mix_planned",
      "agent.decision_made",
    ]);
    const picks = view.events.slice(1, 13);
    expect(picks.map((event) => event.pickIndex)).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(picks.map((event) => event.trackId)).toEqual(Array.from({ length: 12 }, (_, index) => track(index)));
    const times = view.events.map((event) => Date.parse(event.occurredAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("leaves out other sessions and events that are not agent events", async () => {
    const view = await service.events(ADMIN_ID, SESSION_ID);
    expect(view.events.some((event) => event.eventName === "playback.started")).toBe(false);
    expect(view.events.some((event) => event.trackId === track(99))).toBe(false);
  });

  it("shows decisions, coverage and reason codes", async () => {
    const view = await service.events(ADMIN_ID, SESSION_ID);
    const [selection, first] = view.events;
    expect(selection).toMatchObject({ strategy: "hybrid_rrf_v1", candidateCount: 3, count: 3 });
    expect(first).toMatchObject({
      trackId: track(0),
      licenseType: "personal",
      reason: "llm",
      curatedBy: "llm",
      pickIndex: 0,
      pickCount: 12,
      latencyMs: 1200,
      coverage: {
        picks: 12,
        gaps: [{ filter: "genres", matched: 9 }],
        heldBack: { variety: 2, explicit: 0 },
        capRelaxed: { artists: 1 },
        shortfallReason: "catalog_short",
      },
    });
    const rules = view.events[view.events.length - 1];
    expect(rules).toMatchObject({
      reason: "no_tracks",
      curatedBy: "rules",
      shortfall: 5,
      trackCount: 0,
      runtimeFallback: { from: "adk", reason: "timeout" },
      unmetIntent: ["genres", "mood", "energy"],
    });
    expect(view.events[13]).toMatchObject({ eventName: "agent.mix_planned", transition: "crossfade" });
  });

  it("never carries typed text, titles, reasoning, summaries or other people's identifiers", async () => {
    const view = await service.events(ADMIN_ID, SESSION_ID);
    const text = JSON.stringify(view);
    expect(text).not.toContain(TYPED_SENTENCE);
    expect(text).not.toContain("A Private Title");
    expect(text).not.toContain("Private Artist Name");
    expect(text).not.toContain("Drill");
    expect(text).not.toContain("reasoning");
    expect(text).not.toContain("coverageSummary");
    // The bridge no longer records the LLM reasoning, the pre-rendered coverage
    // summary or the artist named in a relaxed cap. (It has always recorded the
    // unmet-intent values and the mix-planned title, which this view never shows.)
    const stored = JSON.stringify((await sessionEvents(SESSION_ID)).map((row) => row.payload));
    expect(stored).not.toContain("reasoning");
    expect(stored).not.toContain("coverageSummary");
    expect(stored).not.toContain("Private Artist Name");
    expect(stored).not.toContain("something sad for a rainy Sunday with my ex (9 of 12)");
  });

  it("whitelists whatever a stored payload holds, even if free text is present", async () => {
    const view = await service.events(ADMIN_ID, HOSTILE_SESSION_ID);
    expect(view.userId).toBeNull();
    const text = JSON.stringify(view);
    expect(text).not.toContain(TYPED_SENTENCE);
    expect(text).not.toContain("Sad Rainy");
    expect(text).not.toContain("A Private Title");
    expect(text).not.toContain("0xabc");
    expect(text).not.toContain(USER_ID);
    for (const key of ["reasoning", "coverageSummary", "prompt", "note", "error", "walletAddress", "preferences", "trackTitle", "summary", "free"]) {
      expect(text).not.toContain(`"${key}"`);
    }
    expect(view.events[0]).toEqual({
      id: `${TEST_PREFIX}hostile_a`,
      eventName: "agent.decision_made",
      occurredAt: at(0),
      producer: "agent-runtime",
      trackId: track(1),
      pickIndex: 0,
      coverage: { picks: 4, gaps: [{ filter: "genres", matched: 1 }] },
      unmetIntent: ["genres"],
      redactedFields: ["reason", "strategy"],
    });
    expect(view.events[1]).toEqual({
      id: `${TEST_PREFIX}hostile_b`,
      eventName: "agent.something_new",
      occurredAt: at(10),
      producer: "agent-runtime",
      redactedFields: ["trackId"],
    });
  });

  it("writes one audit event per read, naming the admin and the session owner, with no payload", async () => {
    const before = (await auditFor(SESSION_ID)).length;
    await service.events(ADMIN_ID, SESSION_ID);
    await service.events(ADMIN_ID, SESSION_ID);
    const audits = await auditFor(SESSION_ID);
    expect(audits).toHaveLength(before + 2);
    for (const audit of audits) {
      expect(audit).toMatchObject({
        actorUserId: ADMIN_ID,
        action: "agent_session.events_viewed",
        targetUserId: USER_ID,
        detail: { sessionId: SESSION_ID, eventCount: 15 },
      });
    }
  });

  it("does not return events when the audit event cannot be written", async () => {
    const spy = jest.spyOn(prisma.adminAuditEvent, "create").mockRejectedValueOnce(new Error("audit store down"));
    try {
      await expect(service.events(ADMIN_ID, SESSION_ID)).rejects.toThrow("audit store down");
    } finally {
      spy.mockRestore();
    }
  });

  it("still shows events whose session row is gone, and names no owner in the audit event", async () => {
    const view = await service.events(ADMIN_ID, HOSTILE_SESSION_ID);
    expect(view.userId).toBeNull();
    expect(view.startedAt).toBeNull();
    const audits = await auditFor(HOSTILE_SESSION_ID);
    expect(audits[0]).toMatchObject({ targetUserId: null, detail: { sessionId: HOSTILE_SESSION_ID, eventCount: 2 } });
  });

  it("caps the list and says so", async () => {
    const view = await service.events(ADMIN_ID, ORPHAN_SESSION_ID);
    expect(view.truncated).toBe(true);
    expect(view.events).toHaveLength(AGENT_SESSION_EVENTS_LIMIT);
    expect(view.events[0].count).toBe(0);
  });

  it("reports the analytics retention window", async () => {
    const view = await service.events(ADMIN_ID, SESSION_ID);
    expect(view.retentionDays).toBe(new AnalyticsGovernanceService().getRetentionPolicy().pseudonymousDays);
  });

  it("answers 404 without an audit event for an unknown session, and 400 for a malformed id", async () => {
    const before = await prisma.adminAuditEvent.count({ where: { actorUserId: ADMIN_ID } });
    await expect(service.events(ADMIN_ID, EMPTY_SESSION_ID)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.events(ADMIN_ID, "not a session id")).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.events(ADMIN_ID, "x".repeat(201))).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.adminAuditEvent.count({ where: { actorUserId: ADMIN_ID } })).toBe(before);
    expect(await publishedCount()).toBeGreaterThan(0);
  });
});
