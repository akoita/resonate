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

@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

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
    const result = await this.execute(input);
    const final =
      this.policy && !("tracks" in result) ? await this.policy.apply(input, result) : result;
    this.recordVariant(input, final);
    return final;
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

  async runCommerce(input: AgentRuntimeInput): Promise<AgentRuntimeCommerceResult> {
    return normalizeAgentRuntimeResult(await this.run(input));
  }
}
