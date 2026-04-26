import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AgentRuntimeRunResult } from "./agent_runtime.types";
import { AgentRuntimeInput } from "./runtime/agent_runtime.adapter";

export interface AgentRuntimeExecutionRequest {
  requestId?: string;
  input: AgentRuntimeInput;
}

export interface AgentRuntimeExecutionResponse {
  status: "ok";
  requestId: string;
  sessionId: string;
  userId: string;
  result: AgentRuntimeRunResult;
  timingMs: number;
  executedAt: string;
}

export function normalizeAgentRuntimeExecutionRequest(
  body: unknown
): AgentRuntimeExecutionRequest {
  if (!isRecord(body)) {
    throw new BadRequestException("Agent runtime request body must be an object");
  }

  const input = isRecord(body.input) ? body.input : body;
  assertAgentRuntimeInput(input);

  return {
    requestId:
      typeof body.requestId === "string" && body.requestId.trim()
        ? body.requestId
        : randomUUID(),
    input,
  };
}

export function buildAgentRuntimeExecutionResponse(
  request: AgentRuntimeExecutionRequest,
  result: AgentRuntimeRunResult,
  startedAt: number
): AgentRuntimeExecutionResponse {
  return {
    status: "ok",
    requestId: request.requestId ?? randomUUID(),
    sessionId: request.input.sessionId,
    userId: request.input.userId,
    result,
    timingMs: Date.now() - startedAt,
    executedAt: new Date().toISOString(),
  };
}

function assertAgentRuntimeInput(value: unknown): asserts value is AgentRuntimeInput {
  if (!isRecord(value)) {
    throw new BadRequestException("Agent runtime input must be an object");
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    throw new BadRequestException("sessionId is required");
  }
  if (typeof value.userId !== "string" || !value.userId.trim()) {
    throw new BadRequestException("userId is required");
  }
  if (!Array.isArray(value.recentTrackIds)) {
    throw new BadRequestException("recentTrackIds must be an array");
  }
  if (typeof value.budgetRemainingUsd !== "number") {
    throw new BadRequestException("budgetRemainingUsd must be a number");
  }
  if (!isRecord(value.preferences)) {
    throw new BadRequestException("preferences must be an object");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
