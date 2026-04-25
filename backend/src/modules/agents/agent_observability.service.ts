import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AgentToolTraceInput {
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: unknown;
  startedAt: Date;
  endedAt: Date;
}

export interface AgentEvaluationTraceInput {
  name: string;
  sessions: unknown[];
  metrics: Record<string, unknown>;
  startedAt: Date;
  endedAt: Date;
}

interface LangfuseConfig {
  enabled: boolean;
  host?: string;
  publicKey?: string;
  secretKey?: string;
  environment?: string;
}

const SENSITIVE_KEY_PATTERN = /(password|secret|token|api[-_]?key|private[-_]?key|authorization|signature)/i;

@Injectable()
export class AgentObservabilityService {
  private readonly logger = new Logger(AgentObservabilityService.name);

  isEnabled(): boolean {
    return this.getConfig().enabled;
  }

  async traceToolCall(input: AgentToolTraceInput): Promise<void> {
    const config = this.getConfig();
    if (!config.enabled) return;

    const traceId = `tool-${randomUUID()}`;
    const spanId = `span-${randomUUID()}`;
    await this.sendBatch(config, [
      {
        id: randomUUID(),
        timestamp: input.startedAt.toISOString(),
        type: "trace-create",
        body: {
          id: traceId,
          name: `agent.tool.${input.toolName}`,
          timestamp: input.startedAt.toISOString(),
          input: sanitize(input.input),
          output: input.error ? undefined : sanitize(input.output),
          metadata: {
            toolName: input.toolName,
            status: input.error ? "error" : "ok",
          },
          environment: config.environment,
        },
      },
      {
        id: randomUUID(),
        timestamp: input.startedAt.toISOString(),
        type: "span-create",
        body: {
          id: spanId,
          traceId,
          name: input.toolName,
          startTime: input.startedAt.toISOString(),
          endTime: input.endedAt.toISOString(),
          input: sanitize(input.input),
          output: input.error ? sanitize(errorMessage(input.error)) : sanitize(input.output),
          level: input.error ? "ERROR" : "DEFAULT",
          statusMessage: input.error ? errorMessage(input.error) : undefined,
          metadata: {
            kind: "agent_tool",
            toolName: input.toolName,
          },
          environment: config.environment,
        },
      },
    ]);
  }

  async traceEvaluation(input: AgentEvaluationTraceInput): Promise<void> {
    const config = this.getConfig();
    if (!config.enabled) return;

    const traceId = `eval-${randomUUID()}`;
    await this.sendBatch(config, [
      {
        id: randomUUID(),
        timestamp: input.startedAt.toISOString(),
        type: "trace-create",
        body: {
          id: traceId,
          name: input.name,
          timestamp: input.startedAt.toISOString(),
          input: sanitize({ sessions: input.sessions }),
          output: sanitize({ metrics: input.metrics }),
          metadata: {
            kind: "agent_evaluation",
            sessionCount: input.sessions.length,
            durationMs: input.endedAt.getTime() - input.startedAt.getTime(),
          },
          environment: config.environment,
        },
      },
      {
        id: randomUUID(),
        timestamp: input.startedAt.toISOString(),
        type: "span-create",
        body: {
          id: `span-${randomUUID()}`,
          traceId,
          name: "agent.evaluate",
          startTime: input.startedAt.toISOString(),
          endTime: input.endedAt.toISOString(),
          input: sanitize({ sessionCount: input.sessions.length }),
          output: sanitize(input.metrics),
          metadata: { kind: "agent_eval_summary" },
          environment: config.environment,
        },
      },
    ]);
  }

  private getConfig(): LangfuseConfig {
    const enabled = process.env.LANGFUSE_ENABLED === "true";
    const host = (process.env.LANGFUSE_BASE_URL ?? process.env.LANGFUSE_HOST)?.replace(/\/+$/, "");
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;

    return {
      enabled: Boolean(enabled && host && publicKey && secretKey),
      host,
      publicKey,
      secretKey,
      environment: normalizeEnvironment(process.env.LANGFUSE_ENVIRONMENT ?? process.env.NODE_ENV),
    };
  }

  private async sendBatch(config: LangfuseConfig, batch: unknown[]): Promise<void> {
    if (!config.host || !config.publicKey || !config.secretKey) return;
    try {
      const response = await fetch(`${config.host}/api/public/ingestion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`,
        },
        body: JSON.stringify({ batch }),
      });
      if (!response.ok) {
        this.logger.warn(`Langfuse ingestion returned ${response.status}`);
      }
    } catch (err) {
      this.logger.warn(`Langfuse ingestion failed: ${errorMessage(err)}`);
    }
  }
}

function sanitize(value: unknown, depth = 0): JsonValue {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > 1_000 ? `${value.slice(0, 1_000)}...[truncated]` : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : sanitize(item, depth + 1),
        ])
    );
  }
  return String(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeEnvironment(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return normalized.startsWith("langfuse") ? `app-${normalized}` : normalized;
}
