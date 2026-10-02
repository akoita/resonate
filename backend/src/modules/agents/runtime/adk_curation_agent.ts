/**
 * ADK-based music curation agent.
 *
 * Uses Google's Agent Development Kit to declaratively define tools and
 * system instructions. ADK handles the tool-calling loop, retries, and
 * response extraction natively — replacing the manual loop in VertexAiAdapter.
 */
import { FunctionTool, LlmAgent } from "@google/adk";
import { z } from "zod";
import { ToolRegistry } from "../tools/tool_registry";
import type { AgentRuntimeInput } from "./agent_runtime.adapter";
import { getAgentTrackLimit } from "../agent_runtime.config";
import { describeTempoRange } from "../agent_session_request";

// ---------------------------------------------------------------------------
// Tool definitions — each delegates to the existing ToolRegistry
// ---------------------------------------------------------------------------

function buildTools(tools: ToolRegistry): FunctionTool[] {
  const catalogSearch = new FunctionTool({
    name: "catalog_search",
    description:
      "Search the music catalog for tracks matching a query. " +
      "Returns a list of track objects with id, title, genre, artwork, and hasListing (boolean). " +
      "hasListing=true means a stem of the track is listed for sale; it says nothing about how well " +
      "the track fits the listener, so never use it to rank or choose tracks.",
    parameters: z.object({
      query: z
        .string()
        .describe(
          "Search query — a genre name, mood, artist style, or keyword (e.g. 'deep house', 'chill lo-fi')"
        ),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of results to return (1-50, default 20)"),
      allowExplicit: z
        .boolean()
        .optional()
        .describe("Whether to include explicit tracks (default false)"),
    }),
    execute: async (args) => {
      const result = await tools.get("catalog.search").run(args);
      return result;
    },
  });

  const pricingQuote = new FunctionTool({
    name: "pricing_quote",
    description:
      "Get the price for a specific license type. " +
      "Returns the price in USD.",
    parameters: z.object({
      licenseType: z
        .string()
        .describe("License type: 'personal', 'remix', or 'commercial'"),
      volume: z
        .boolean()
        .optional()
        .describe("Whether to apply volume discount (default false)"),
    }),
    execute: async (args) => {
      const result = await tools.get("pricing.quote").run(args);
      return result;
    },
  });

  const analyticsSignal = new FunctionTool({
    name: "analytics_signal",
    description:
      "Get analytics signals for a track — play count and popularity score. " +
      "Use this to assess track popularity before recommending.",
    parameters: z.object({
      trackId: z
        .string()
        .describe("The track ID to look up analytics for"),
    }),
    execute: async (args) => {
      const result = await tools.get("analytics.signal").run(args);
      return result;
    },
  });

  const embeddingsSimilarity = new FunctionTool({
    name: "embeddings_similarity",
    description:
      "Rank a set of candidate tracks by semantic similarity to a query. " +
      "Returns candidates ordered from most to least similar. " +
      "Use this to find the best match when you have multiple candidates.",
    parameters: z.object({
      query: z
        .string()
        .describe("The mood/genre/vibe query to match against"),
      candidates: z
        .array(z.string())
        .describe("Array of track IDs to rank"),
    }),
    execute: async (args) => {
      const result = await tools.get("embeddings.similarity").run(args);
      return result;
    },
  });

  return [
    catalogSearch,
    pricingQuote,
    analyticsSignal,
    embeddingsSimilarity,
  ];
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return [
    "You are a creative music curation DJ agent for the Resonate platform.",
    "Your job is to find the best possible music session for the user from the existing catalog.",
    "",
    "You have access to tools to search the catalog, check pricing, get analytics,",
    "and rank tracks by similarity.",
    "",
    "Guidelines:",
    "- Use catalog_search to find tracks matching EACH of the user's genre/mood preferences.",
    "- Search for each genre separately to get comprehensive results.",
    "- Choose tracks only by how well they fit the listener's taste, mood and energy.",
    "- hasListing is purchase availability data, not a quality signal: never prefer or avoid a track because of it.",
    "- Recommend only the strongest matching tracks; do not dump the whole catalog.",
    "- If a genre search returns no tracks, treat that as no match for that genre.",
    "- Avoid recommending tracks the user has recently listened to.",
    "",
    "- Never generate audio; if the catalog cannot fill the request, return fewer tracks.",
    "",
    "After using tools, respond with a concise ranked shortlist of matching catalog tracks.",
    "List each track on its own line using this exact format:",
    "",
    "TRACK: <trackId> | LICENSE: <personal|remix|commercial> | PRICE: <price in USD>",
    "...",
    "",
    "Then on a new line:",
    "REASONING: <1-2 sentence explanation of your overall curation strategy>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// User message builder
// ---------------------------------------------------------------------------

export function buildUserMessage(input: AgentRuntimeInput): string {
  const parts: string[] = [
    `Session: ${input.sessionId}`,
    `Selection target: up to ${getAgentTrackLimit()} tracks`,
  ];
  if (input.preferences.mood) {
    parts.push(`Mood: ${input.preferences.mood}`);
  }
  if (input.preferences.energy) {
    parts.push(`Energy: ${input.preferences.energy}`);
  }
  if (input.preferences.moods?.length) {
    parts.push(`Moods: ${input.preferences.moods.join(", ")}`);
  }
  if (input.preferences.tempoBpm) {
    const tempo = describeTempoRange(input.preferences.tempoBpm);
    if (tempo) parts.push(`Tempo: ${tempo}`);
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
  parts.push("", "Please find and recommend the best tracks for me. If the catalog is sparse for my taste, return fewer tracks.");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Factory — creates the LlmAgent for use by the adapter
// ---------------------------------------------------------------------------

export function createCurationAgent(toolRegistry: ToolRegistry): LlmAgent {
  const modelName = process.env.VERTEX_AI_MODEL ?? "gemini-2.5-flash";
  return new LlmAgent({
    name: "resonate_curation_agent",
    model: modelName,
    description: "AI DJ agent that curates catalog tracks based on user preferences and catalog availability.",
    instruction: buildSystemPrompt(),
    tools: buildTools(toolRegistry),
  });
}
