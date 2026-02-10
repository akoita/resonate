import { Injectable, Logger } from "@nestjs/common";
import {
  GoogleGenerativeAI,
  type Content,
  type Part,
  type FunctionCall,
} from "@google/generative-ai";
import {
  AgentRuntimeAdapter,
  AgentRuntimeInput,
  AgentRuntimeResult,
  LlmTrackPick,
} from "./agent_runtime.adapter";
import { ToolRegistry } from "../tools/tool_registry";
import { getToolDeclarations, executeTool } from "../tools/tool_declarations";

const MAX_TOOL_ROUNDS = 6;
const TIMEOUT_MS = 30_000;

@Injectable()
export class VertexAiAdapter implements AgentRuntimeAdapter {
  name: "vertex" = "vertex";
  private readonly logger = new Logger(VertexAiAdapter.name);

  constructor(private readonly tools: ToolRegistry) {}

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    const start = Date.now();
    const apiKey = process.env.GOOGLE_AI_API_KEY;

    if (!apiKey) {
      this.logger.warn("GOOGLE_AI_API_KEY not set — falling back to deterministic orchestrator");
      throw new Error("GOOGLE_AI_API_KEY not configured");
    }

    // Let errors propagate so AgentRuntimeService can fall back to the orchestrator
    return await this.withTimeout(
      this.callGemini(apiKey, input, start),
      TIMEOUT_MS,
      start
    );
  }

  private async callGemini(
    apiKey: string,
    input: AgentRuntimeInput,
    startMs: number
  ): Promise<AgentRuntimeResult> {
    const modelName = process.env.VERTEX_AI_MODEL ?? "gemini-3-flash-preview";
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      tools: [{ functionDeclarations: getToolDeclarations() }],
      systemInstruction: this.buildSystemPrompt(input),
    });

    const chat = model.startChat({ history: [] });

    // Initial user message with session context
    const userMessage = this.buildUserMessage(input);
    let response = await chat.sendMessage(userMessage);

    // Tool calling loop: iterate while model requests function calls
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const candidate = response.response.candidates?.[0];
      if (!candidate) break;

      const functionCalls = this.extractFunctionCalls(candidate.content);
      if (functionCalls.length === 0) break;

      // Execute each function call and collect results
      const functionResponses: Part[] = [];
      for (const fc of functionCalls) {
        this.logger.debug(`Tool call: ${fc.name}(${JSON.stringify(fc.args)})`);
        const toolResult = await executeTool(this.tools, {
          name: fc.name,
          args: fc.args as Record<string, unknown>,
        });
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: toolResult,
          },
        });
      }

      // Send tool results back to the model
      response = await chat.sendMessage(functionResponses);
    }

    // Extract the final text response
    const text = response.response.text?.() ?? "";
    return this.parseResponse(text, input, Date.now() - startMs);
  }

  private extractFunctionCalls(content: Content): FunctionCall[] {
    if (!content?.parts) return [];
    return content.parts
      .filter((p): p is Part & { functionCall: FunctionCall } => !!p.functionCall)
      .map((p) => p.functionCall);
  }

  private buildSystemPrompt(input: AgentRuntimeInput): string {
    return [
      "You are a music curation DJ agent for the Resonate platform.",
      "Your job is to find ALL tracks that match the user's taste and genre preferences.",
      "",
      "You have access to tools to search the catalog, check pricing, get analytics, and rank tracks by similarity.",
      "",
      "Guidelines:",
      "- Use catalog_search to find tracks matching EACH of the user's genre/mood preferences.",
      "- Search for each genre separately to get comprehensive results.",
      "- Use pricing_quote to check if tracks fit within the remaining budget.",
      "- Include EVERY track that matches the desired taste — do not be too selective.",
      "- Avoid recommending tracks the user has recently listened to.",
      "- Stay within the user's budget.",
      "",
      "After using tools, respond with ALL matching tracks.",
      "List each track on its own line using this exact format:",
      "",
      "TRACK: <trackId> | LICENSE: <personal|remix|commercial> | PRICE: <price in USD>",
      "TRACK: <trackId> | LICENSE: <personal|remix|commercial> | PRICE: <price in USD>",
      "...",
      "",
      "Then on a new line:",
      "REASONING: <1-2 sentence explanation of your overall curation strategy>",
    ].join("\n");
  }

  private buildUserMessage(input: AgentRuntimeInput): string {
    const parts: string[] = [
      `Session: ${input.sessionId}`,
      `Budget remaining: $${input.budgetRemainingUsd.toFixed(2)}`,
    ];
    if (input.preferences.mood) {
      parts.push(`Mood: ${input.preferences.mood}`);
    }
    if (input.preferences.energy) {
      parts.push(`Energy: ${input.preferences.energy}`);
    }
    if (input.preferences.genres?.length) {
      parts.push(`Genres: ${input.preferences.genres.join(", ")}`);
    }
    if (input.preferences.licenseType) {
      parts.push(`License type: ${input.preferences.licenseType}`);
    }
    if (input.recentTrackIds.length > 0) {
      parts.push(
        `Recently played (avoid these): ${input.recentTrackIds.join(", ")}`
      );
    }
    parts.push("", "Please find and recommend the best tracks for me.");
    return parts.join("\n");
  }

  private parseResponse(
    text: string,
    input: AgentRuntimeInput,
    latencyMs: number
  ): AgentRuntimeResult {
    // Parse multiple TRACK lines: "TRACK: <id> | LICENSE: <type> | PRICE: <price>"
    const trackPattern = /TRACK:\s*(.+?)\s*\|\s*LICENSE:\s*(\w+)\s*\|\s*PRICE:\s*\$?([\d.]+)/gi;
    const picks: LlmTrackPick[] = [];
    let budgetLeft = input.budgetRemainingUsd;
    let match: RegExpExecArray | null;

    while ((match = trackPattern.exec(text)) !== null) {
      const trackId = match[1].trim();
      const licenseType = (match[2].trim().toLowerCase()) as "personal" | "remix" | "commercial";
      const priceUsd = parseFloat(match[3]);

      if (trackId && priceUsd <= budgetLeft) {
        picks.push({ trackId, licenseType, priceUsd });
        budgetLeft -= priceUsd;
      }
    }

    // Fallback: try the old single-line format for backward compatibility
    if (picks.length === 0) {
      const trackMatch = text.match(/TRACK:\s*(.+)/i);
      const licenseMatch = text.match(/LICENSE:\s*(.+)/i);
      const priceMatch = text.match(/PRICE:\s*\$?([\d.]+)/i);

      const trackId = trackMatch?.[1]?.trim();
      if (trackId) {
        const licenseType = (licenseMatch?.[1]?.trim() ?? "personal") as "personal" | "remix" | "commercial";
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

    this.logger.log(`LLM selected ${picks.length} track(s) in ${latencyMs}ms`);

    return {
      status: "approved",
      // Keep first pick for backward compatibility
      trackId: picks[0].trackId,
      licenseType: picks[0].licenseType,
      priceUsd: picks[0].priceUsd,
      reason: "vertex_llm",
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
        this.logger.warn(`Gemini call timed out after ${ms}ms — falling back to deterministic orchestrator`);
        reject(new Error(`Gemini timeout after ${ms}ms`));
      }, ms);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          this.logger.error(`Gemini call error: ${err.message}`);
          reject(err);
        });
    });
  }
}
