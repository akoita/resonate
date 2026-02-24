/**
 * ADK-based adapter for the agent runtime.
 *
 * Uses InMemoryRunner + InMemorySessionService to run the curation agent.
 * ADK handles the tool-calling loop, retries, and conversation management.
 *
 * NOTE: @google/adk and @google/genai are loaded lazily via dynamic import()
 * to avoid breaking Jest, which cannot parse their ESM-only transitive deps.
 */
import { Injectable, Logger } from "@nestjs/common";
import {
  AgentRuntimeAdapter,
  AgentRuntimeInput,
  AgentRuntimeResult,
  LlmTrackPick,
} from "./agent_runtime.adapter";
import { ToolRegistry } from "../tools/tool_registry";

const TIMEOUT_MS = 30_000;
const APP_NAME = "resonate";

// Lazily-resolved ADK modules
let _adkModule: typeof import("@google/adk") | null = null;
async function getAdk() {
  if (!_adkModule) _adkModule = await import("@google/adk");
  return _adkModule;
}

@Injectable()
export class AdkAdapter implements AgentRuntimeAdapter {
  name: "adk" = "adk";
  private readonly logger = new Logger(AdkAdapter.name);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private runner: any = null;

  constructor(private readonly tools: ToolRegistry) {}

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    const start = Date.now();
    const apiKey = process.env.GOOGLE_AI_API_KEY;

    if (!apiKey) {
      this.logger.warn(
        "GOOGLE_AI_API_KEY not set — falling back to deterministic orchestrator"
      );
      throw new Error("GOOGLE_AI_API_KEY not configured");
    }

    // Set the API key for the ADK's underlying Gemini model
    process.env.GOOGLE_GENAI_API_KEY = apiKey;

    return this.withTimeout(this.callAgent(input, start), TIMEOUT_MS, start);
  }

  private async getRunner() {
    if (!this.runner) {
      const adk = await getAdk();
      const { createCurationAgent } = await import("./adk_curation_agent");
      const agent = await createCurationAgent(this.tools);
      this.runner = new adk.InMemoryRunner({ agent, appName: APP_NAME });
    }
    return this.runner;
  }

  private async callAgent(
    input: AgentRuntimeInput,
    startMs: number
  ): Promise<AgentRuntimeResult> {
    const adk = await getAdk();
    const { buildUserMessage } = await import("./adk_curation_agent");
    const runner = await this.getRunner();
    const userMessage = buildUserMessage(input);

    // Create a fresh ADK session for each stateless invocation
    const adkSessionId = `adk_${input.sessionId}_${Date.now()}`;
    await runner.sessionService.createSession({
      appName: APP_NAME,
      userId: input.userId,
      sessionId: adkSessionId,
    });

    const newMessage = {
      role: "user" as const,
      parts: [{ text: userMessage }],
    };

    // Collect the final text from the event stream
    let finalText = "";
    for await (const event of runner.runAsync({
      userId: input.userId,
      sessionId: adkSessionId,
      newMessage,
    })) {
      this.logger.debug(
        `ADK event: author=${event.author} final=${adk.isFinalResponse(event)}`
      );
      if (adk.isFinalResponse(event)) {
        finalText = adk.stringifyContent(event);
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
    let budgetLeft = input.budgetRemainingUsd;
    let match: RegExpExecArray | null;

    while ((match = trackPattern.exec(text)) !== null) {
      const trackId = match[1].trim();
      const licenseType = match[2].trim().toLowerCase() as
        | "personal"
        | "remix"
        | "commercial";
      const priceUsd = parseFloat(match[3]);

      if (trackId && priceUsd <= budgetLeft) {
        picks.push({ trackId, licenseType, priceUsd });
        budgetLeft -= priceUsd;
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
        if (priceUsd <= input.budgetRemainingUsd) {
          picks.push({ trackId, licenseType, priceUsd });
        }
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

    this.logger.log(`ADK selected ${picks.length} track(s) in ${latencyMs}ms`);

    return {
      status: "approved",
      trackId: picks[0].trackId,
      licenseType: picks[0].licenseType,
      priceUsd: picks[0].priceUsd,
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
        reject(new Error(`ADK timeout after ${ms}ms`));
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
