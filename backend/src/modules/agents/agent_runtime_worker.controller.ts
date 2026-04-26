import {
  Body,
  Controller,
  Headers,
  InternalServerErrorException,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import {
  buildAgentRuntimeExecutionResponse,
  normalizeAgentRuntimeExecutionRequest,
} from "./agent_runtime.contract";
import { AgentRuntimeExecutorService } from "./agent_runtime.executor.service";

@Controller("agent-runtime")
export class AgentRuntimeWorkerController {
  constructor(private readonly executor: AgentRuntimeExecutorService) {}

  @Post("execute")
  async execute(
    @Body() body: unknown,
    @Headers("x-internal-service-key") internalServiceKey?: string
  ) {
    this.assertInternalRequest(internalServiceKey);
    const startedAt = Date.now();
    const request = normalizeAgentRuntimeExecutionRequest(body);
    const result = await this.executor.run(request.input);
    return buildAgentRuntimeExecutionResponse(request, result, startedAt);
  }

  private assertInternalRequest(internalServiceKey?: string) {
    const expected = process.env.INTERNAL_SERVICE_KEY;
    if (!expected) {
      if (process.env.NODE_ENV === "production") {
        throw new InternalServerErrorException(
          "INTERNAL_SERVICE_KEY must be configured for the agent runtime worker"
        );
      }
      return;
    }
    if (internalServiceKey !== expected) {
      throw new UnauthorizedException("Invalid internal service key");
    }
  }
}
