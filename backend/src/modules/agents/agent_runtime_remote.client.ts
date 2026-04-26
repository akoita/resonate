import { Injectable, Logger } from "@nestjs/common";
import { fetch } from "undici";
import { AgentRuntimeExecutionResponse } from "./agent_runtime.contract";
import { AgentRuntimeRunResult } from "./agent_runtime.types";
import { AgentRuntimeInput } from "./runtime/agent_runtime.adapter";

@Injectable()
export class AgentRuntimeRemoteClient {
  private readonly logger = new Logger(AgentRuntimeRemoteClient.name);

  get enabled(): boolean {
    return Boolean(this.workerUrl);
  }

  get required(): boolean {
    return process.env.AGENT_RUNTIME_WORKER_REQUIRED === "true";
  }

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeRunResult> {
    const workerUrl = this.workerUrl;
    if (!workerUrl) {
      throw new Error("AGENT_RUNTIME_WORKER_URL is not configured");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (process.env.INTERNAL_SERVICE_KEY) {
        headers["x-internal-service-key"] = process.env.INTERNAL_SERVICE_KEY;
      }

      const response = await fetch(this.executionUrl(workerUrl), {
        method: "POST",
        headers,
        body: JSON.stringify({ input }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `worker responded ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`
        );
      }

      const payload = (await response.json()) as
        | AgentRuntimeExecutionResponse
        | AgentRuntimeRunResult;
      if (isExecutionResponse(payload)) {
        this.logger.debug(
          `agent runtime worker completed request ${payload.requestId} in ${payload.timingMs}ms`
        );
        return payload.result;
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  private get workerUrl(): string | undefined {
    const value = process.env.AGENT_RUNTIME_WORKER_URL?.trim();
    return value ? value.replace(/\/+$/, "") : undefined;
  }

  private get timeoutMs(): number {
    const configured = Number(process.env.AGENT_RUNTIME_WORKER_TIMEOUT_MS ?? 5000);
    return Number.isFinite(configured) && configured > 0 ? configured : 5000;
  }

  private executionUrl(workerUrl: string): string {
    return workerUrl.endsWith("/agent-runtime/execute")
      ? workerUrl
      : `${workerUrl}/agent-runtime/execute`;
  }
}

function isExecutionResponse(value: unknown): value is AgentRuntimeExecutionResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { status?: unknown }).status === "ok" &&
      "result" in value
  );
}
