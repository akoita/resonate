import { EventsGateway } from "./events.gateway";
import { EventBus } from "./event_bus";

describe("EventsGateway", () => {
  function createGateway() {
    const eventBus = new EventBus();
    const lyriaRealtime = {
      isAvailable: jest.fn().mockReturnValue(true),
      startSession: jest.fn().mockResolvedValue("rt_session"),
      getSessionState: jest.fn().mockReturnValue({
        controls: { bpm: 120, key: "C major", density: 50, brightness: 50 },
        isRecording: false,
        isActive: true,
      }),
      updateControls: jest.fn().mockResolvedValue(undefined),
      stopSession: jest.fn(),
      startRecording: jest.fn(),
      stopRecording: jest.fn().mockReturnValue(Buffer.from("RIFF")),
      stopSessionsForSocket: jest.fn(),
    } as any;
    const authService = {
      verifyAccessToken: jest.fn().mockReturnValue({ userId: "user-1" }),
    } as any;

    const gateway = new EventsGateway(eventBus, lyriaRealtime, authService);
    const emit = jest.fn();
    const roomEmit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit: roomEmit });

    gateway.server = {
      emit,
      to,
      sockets: { sockets: new Map() },
    } as any;

    return { gateway, eventBus, emit, to, roomEmit, lyriaRealtime, authService };
  }

  function createClient(id = "client-1", token = "token-1") {
    return {
      id,
      connected: true,
      handshake: { auth: { token } },
      emit: jest.fn(),
      on: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
    } as any;
  }

  it("broadcasts dispute status updates for filed, resolved, and appealed events", async () => {
    const { gateway, eventBus, emit } = createGateway();

    eventBus.publish({
      eventName: "contract.dispute_filed",
      eventVersion: 1,
      occurredAt: "2026-04-07T10:00:00.000Z",
      disputeId: "123",
      tokenId: "77",
      reporterAddress: "0xreporter",
      creatorAddress: "0xcreator",
      counterStake: "1000",
      evidenceURI: "ipfs://evidence",
      chainId: 31337,
      contractAddress: "0xcontract",
      transactionHash: "0xtx1",
      blockNumber: "1",
    });

    eventBus.publish({
      eventName: "contract.dispute_resolved",
      eventVersion: 1,
      occurredAt: "2026-04-07T10:01:00.000Z",
      disputeId: "123",
      tokenId: "77",
      outcome: "1",
      resolverAddress: "0xresolver",
      chainId: 31337,
      contractAddress: "0xcontract",
      transactionHash: "0xtx2",
      blockNumber: "2",
    });

    eventBus.publish({
      eventName: "contract.dispute_appealed",
      eventVersion: 1,
      occurredAt: "2026-04-07T10:02:00.000Z",
      disputeId: "123",
      appealerAddress: "0xreporter",
      appealNumber: "1",
      chainId: 31337,
      contractAddress: "0xcontract",
      transactionHash: "0xtx3",
      blockNumber: "3",
    });

    expect(emit).toHaveBeenCalledWith(
      "dispute.status",
      expect.objectContaining({
        type: "filed",
        disputeId: "123",
        tokenId: "77",
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      "dispute.status",
      expect.objectContaining({
        type: "resolved",
        disputeId: "123",
        outcome: "1",
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      "dispute.status",
      expect.objectContaining({
        type: "appealed",
        disputeId: "123",
        appealNumber: "1",
      }),
    );

    gateway.onModuleDestroy();
  });

  it("delivers notification.created events to the correct wallet room", () => {
    const { gateway, eventBus, to, roomEmit } = createGateway();

    eventBus.publish({
      eventName: "notification.created",
      eventVersion: 1,
      occurredAt: "2026-04-07T10:03:00.000Z",
      walletAddress: "0xabc",
      notificationId: "notif-1",
      type: "dispute_resolved",
      title: "Resolved",
      message: "Resolved",
      disputeId: "123",
      releaseId: "rel-1",
    });

    expect(to).toHaveBeenCalledWith("wallet:0xabc");
    expect(roomEmit).toHaveBeenCalledWith(
      "notification.new",
      expect.objectContaining({
        id: "notif-1",
        type: "dispute_resolved",
        disputeId: "123",
        releaseId: "rel-1",
      }),
    );

    gateway.onModuleDestroy();
  });

  it("delivers release rights request updates only to targeted wallet rooms", () => {
    const { gateway, eventBus, to, roomEmit } = createGateway();

    eventBus.publish({
      eventName: "release_rights.request_updated",
      eventVersion: 1,
      occurredAt: "2026-04-11T12:00:00.000Z",
      requestId: "rr-1",
      releaseId: "rel-1",
      status: "submitted",
      walletAddresses: ["0xabc", "0xdef"],
    });

    expect(to).toHaveBeenNthCalledWith(1, "wallet:0xabc");
    expect(to).toHaveBeenNthCalledWith(2, "wallet:0xdef");
    expect(roomEmit).toHaveBeenCalledWith(
      "release_rights.request_updated",
      expect.objectContaining({
        requestId: "rr-1",
        releaseId: "rel-1",
        status: "submitted",
      }),
    );

    gateway.onModuleDestroy();
  });

  it("joins and leaves wallet rooms on socket commands", () => {
    const { gateway } = createGateway();
    const client = {
      id: "client-1",
      on: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
    } as any;

    gateway.handleConnection(client);

    const joinHandler = client.on.mock.calls.find(([name]: [string]) => name === "wallet:join")?.[1];
    const leaveHandler = client.on.mock.calls.find(([name]: [string]) => name === "wallet:leave")?.[1];

    joinHandler("0xAbC");
    leaveHandler("0xAbC");

    expect(client.join).toHaveBeenCalledWith("wallet:0xabc");
    expect(client.leave).toHaveBeenCalledWith("wallet:0xabc");

    gateway.onModuleDestroy();
  });

  it("rejects realtime start when auth is missing or invalid", async () => {
    const { gateway, authService, lyriaRealtime } = createGateway();
    const client = createClient();
    authService.verifyAccessToken.mockReturnValue(null);

    await gateway.handleRealtimeStart(client, { trackId: "track-1" });

    expect(client.emit).toHaveBeenCalledWith("realtime:error", {
      code: "AUTH_REQUIRED",
      message: "Authentication required",
    });
    expect(lyriaRealtime.startSession).not.toHaveBeenCalled();
    gateway.onModuleDestroy();
  });

  it("fails realtime operations closed when a non-HTTP runtime omits auth wiring", async () => {
    const eventBus = new EventBus();
    const lyriaRealtime = {
      isAvailable: jest.fn().mockReturnValue(true),
      startSession: jest.fn(),
    } as any;
    const gateway = new EventsGateway(eventBus, lyriaRealtime);
    const client = createClient();

    await gateway.handleRealtimeStart(client, { trackId: "track-1" });

    expect(client.emit).toHaveBeenCalledWith("realtime:error", {
      code: "AUTH_REQUIRED",
      message: "Authentication required",
    });
    expect(lyriaRealtime.startSession).not.toHaveBeenCalled();
    gateway.onModuleDestroy();
  });

  it("uses the verified subject and socket instead of a forged payload userId", async () => {
    const { gateway, authService, lyriaRealtime } = createGateway();
    const client = createClient("socket-a");

    await gateway.handleRealtimeStart(client, {
      trackId: "track-1",
      userId: "attacker-controlled-id",
    } as any);

    expect(authService.verifyAccessToken).toHaveBeenCalledWith("token-1");
    expect(lyriaRealtime.startSession).toHaveBeenCalledWith(expect.objectContaining({
      trackId: "track-1",
      owner: { userId: "user-1", socketId: "socket-a" },
    }));
    expect(lyriaRealtime.startSession.mock.calls[0][0]).not.toHaveProperty("userId");
    expect(client.emit).toHaveBeenCalledWith("realtime:started", {
      sessionId: "rt_session",
      available: true,
    });
    gateway.onModuleDestroy();
  });

  it("allows the owning socket to control, stop, and record a session", async () => {
    const { gateway, lyriaRealtime } = createGateway();
    const client = createClient("socket-a");
    await gateway.handleRealtimeStart(client, { trackId: "track-1" });

    await gateway.handleRealtimeControl(client, { sessionId: "rt_session", bpm: 140 });
    await gateway.handleRecordStart(client, { sessionId: "rt_session" });
    await gateway.handleRecordStop(client, { sessionId: "rt_session" });
    await gateway.handleRealtimeStop(client, { sessionId: "rt_session" });

    const owner = { userId: "user-1", socketId: "socket-a" };
    expect(lyriaRealtime.updateControls).toHaveBeenCalledWith("rt_session", owner, expect.objectContaining({ bpm: 140 }));
    expect(lyriaRealtime.startRecording).toHaveBeenCalledWith("rt_session", owner);
    expect(lyriaRealtime.stopRecording).toHaveBeenCalledWith("rt_session", owner);
    expect(lyriaRealtime.stopSession).toHaveBeenCalledWith("rt_session", owner);
    expect(client.emit).toHaveBeenCalledWith("realtime:recorded", expect.objectContaining({
      sessionId: "rt_session",
      audio: Buffer.from("RIFF").toString("base64"),
    }));
    expect(client.emit).toHaveBeenCalledWith("realtime:stopped", { sessionId: "rt_session" });
    gateway.onModuleDestroy();
  });

  it("denies another socket, including the same user, without invoking controls or recording", async () => {
    const { gateway, authService, lyriaRealtime } = createGateway();
    const ownerClient = createClient("socket-a", "token-1");
    const otherUserClient = createClient("socket-b", "token-2");
    const secondSocketSameUser = createClient("socket-c", "token-3");
    authService.verifyAccessToken.mockImplementation((token: string) => ({
      userId: token === "token-2" ? "user-2" : "user-1",
    }));

    await gateway.handleRealtimeStart(ownerClient, { trackId: "track-1" });
    for (const client of [otherUserClient, secondSocketSameUser]) {
      await gateway.handleRealtimeControl(client, { sessionId: "rt_session", bpm: 160 });
      await gateway.handleRealtimeStop(client, { sessionId: "rt_session" });
      await gateway.handleRecordStart(client, { sessionId: "rt_session" });
      await gateway.handleRecordStop(client, { sessionId: "rt_session" });

      expect(client.emit).toHaveBeenCalledWith("realtime:error", {
        code: "SESSION_ACCESS_DENIED",
        message: "Realtime session unavailable",
      });
      expect(client.emit).not.toHaveBeenCalledWith("realtime:recorded", expect.anything());
      expect(client.emit).not.toHaveBeenCalledWith("realtime:stopped", expect.anything());
    }

    expect(lyriaRealtime.updateControls).not.toHaveBeenCalled();
    expect(lyriaRealtime.stopSession).not.toHaveBeenCalled();
    expect(lyriaRealtime.startRecording).not.toHaveBeenCalled();
    expect(lyriaRealtime.stopRecording).not.toHaveBeenCalled();
    gateway.onModuleDestroy();
  });

  it("does not map or acknowledge a start that finishes after disconnect", async () => {
    const { gateway, lyriaRealtime } = createGateway();
    let resolveStart!: (sessionId: string) => void;
    lyriaRealtime.startSession.mockReturnValue(new Promise<string>((resolve) => {
      resolveStart = resolve;
    }));
    const client = createClient("socket-a");

    const startPromise = gateway.handleRealtimeStart(client, { trackId: "track-1" });
    client.connected = false;
    gateway.handleDisconnect(client);
    resolveStart("rt_pending");
    await startPromise;

    expect(lyriaRealtime.stopSessionsForSocket).toHaveBeenCalledWith("socket-a");
    expect(lyriaRealtime.stopSession).toHaveBeenCalledWith(
      "rt_pending",
      { userId: "user-1", socketId: "socket-a" },
    );
    expect(client.emit).not.toHaveBeenCalledWith("realtime:started", expect.anything());
    gateway.onModuleDestroy();
  });

  it("keeps unrelated public marketplace handlers available", () => {
    const { gateway, emit } = createGateway();
    const client = createClient();

    gateway.handleNotifyListingCreated(client, { tokenId: "77", seller: "0xseller" });

    expect(emit).toHaveBeenCalledWith("marketplace.listing_created", expect.objectContaining({
      tokenId: "77",
      seller: "0xseller",
    }));
    gateway.onModuleDestroy();
  });

  describe("AI DJ live feed", () => {
    it("announces curation completion without spend text", () => {
      const { gateway, eventBus, emit } = createGateway();

      eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: "2026-10-02T12:00:00.000Z",
        sessionId: "session-1",
        trackCount: 5,
        reason: "approved",
      });

      expect(emit).toHaveBeenCalledWith("agent.event", expect.objectContaining({
        type: "agent.decision_made",
        message: "Curation complete: 5 tracks selected",
      }));
      gateway.onModuleDestroy();
    });

    it("shows no price on an LLM decision message", () => {
      const { gateway, eventBus, emit } = createGateway();

      eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: "2026-10-02T12:00:00.000Z",
        sessionId: "session-1",
        trackId: "track-1",
        priceUsd: 0.05,
        reason: "llm",
        latencyMs: 1200,
      } as any);

      const message = emit.mock.calls.find(([name]) => name === "agent.event")?.[1].message;
      expect(message).toBe("AI selected track (1.2s)");
      gateway.onModuleDestroy();
    });

    it("appends what the picks did not match of the described session (#2037)", () => {
      const { gateway, eventBus, emit } = createGateway();
      const coverage = {
        picks: 5,
        gaps: [
          { filter: "genres", matched: 0 },
          { filter: "bpm", matched: 1 },
        ],
      };

      eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: "2026-10-02T12:00:00.000Z",
        sessionId: "session-1",
        trackCount: 5,
        reason: "approved",
        coverage,
        coverageSummary: "not matched: deep house (0 of 5), 120\u2013125 BPM (1 of 5)",
      } as any);

      expect(emit).toHaveBeenCalledWith("agent.event", expect.objectContaining({
        type: "agent.decision_made",
        message:
          "Curation complete: 5 tracks selected \u00b7 not matched: deep house (0 of 5), 120\u2013125 BPM (1 of 5)",
        coverage,
      }));
      gateway.onModuleDestroy();
    });

    it("says the picks are rule-based when the LLM runtime fell back (#2075)", () => {
      const { gateway, eventBus, emit } = createGateway();
      const runtimeFallback = { from: "adk", reason: "not_configured" };

      eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: "2026-10-02T12:00:00.000Z",
        sessionId: "session-1",
        trackCount: 5,
        reason: "approved",
        curatedBy: "rules",
        runtimeFallback,
        coverageSummary: "not matched: soul (1 of 5)",
      } as any);
      eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: "2026-10-02T12:00:00.000Z",
        sessionId: "session-1",
        trackId: "",
        reason: "no_tracks",
        curatedBy: "rules",
        runtimeFallback,
      } as any);

      const payloads = emit.mock.calls.filter(([name]) => name === "agent.event").map(([, payload]) => payload);
      expect(payloads[0].message).toBe(
        "Curation complete: 5 tracks selected \u00b7 rule-based picks (AI curator unavailable) \u00b7 not matched: soul (1 of 5)",
      );
      expect(payloads[0].curatedBy).toBe("rules");
      expect(payloads[0].runtimeFallback).toEqual(runtimeFallback);
      expect(payloads[1].message).toBe(
        "No matching tracks found in catalog \u00b7 rule-based picks (AI curator unavailable)",
      );
      gateway.onModuleDestroy();
    });

    it("never says AI selected for a rule-curated decision, even with reasoning or latency (#2075)", () => {
      const { gateway, eventBus, emit } = createGateway();

      eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: "2026-10-02T12:00:00.000Z",
        sessionId: "session-1",
        trackCount: 3,
        reason: "approved",
        latencyMs: 900,
        reasoning: "stale text",
        curatedBy: "rules",
      } as any);

      const payload = emit.mock.calls.find(([name]) => name === "agent.event")?.[1];
      expect(payload.message).toBe("Curation complete: 3 tracks selected");
      expect(payload.runtimeFallback).toBeUndefined();
      gateway.onModuleDestroy();
    });

    it("says AI selected for an LLM-curated decision (#2075)", () => {
      const { gateway, eventBus, emit } = createGateway();

      eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: "2026-10-02T12:00:00.000Z",
        sessionId: "session-1",
        trackId: "track-1,track-2",
        reason: "llm",
        curatedBy: "llm",
        coverageSummary: "not matched: soul (1 of 2)",
      } as any);

      const payload = emit.mock.calls.find(([name]) => name === "agent.event")?.[1];
      expect(payload.message).toBe("AI selected track \u00b7 not matched: soul (1 of 2)");
      expect(payload.curatedBy).toBe("llm");
      gateway.onModuleDestroy();
    });

    it("keeps the message and omits coverage when nothing was requested or missed", () => {
      const { gateway, eventBus, emit } = createGateway();

      eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: "2026-10-02T12:00:00.000Z",
        sessionId: "session-1",
        trackCount: 5,
        reason: "approved",
        coverage: { picks: 5, gaps: [] },
      } as any);

      const payload = emit.mock.calls.find(([name]) => name === "agent.event")?.[1];
      expect(payload.message).toBe("Curation complete: 5 tracks selected");
      expect(payload.coverage).toEqual({ picks: 5, gaps: [] });
      gateway.onModuleDestroy();
    });

    it("does not broadcast private My Mix lane coverage", () => {
      const { gateway, eventBus, emit } = createGateway();
      eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: "2026-10-04T12:00:00.000Z",
        sessionId: "session-1",
        trackCount: 5,
        reason: "approved",
        mixCoverage: {
          lanes: [{ id: "lane_private", label: "Private Soul lane", requested: 3, matched: 1 }],
        },
      } as any);
      const payload = emit.mock.calls.find(([name]) => name === "agent.event")?.[1];
      expect(payload.mixCoverage).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain("Private Soul lane");
      expect(JSON.stringify(payload)).not.toContain("lane_private");
      gateway.onModuleDestroy();
    });

    it("no longer broadcasts negotiation messages", () => {
      const { gateway, eventBus, emit } = createGateway();

      eventBus.publish({
        eventName: "agent.negotiated",
        eventVersion: 1,
        occurredAt: "2026-10-02T12:00:00.000Z",
        sessionId: "session-1",
        trackId: "track-1",
        licenseType: "personal",
        priceUsd: 0.02,
        reason: "ok",
      });

      expect(emit).not.toHaveBeenCalled();
      gateway.onModuleDestroy();
    });
  });
});
