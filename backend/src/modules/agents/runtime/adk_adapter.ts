/**
 * ADK-based adapter for the agent runtime.
 *
 * Uses InMemoryRunner + InMemorySessionService to run the curation agent.
 * ADK handles the tool-calling loop, retries, and conversation management.
 */
import { Injectable, Logger } from "@nestjs/common";
import {
  InMemoryRunner,
  isFinalResponse,
  stringifyContent,
} from "@google/adk";
import type { Content } from "@google/genai";
import {
  AgentRuntimeAdapter,
  AgentRuntimeInput,
  AgentRuntimeResult,
  LlmTrackPick,
} from "./agent_runtime.adapter";
import { ToolRegistry } from "../tools/tool_registry";
import { getAgentTrackLimit } from "../agent_runtime.config";
import { createCurationAgent, buildUserMessage } from "./adk_curation_agent";
import { AgentRuntimeUnavailableError } from "./agent_runtime.errors";

const TIMEOUT_MS = 30_000;
const APP_NAME = "resonate";

@Injectable()
export class AdkAdapter implements AgentRuntimeAdapter {
  name: "adk" = "adk";
  private readonly logger = new Logger(AdkAdapter.name);

  constructor(private readonly tools: ToolRegistry) {}

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    const start = Date.now();
    const apiKey = process.env.GOOGLE_AI_API_KEY;

    if (!apiKey) {
      this.logger.warn(
        "GOOGLE_AI_API_KEY not set — falling back to deterministic orchestrator"
      );
      throw new AgentRuntimeUnavailableError(
        "not_configured",
        "GOOGLE_AI_API_KEY not configured"
      );
    }

    // Set the API key for the ADK's underlying Gemini model
    process.env.GOOGLE_GENAI_API_KEY = apiKey;

    return this.withTimeout(this.callAgent(input, start), TIMEOUT_MS, start);
  }

  private createRunner(input: AgentRuntimeInput): InMemoryRunner {
    // Create a fresh runner per call. The session's explicit-content choice is
    // forced onto every catalog tool call; the model cannot override it.
    const agent = createCurationAgent(this.tools, {
      allowExplicit: input.preferences.allowExplicit ?? false,
      recentTrackIds: input.recentTrackIds,
    });
    return new InMemoryRunner({ agent, appName: APP_NAME });
  }

  // runAsync requires the session to exist in the runner's session service (#2075).
  private async ensureSession(
    runner: InMemoryRunner,
    input: AgentRuntimeInput
  ): Promise<void> {
    const sessionKey = {
      appName: APP_NAME,
      userId: input.userId,
      sessionId: input.sessionId,
    };
    const existing = await runner.sessionService.getSession(sessionKey);
    if (!existing) await runner.sessionService.createSession(sessionKey);
  }

  private async callAgent(
    input: AgentRuntimeInput,
    startMs: number
  ): Promise<AgentRuntimeResult> {
    const runner = this.createRunner(input);
    await this.ensureSession(runner, input);
    const userMessage = buildUserMessage(input);

    const newMessage: Content = {
      role: "user",
      parts: [{ text: userMessage }],
    };

    // Collect the final text from the event stream
    let finalText = "";
    for await (const event of runner.runAsync({
      userId: input.userId,
      sessionId: input.sessionId,
      newMessage,
    })) {
      this.logger.debug(
        `ADK event: author=${event.author} final=${isFinalResponse(event)}`
      );
      if (isFinalResponse(event)) {
        finalText = stringifyContent(event);
      }
    }

    const latencyMs = Date.now() - startMs;
    return this.parseResponse(finalText, input, latencyMs);
  }

  /**
   * Parse the TRACK: / REASONING: output format.
   * Identical logic to VertexAiAdapter.parseResponse.
   */
  private parseResponse(
    text: string,
    input: AgentRuntimeInput,
    latencyMs: number
  ): AgentRuntimeResult {
    const trackPattern =
      /TRACK:\s*(.+?)\s*\|\s*LICENSE:\s*(\w+)\s*\|\s*PRICE:\s*\$?([\d.]+)/gi;
    const picks: LlmTrackPick[] = [];
    const pickLimit = getAgentTrackLimit();
    let match: RegExpExecArray | null;

    while (picks.length < pickLimit && (match = trackPattern.exec(text)) !== null) {
      const trackId = match[1].trim();
      const licenseType = match[2].trim().toLowerCase() as
        | "personal"
        | "remix"
        | "commercial";
      const priceUsd = parseFloat(match[3]);

      // Listening picks are not budget-limited (ADR-TE-1).
      if (trackId) {
        picks.push({ trackId, licenseType, priceUsd });
      }
    }

    // Fallback: single-line format
    if (picks.length === 0) {
      const trackMatch = text.match(/TRACK:\s*(.+)/i);
      const licenseMatch = text.match(/LICENSE:\s*(.+)/i);
      const priceMatch = text.match(/PRICE:\s*\$?([\d.]+)/i);

      const trackId = trackMatch?.[1]?.trim();
      if (trackId) {
        const licenseType = (licenseMatch?.[1]?.trim() ?? "personal") as
          | "personal"
          | "remix"
          | "commercial";
        const priceUsd = priceMatch ? parseFloat(priceMatch[1]) : 0;
        picks.push({ trackId, licenseType, priceUsd });
      }
    }

    const reasoningMatch = text.match(/REASONING:\s*(.+)/i);
    const reasoning = reasoningMatch?.[1]?.trim() ?? text.slice(0, 200);

    if (picks.length === 0) {
      return {
        status: "rejected",
        reason: "llm_no_track_selected",
        reasoning: reasoning || "Could not find suitable tracks",
        latencyMs,
      };
    }

    this.logger.log(
      `ADK selected ${picks.length} track(s) in ${latencyMs}ms`
    );

    return {
      status: "approved",
      trackId: picks[0]?.trackId,
      licenseType: picks[0]?.licenseType,
      priceUsd: picks[0]?.priceUsd,
      reason: "adk_llm",
      reasoning,
      latencyMs,
      picks,
    };
  }

  private withTimeout(
    promise: Promise<AgentRuntimeResult>,
    ms: number,
    startMs: number
  ): Promise<AgentRuntimeResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.logger.warn(
          `ADK call timed out after ${ms}ms — falling back to deterministic orchestrator`
        );
        reject(
          new AgentRuntimeUnavailableError("timeout", `ADK timeout after ${ms}ms`)
        );
      }, ms);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          this.logger.error(`ADK call error: ${err.message}`);
          reject(err);
        });
    });
  }
}
