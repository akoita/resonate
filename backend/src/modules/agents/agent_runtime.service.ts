import { Injectable, Logger, Optional } from "@nestjs/common";
import { AgentRuntimePolicyService } from "./agent_runtime.policy.service";
import { AgentRuntimeExecutorService } from "./agent_runtime.executor.service";
import { AgentRuntimeRemoteClient } from "./agent_runtime_remote.client";
import {
  AgentRuntimeCommerceResult,
  AgentRuntimeRunResult,
  normalizeAgentRuntimeResult,
} from "./agent_runtime.types";
import { AgentRuntimeInput } from "./runtime/agent_runtime.adapter";
import { EventBus } from "../shared/event_bus";
import { discoveryVariantForUser } from "../recommendations/discovery_experiment";
import { resolveListeningLanes } from "./listening_lanes.service";
import {
  MixCoverage,
  resolveMyMixPlan,
  ResolvedMyMixPlan,
} from "./agent_my_mix";
import { getAgentTrackLimit } from "./agent_runtime.config";

export interface MyMixLaneDemandObservation {
  laneId: string;
  requested: number;
  genres: string[];
  moods: string[];
  matchedTrackIds: string[];
}

type SessionMixSnapshot = {
  userId: string;
  sessionId: string;
  coverage: MixCoverage;
  demand: MyMixLaneDemandObservation[];
};

const MY_MIX_SESSION_CACHE_LIMIT = 128;

