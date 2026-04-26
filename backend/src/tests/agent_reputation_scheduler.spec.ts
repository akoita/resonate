import {
  DEFAULT_REPUTATION_ATTESTATION_FRESHNESS_MS,
  DEFAULT_REPUTATION_SCHEDULER_BATCH_SIZE,
  DEFAULT_REPUTATION_SCHEDULER_INTERVAL_MS,
  AgentReputationSchedulerService,
  buildAgentReputationSchedulerWhere,
  readAgentReputationSchedulerSettings,
  schedulerDisabledReason,
} from "../modules/agents/agent_reputation_scheduler.service";
import type { AgentIdentityService } from "../modules/agents/agent_identity.service";

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as any;
}

function candidate(overrides: Partial<{
  id: string;
  userId: string;
  identityStatus: string;
  identityTokenId: string | null;
  reputationAttestedAt: Date | null;
}> = {}) {
  return {
    id: "agent_1",
    userId: "user_1",
    identityStatus: "minted",
    identityTokenId: "42",
    reputationAttestedAt: null,
    ...overrides,
  };
}

describe("agent reputation scheduler", () => {
  it("is opt-in and keeps safe defaults", () => {
    const settings = readAgentReputationSchedulerSettings(config({}));

    expect(settings).toEqual({
      schedulerEnabled: false,
      erc8004Enabled: false,
      intervalMs: DEFAULT_REPUTATION_SCHEDULER_INTERVAL_MS,
      freshnessMs: DEFAULT_REPUTATION_ATTESTATION_FRESHNESS_MS,
      batchSize: DEFAULT_REPUTATION_SCHEDULER_BATCH_SIZE,
    });
    expect(schedulerDisabledReason(settings)).toBe("scheduler_disabled");
  });

  it("requires both scheduler and ERC-8004 writes to be enabled", () => {
    expect(schedulerDisabledReason(readAgentReputationSchedulerSettings(config({
      ERC8004_REPUTATION_SCHEDULER_ENABLED: "true",
      ERC8004_ENABLED: "false",
    })))).toBe("erc8004_disabled");

    expect(schedulerDisabledReason(readAgentReputationSchedulerSettings(config({
      ERC8004_REPUTATION_SCHEDULER_ENABLED: "true",
      ERC8004_ENABLED: "true",
    })))).toBeUndefined();
  });

  it("parses interval, freshness, and batch overrides", () => {
    const settings = readAgentReputationSchedulerSettings(config({
      ERC8004_REPUTATION_SCHEDULER_ENABLED: "true",
      ERC8004_ENABLED: "true",
      ERC8004_REPUTATION_SCHEDULER_INTERVAL_MS: "60000",
      ERC8004_REPUTATION_FRESHNESS_MS: "120000",
      ERC8004_REPUTATION_SCHEDULER_BATCH_SIZE: "7",
    }));

    expect(settings.intervalMs).toBe(60000);
    expect(settings.freshnessMs).toBe(120000);
    expect(settings.batchSize).toBe(7);
  });

  it("builds eligibility filters for active stale minted agents", () => {
    const where = buildAgentReputationSchedulerWhere(
      new Date("2026-04-26T15:00:00.000Z"),
      60 * 60 * 1000,
    );

    expect(where).toEqual({
      isActive: true,
      identityTokenId: { not: null },
      identityStatus: { in: ["minted", "attested"] },
      OR: [
        { reputationAttestedAt: null },
        { reputationAttestedAt: { lte: new Date("2026-04-26T14:00:00.000Z") } },
      ],
    });
  });

  it("skips sweeps when scheduler config is disabled", async () => {
    const service = new AgentReputationSchedulerService(
      { attestReputation: jest.fn() } as unknown as AgentIdentityService,
      config({}),
    );

    await expect(service.runSchedulerSweep()).resolves.toEqual({
      status: "disabled",
      reason: "scheduler_disabled",
      scanned: 0,
      attested: 0,
      skipped: 0,
      failed: 0,
      results: [],
    });
  });

  it("reports missing session keys as skipped refreshes", async () => {
    const attestReputation = jest.fn().mockResolvedValue({
      onchain: {
        status: "minted",
        chainId: 84532,
        registry: "0x1234567890123456789012345678901234567890",
        txHash: null,
        tokenId: "42",
        reason: "missing_session_key",
      },
    });
    const service = new AgentReputationSchedulerService(
      { attestReputation } as unknown as AgentIdentityService,
      config({ ERC8004_REPUTATION_SCHEDULER_ENABLED: "true", ERC8004_ENABLED: "true" }),
    );

    await expect(service.refreshCandidate(candidate())).resolves.toMatchObject({
      agentConfigId: "agent_1",
      userId: "user_1",
      status: "skipped",
      txHash: null,
      reason: "missing_session_key",
    });
    expect(attestReputation).toHaveBeenCalledWith("user_1");
  });

  it("returns attested when the identity service publishes metadata", async () => {
    const service = new AgentReputationSchedulerService(
      {
        attestReputation: jest.fn().mockResolvedValue({
          onchain: {
            status: "attested",
            chainId: 84532,
            registry: "0x1234567890123456789012345678901234567890",
            txHash: "0xtx",
            tokenId: "42",
          },
        }),
      } as unknown as AgentIdentityService,
      config({ ERC8004_REPUTATION_SCHEDULER_ENABLED: "true", ERC8004_ENABLED: "true" }),
    );

    await expect(service.refreshCandidate(candidate())).resolves.toMatchObject({
      agentConfigId: "agent_1",
      userId: "user_1",
      status: "attested",
      txHash: "0xtx",
    });
  });

  it("continues after per-agent refresh failures", async () => {
    const service = new AgentReputationSchedulerService(
      {
        attestReputation: jest.fn().mockRejectedValue(new Error("wallet unavailable")),
      } as unknown as AgentIdentityService,
      config({ ERC8004_REPUTATION_SCHEDULER_ENABLED: "true", ERC8004_ENABLED: "true" }),
    );

    await expect(service.refreshCandidate(candidate())).resolves.toMatchObject({
      agentConfigId: "agent_1",
      userId: "user_1",
      status: "failed",
      txHash: null,
      reason: "error",
      error: "wallet unavailable",
    });
  });
});
