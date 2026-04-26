import { Injectable, Logger } from "@nestjs/common";
import { AgentRuntimeExecutorService } from "./agent_runtime.executor.service";
import { AgentRuntimeRemoteClient } from "./agent_runtime_remote.client";
import { AgentRuntimeRunResult } from "./agent_runtime.types";
import { AgentRuntimeInput } from "./runtime/agent_runtime.adapter";

@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

  constructor(
    private readonly executor: AgentRuntimeExecutorService,
    private readonly remoteClient: AgentRuntimeRemoteClient
  ) {}

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeRunResult> {
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
}
