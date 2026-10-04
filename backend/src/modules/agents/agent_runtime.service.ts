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
import { habitMixAssignment } from "./habit_mix_experiment";
import { resolveListeningLanes } from "./listening_lanes.service";
import {
  MixCoverage,
  resolveMyMixPlan,
  ResolvedMyMixPlan,
} from "./agent_my_mix";
import { getAgentTrackLimit } from "./agent_runtime.config";
import { logDegradedFallback } from "../shared/degraded_fallback";

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
  trackIds: string[];
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
    const assignment = habitMixAssignment(input);
    const resolvedPlan = await this.resolveMyMix(input);
    const plan = resolvedPlan && assignment.orderingVariant !== "single_profile"
      ? { ...resolvedPlan, orderingVariant: assignment.orderingVariant }
      : undefined;
    if (!plan) this.clearMyMixSession(input.userId, input.sessionId);
    const safeInput = withoutMyMix(input);
    const result = plan
      ? await this.executor.runWithMyMix(safeInput, plan)
      : assignment.sessionSource === "my_mix" && assignment.orderingVariant === "single_profile"
        ? await this.executor.runWithSingleProfile(safeInput)
        : await this.execute(safeInput);
    const final =
      this.policy && !("tracks" in result) ? await this.policy.apply(input, result) : result;
    if (plan && "tracks" in final) {
      this.rememberMyMixSession(input.userId, input.sessionId, plan, final);
    }
    this.recordVariant(input, final, plan?.orderingVariant ?? "single_profile", assignment);
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

  /** Latest ordered batch; private, owner-bound and ephemeral like coverage. */
  getMyMixTrackOrder(userId: string, sessionId: string): string[] | undefined {
    const cached = this.myMixSessions.get(this.sessionCacheKey(userId, sessionId));
    if (!cached || cached.userId !== userId || cached.sessionId !== sessionId) return undefined;
    return [...cached.trackIds];
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

  /** Each returned DJ pick gets server-owned labels; telemetry cannot fail a pick. */
  private recordVariant(input: AgentRuntimeInput, result: AgentRuntimeRunResult,
    orderingVariant: "habit" | "neutral" | "single_profile",
    assignment: ReturnType<typeof habitMixAssignment>) {
    if (!this.eventBus || !input.userId) return;
    try {
      const tracks = normalizeAgentRuntimeResult(result).tracks;
      for (const track of tracks) {
        this.eventBus.publish({
          eventName: "recommendation.generated",
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          userId: input.userId,
          trackId: track.trackId,
          trackIds: [track.trackId],
          agentSessionId: input.sessionId,
          strategy: "ai_dj",
          surface: "dj",
          sessionSource: assignment.sessionSource,
          rankerVariant: assignment.rankerVariant,
          orderingVariant,
          explorationPick: track.reasonCode === "discovery_pick",
          ...(assignment.experimentKey ? { experimentKey: assignment.experimentKey } : {}),
        });
      }
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
      logDegradedFallback({
        component: "agent_runtime.remote_worker",
        reason: "error",
        error,
      });
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
    this.myMixSessions.set(key, { userId, sessionId, coverage, demand, trackIds: result.tracks.map((track) => track.trackId) });
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
