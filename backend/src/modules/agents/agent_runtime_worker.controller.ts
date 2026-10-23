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
import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time comparison; hashing first gives both sides the same length. */
function internalKeyMatches(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== "string" || !provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

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

  /**
   * The worker runs the model for any `userId` it is given, so it must never be
   * open by accident: without `INTERNAL_SERVICE_KEY` it refuses every request,
   * in every environment. Local development without a key opts in explicitly
   * with `AGENT_RUNTIME_WORKER_ALLOW_UNAUTHENTICATED=true`, which production ignores.
   */
  private assertInternalRequest(internalServiceKey?: string) {
    const expected = process.env.INTERNAL_SERVICE_KEY;
    if (!expected) {
      if (
        process.env.NODE_ENV !== "production" &&
        process.env.AGENT_RUNTIME_WORKER_ALLOW_UNAUTHENTICATED === "true"
      ) {
        return;
      }
      throw new InternalServerErrorException(
        "INTERNAL_SERVICE_KEY must be configured for the agent runtime worker"
      );
    }
    if (!internalKeyMatches(internalServiceKey, expected)) {
      throw new UnauthorizedException("Invalid internal service key");
    }
  }
}
