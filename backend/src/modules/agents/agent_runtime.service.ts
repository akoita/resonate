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

@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

  constructor(
    private readonly executor: AgentRuntimeExecutorService,
    private readonly remoteClient: AgentRuntimeRemoteClient,
    // Policy step for LLM picks (#1456). Absent in lightweight unit wiring.
    @Optional() private readonly policy?: AgentRuntimePolicyService
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
    if (this.policy && !("tracks" in result)) {
      return this.policy.apply(input, result);
    }
    return result;
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