@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);
  private readonly myMixSessions = new Map<string, SessionMixSnapshot>();

  constructor(
    private readonly executor: AgentRuntimeExecutorService,
    private readonly remoteClient: AgentRuntimeRemoteClient,
    // Policy step for LLM picks (#1456). Absent in lightweight unit wiring.
    @Optional() private readonly policy?: AgentRuntimePolicyService,
    // #1455 WS-8: records the ranker variant on DJ recommendations.
    @Optional() private readonly eventBus?: EventBus,
  ) {}

  /**
   * The single choke point for runtime picks: `AgentConfigController.
   * startSession` and `SessionsService.agentNext` both reach the runtime here,
   * whether it runs in-process or on the remote worker. LLM adapter results
   * (`picks`) pass through the shared policy stage; orchestrator results
   * (`tracks`) already did, inside the selector.
   */
  async run(input: AgentRuntimeInput): Promise<AgentRuntimeRunResult> {
    const plan = await this.resolveMyMix(input);
    if (!plan) this.clearMyMixSession(input.userId, input.sessionId);
    const safeInput = withoutMyMix(input);
    const result = plan
      ? await this.executor.runWithMyMix(safeInput, plan)
      : await this.execute(safeInput);
    const final =
      this.policy && !("tracks" in result) ? await this.policy.apply(input, result) : result;
    if (plan && "tracks" in final) {
      this.rememberMyMixSession(input.userId, input.sessionId, plan, final);
    }
    this.recordVariant(input, final);
    return final;
  }

  getInitialMixCoverage(userId: string, sessionId: string): MixCoverage | undefined {
    const key = this.sessionCacheKey(userId, sessionId);
    const cached = this.myMixSessions.get(key);
    if (!cached || cached.userId !== userId || cached.sessionId !== sessionId) return undefined;
    this.myMixSessions.delete(key);
    this.myMixSessions.set(key, cached);
    return structuredClone(cached.coverage);
  }

  takeMyMixDemandObservations(userId: string, sessionId: string): MyMixLaneDemandObservation[] {
    const key = this.sessionCacheKey(userId, sessionId);
    const cached = this.myMixSessions.get(key);
    if (!cached || cached.userId !== userId || cached.sessionId !== sessionId) return [];
    return structuredClone(cached.demand);
  }

  clearMyMixSession(userId: string, sessionId: string): void {
    this.myMixSessions.delete(this.sessionCacheKey(userId, sessionId));
  }

  /**
   * #1455 WS-8: record which ranker variant the listener was in for this DJ
   * recommendation. Label only; the DJ ranks identically in every variant.
   * Never affects the pick: failures are swallowed.
   */
  private recordVariant(input: AgentRuntimeInput, result: AgentRuntimeRunResult) {
    if (!this.eventBus || !input.userId) return;
    try {
      const trackIds = normalizeAgentRuntimeResult(result).tracks.map((track) => track.trackId);
      if (trackIds.length === 0) return;
      const variant = discoveryVariantForUser(input.userId);
      this.eventBus.publish({
        eventName: "recommendation.generated",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        userId: input.userId,
        trackIds,
        strategy: "ai_dj",
        surface: "dj",
        rankerVariant: variant.rankerVariant,
        ...(variant.experimentKey ? { experimentKey: variant.experimentKey } : {}),
      });
    } catch (error) {
      this.logger.warn(`ranker variant not recorded: ${String(error)}`);
    }
  }

  private async execute(input: AgentRuntimeInput): Promise<AgentRuntimeRunResult> {
    if (!this.remoteClient.enabled) {
      return this.executor.run(input);
    }

    try {
      return await this.remoteClient.run(input);
    } catch (error: any) {
      if (this.remoteClient.required) {
        throw error;
      }
      this.logger.warn(
        `agent runtime worker failed (${error.message}) - falling back to in-process executor`
      );
      return this.executor.run(input);
    }
  }

  private async resolveMyMix(input: AgentRuntimeInput): Promise<ResolvedMyMixPlan | undefined> {
    if (input.preferences?.myMix == null) return undefined;
    const visibleLanes = await resolveListeningLanes(input.userId);
    return resolveMyMixPlan(input.preferences.myMix, visibleLanes, getAgentTrackLimit());
  }

  private rememberMyMixSession(
    userId: string,
    sessionId: string,
    plan: ResolvedMyMixPlan,
    result: Extract<AgentRuntimeRunResult, { tracks: unknown[] }>,
  ) {
    const trackIdsByLane = new Map<string, string[]>();
    for (const track of result.tracks as Array<{ trackId: string; mixLaneId?: string }>) {
      if (!track.mixLaneId) continue;
      trackIdsByLane.set(track.mixLaneId, [...(trackIdsByLane.get(track.mixLaneId) ?? []), track.trackId]);
    }
    const coverage = result.mixCoverage ?? {
      lanes: plan.lanes.map((lane) => ({
        id: lane.id,
        label: lane.label,
        requested: lane.requested,
        matched: trackIdsByLane.get(lane.id)?.length ?? 0,
      })),
    };
    const demand = plan.lanes.map((lane) => ({
      laneId: lane.id,
      requested: lane.requested,
      genres: Object.keys(lane.genreWeights),
      moods: Object.keys(lane.genreWeights).length > 0 ? [] : Object.keys(lane.moodWeights),
      matchedTrackIds: trackIdsByLane.get(lane.id) ?? [],
    }));
    const key = this.sessionCacheKey(userId, sessionId);
    this.myMixSessions.delete(key);
    this.myMixSessions.set(key, { userId, sessionId, coverage, demand });
    if (this.myMixSessions.size > MY_MIX_SESSION_CACHE_LIMIT) {
      this.myMixSessions.delete(this.myMixSessions.keys().next().value!);
    }
  }

  private sessionCacheKey(userId: string, sessionId: string) {
    return `${userId}\0${sessionId}`;
  }

  async runCommerce(input: AgentRuntimeInput): Promise<AgentRuntimeCommerceResult> {
    return normalizeAgentRuntimeResult(await this.run(input));
  }
}

function withoutMyMix(input: AgentRuntimeInput): AgentRuntimeInput {
  const { myMix: _myMix, ...preferences } = input.preferences ?? {};
  return {
    sessionId: input.sessionId,
    userId: input.userId,
    recentTrackIds: input.recentTrackIds,
    budgetRemainingUsd: input.budgetRemainingUsd,
    preferences,
  };
}
