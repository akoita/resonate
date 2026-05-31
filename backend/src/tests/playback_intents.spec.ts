import {
  PlaybackIntentCatalogResolver,
  PlaybackIntentsService,
} from "../modules/sessions/playback_intents.service";

const fakeResolver: PlaybackIntentCatalogResolver = {
  resolve: jest.fn().mockResolvedValue([
    {
      trackId: "track-1",
      title: "Signal Bloom",
      artistId: "artist-1",
      artistName: "Test Artist",
      releaseId: "release-1",
      releaseTitle: "Signal Bloom EP",
      explicit: false,
      source: "catalog",
      playable: true,
      reasons: ["Matches playback intent query"],
    },
  ]),
};

function makeService() {
  const eventBus = { publish: jest.fn() };
  return {
    service: new PlaybackIntentsService(fakeResolver, eventBus as any),
    eventBus,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PlaybackIntentsService", () => {
  it("resolves catalog candidates without exposing private owner state", async () => {
    const { service } = makeService();

    const response = await service.resolve("user-1", {
      query: "late night",
      constraints: { maxTracks: 3, explicit: false },
    });

    expect(response.outcome).toBe("queued");
    expect(response.candidates).toHaveLength(1);
    expect(response.redaction).toEqual({
      privateLibrary: "redacted",
      privateTaste: "redacted",
      wallet: "redacted",
      ownership: "redacted",
    });
    expect(response.policy.paymentOrLicensingAllowed).toBe(false);
    expect(fakeResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        query: "late night",
      }),
    );
  });

  it("does not queue playback when no active device is available", () => {
    const { service } = makeService();

    const command = service.requestQueue("user-1", { trackIds: ["track-1"] });

    expect(command.outcome).toBe("no_active_device");
    expect(command.status).toBe("unavailable");
    expect(command.reason).toBe("no_active_device");
  });

  it("queues a command when an active device can accept queue updates", () => {
    const { service } = makeService();
    service.registerDevice("user-1", { deviceId: "web-1" });

    const command = service.requestQueue("user-1", {
      trackIds: ["track-1", "track-2"],
      deviceId: "web-1",
    });

    expect(command.outcome).toBe("queued");
    expect(command.status).toBe("queued");
    expect(command.deviceId).toBe("web-1");
    expect(command.agentOriginated).toBe(true);
  });

  it("requires confirmation before external agent playback starts", () => {
    const { service } = makeService();
    service.registerDevice("user-1", { deviceId: "web-1" });

    const command = service.requestPlay("user-1", {
      trackIds: ["track-1"],
      deviceId: "web-1",
      initiator: "external_agent",
    });

    expect(command.outcome).toBe("confirmation_required");
    expect(command.status).toBe("pending_confirmation");
    expect(command.requiresConfirmation).toBe(true);
  });

  it("marks playback as playing only after client confirmation", () => {
    const { service } = makeService();
    service.registerDevice("user-1", { deviceId: "web-1" });
    const command = service.requestPlay("user-1", {
      trackIds: ["track-1"],
      deviceId: "web-1",
    });

    const confirmed = service.confirmCommand("user-1", {
      commandId: command.commandId,
      deviceId: "web-1",
      outcome: "playing",
      currentTrackId: "track-1",
    });

    expect(confirmed.outcome).toBe("playing");
    expect(confirmed.status).toBe("playing");
    expect(service.status("user-1", command.commandId)).toEqual(
      expect.objectContaining({
        outcome: "playing",
        confirmedAt: expect.any(String),
      }),
    );
  });

  it("blocks revoked capabilities", () => {
    const { service } = makeService();
    service.registerDevice("user-1", { deviceId: "web-1" });
    const capability = service.createCapability("user-1", {
      scopes: ["playback.queue"],
      allowedSources: ["resonate_catalog"],
    });
    service.revokeCapability("user-1", capability.id);

    const command = service.requestQueue("user-1", {
      capabilityId: capability.id,
      trackIds: ["track-1"],
    });

    expect(command.outcome).toBe("blocked_by_policy");
    expect(command.status).toBe("blocked");
    expect(command.reason).toBe("capability_revoked");
  });
});
