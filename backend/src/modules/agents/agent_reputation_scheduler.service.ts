import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { AgentIdentityService, type AgentIdentityOnchainResult } from "./agent_identity.service";

export const DEFAULT_REPUTATION_SCHEDULER_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_REPUTATION_ATTESTATION_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_REPUTATION_SCHEDULER_BATCH_SIZE = 25;

export type AgentReputationSchedulerSettings = {
  schedulerEnabled: boolean;
  erc8004Enabled: boolean;
  intervalMs: number;
  freshnessMs: number;
  batchSize: number;
};

export type AgentReputationSchedulerCandidate = {
  id: string;
  userId: string;
  identityStatus: string;
  identityTokenId: string | null;
  reputationAttestedAt: Date | null;
};

export type AgentReputationSchedulerResult = {
  agentConfigId: string;
  userId: string;
  status: "attested" | "skipped" | "failed";
  txHash: string | null;
  reason?: AgentIdentityOnchainResult["reason"] | "fresh" | "missing_token_id" | "error";
  error?: string;
};

export type AgentReputationSchedulerSweep = {
  status: "disabled" | "skipped" | "completed";
  reason?: "scheduler_disabled" | "erc8004_disabled" | "sweep_in_flight";
  scanned: number;
  attested: number;
  skipped: number;
  failed: number;
  results: AgentReputationSchedulerResult[];
};

type ConfigReader = Pick<ConfigService, "get">;

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readAgentReputationSchedulerSettings(configService: ConfigReader): AgentReputationSchedulerSettings {
  return {
    schedulerEnabled: configService.get<string>("ERC8004_REPUTATION_SCHEDULER_ENABLED") === "true",
    erc8004Enabled: configService.get<string>("ERC8004_ENABLED") === "true",
    intervalMs: parsePositiveInt(
      configService.get<string>("ERC8004_REPUTATION_SCHEDULER_INTERVAL_MS"),
      DEFAULT_REPUTATION_SCHEDULER_INTERVAL_MS,
    ),
    freshnessMs: parsePositiveInt(
      configService.get<string>("ERC8004_REPUTATION_FRESHNESS_MS"),
      DEFAULT_REPUTATION_ATTESTATION_FRESHNESS_MS,
    ),
    batchSize: parsePositiveInt(
      configService.get<string>("ERC8004_REPUTATION_SCHEDULER_BATCH_SIZE"),
      DEFAULT_REPUTATION_SCHEDULER_BATCH_SIZE,
    ),
  };
}

export function schedulerDisabledReason(
  settings: AgentReputationSchedulerSettings,
): AgentReputationSchedulerSweep["reason"] | undefined {
  if (!settings.schedulerEnabled) return "scheduler_disabled";
  if (!settings.erc8004Enabled) return "erc8004_disabled";
  return undefined;
}

export function buildAgentReputationSchedulerWhere(
  now: Date,
  freshnessMs: number,
): Prisma.AgentConfigWhereInput {
  const cutoff = new Date(now.getTime() - freshnessMs);
  return {
    isActive: true,
    identityTokenId: { not: null },
    identityStatus: { in: ["minted", "attested"] },
    OR: [
      { reputationAttestedAt: null },
      { reputationAttestedAt: { lte: cutoff } },
    ],
  };
}

@Injectable()
export class AgentReputationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentReputationSchedulerService.name);
  private interval: NodeJS.Timeout | null = null;
  private sweepInFlight = false;

  constructor(
    private readonly identityService: AgentIdentityService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const settings = this.getSettings();
    const disabledReason = schedulerDisabledReason(settings);
    if (disabledReason) {
      this.logger.log(
        `ERC-8004 reputation scheduler disabled (${disabledReason}; set ERC8004_REPUTATION_SCHEDULER_ENABLED=true and ERC8004_ENABLED=true to enable)`,
      );
      return;
    }

    this.logger.log(
      `Starting ERC-8004 reputation scheduler (interval=${settings.intervalMs}ms, freshness=${settings.freshnessMs}ms, batch=${settings.batchSize})`,
    );
    this.interval = setInterval(() => {
      void this.runSchedulerSweep();
    }, settings.intervalMs);
    this.interval.unref?.();

    void this.runSchedulerSweep();
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async runSchedulerSweep(now = new Date()): Promise<AgentReputationSchedulerSweep> {
    if (this.sweepInFlight) {
      return this.emptySweep("skipped", "sweep_in_flight");
    }

    const settings = this.getSettings();
    const disabledReason = schedulerDisabledReason(settings);
    if (disabledReason) {
      return this.emptySweep("disabled", disabledReason);
    }

    this.sweepInFlight = true;
    try {
      const candidates = await prisma.agentConfig.findMany({
        where: buildAgentReputationSchedulerWhere(now, settings.freshnessMs),
        select: {
          id: true,
          userId: true,
          identityStatus: true,
          identityTokenId: true,
          reputationAttestedAt: true,
        },
        orderBy: [
          { reputationAttestedAt: "asc" },
          { updatedAt: "asc" },
        ],
        take: settings.batchSize,
      });

      const results: AgentReputationSchedulerResult[] = [];
      for (const candidate of candidates) {
        results.push(await this.refreshCandidate(candidate));
      }

      return {
        status: "completed",
        scanned: candidates.length,
        attested: results.filter((result) => result.status === "attested").length,
        skipped: results.filter((result) => result.status === "skipped").length,
        failed: results.filter((result) => result.status === "failed").length,
        results,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`ERC-8004 reputation scheduler sweep failed: ${message}`);
      return {
        status: "completed",
        scanned: 0,
        attested: 0,
        skipped: 0,
        failed: 1,
        results: [{
          agentConfigId: "scheduler",
          userId: "scheduler",
          status: "failed",
          txHash: null,
          reason: "error",
          error: message,
        }],
      };
    } finally {
      this.sweepInFlight = false;
    }
  }

  async refreshCandidate(candidate: AgentReputationSchedulerCandidate): Promise<AgentReputationSchedulerResult> {
    if (!candidate.identityTokenId) {
      return {
        agentConfigId: candidate.id,
        userId: candidate.userId,
        status: "skipped",
        txHash: null,
        reason: "missing_token_id",
      };
    }

    try {
      const result = await this.identityService.attestReputation(candidate.userId);
      if (result.onchain.reason) {
        this.logger.debug(
          `Skipped ERC-8004 reputation refresh for ${candidate.id}: ${result.onchain.reason}`,
        );
        return {
          agentConfigId: candidate.id,
          userId: candidate.userId,
          status: "skipped",
          txHash: result.onchain.txHash,
          reason: result.onchain.reason,
        };
      }

      this.logger.log(`Refreshed ERC-8004 reputation for ${candidate.id}: ${result.onchain.txHash}`);
      return {
        agentConfigId: candidate.id,
        userId: candidate.userId,
        status: "attested",
        txHash: result.onchain.txHash,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed ERC-8004 reputation refresh for ${candidate.id}: ${message}`);
      return {
        agentConfigId: candidate.id,
        userId: candidate.userId,
        status: "failed",
        txHash: null,
        reason: "error",
        error: message,
      };
    }
  }

  private getSettings(): AgentReputationSchedulerSettings {
    return readAgentReputationSchedulerSettings(this.configService);
  }

  private emptySweep(
    status: AgentReputationSchedulerSweep["status"],
    reason: NonNullable<AgentReputationSchedulerSweep["reason"]>,
  ): AgentReputationSchedulerSweep {
    return {
      status,
      reason,
      scanned: 0,
      attested: 0,
      skipped: 0,
      failed: 0,
      results: [],
    };
  }
}
