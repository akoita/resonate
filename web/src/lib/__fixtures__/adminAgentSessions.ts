import type { AdminAgentSessionEvent, AdminAgentSessionEvents } from "../api";

export function agentEvent(overrides: Partial<AdminAgentSessionEvent> = {}): AdminAgentSessionEvent {
  return {
    id: "evt-1",
    eventName: "agent.decision_made",
    occurredAt: "2026-10-24T12:00:01.000Z",
    producer: "agent-runtime",
    ...overrides,
  };
}

export function sessionEvents(overrides: Partial<AdminAgentSessionEvents> = {}): AdminAgentSessionEvents {
  const events = [
    agentEvent({
      id: "evt-selection",
      eventName: "agent.selection",
      occurredAt: "2026-10-24T12:00:00.000Z",
      trackId: "track-a",
      strategy: "hybrid_rrf_v1",
      candidateCount: 40,
      count: 12,
    }),
    agentEvent({
      id: "evt-pick-0",
      trackId: "track-a",
      artistId: "artist-a",
      reason: "llm",
      curatedBy: "llm",
      licenseType: "personal",
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
    }),
    agentEvent({
      id: "evt-pick-1",
      occurredAt: "2026-10-24T12:00:02.000Z",
      trackId: "track-b",
      reason: "llm",
      curatedBy: "llm",
      pickIndex: 1,
      pickCount: 12,
    }),
    agentEvent({
      id: "evt-rules",
      occurredAt: "2026-10-24T12:00:03.000Z",
      reason: "no_tracks",
      curatedBy: "rules",
      shortfall: 5,
      unmetIntent: ["genres", "energy"],
      runtimeFallback: { from: "adk", reason: "timeout" },
      redactedFields: ["strategy"],
    }),
  ];
  return {
    sessionId: "session-1",
    userId: "11111111-aaaa-bbbb-cccc-000000000001",
    startedAt: "2026-10-24T11:59:00.000Z",
    endedAt: null,
    events,
    eventCount: events.length,
    truncated: false,
    retentionDays: 730,
    ...overrides,
  };
}
