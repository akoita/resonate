/**
 * ADK-based music curation agent.
 *
 * Uses Google's Agent Development Kit to declaratively define tools and
 * system instructions. ADK handles the tool-calling loop, retries, and
 * response extraction natively — replacing the manual loop in VertexAiAdapter.
 *
 * NOTE: @google/adk is loaded lazily via dynamic import() to avoid breaking
 * Jest, which cannot parse its ESM-only transitive dependencies.
 */
import { z } from "zod";
import { ToolRegistry } from "../tools/tool_registry";
import type { AgentRuntimeInput } from "./agent_runtime.adapter";

// Lazily-resolved ADK module
let _adkModule: typeof import("@google/adk") | null = null;
async function getAdk() {
  if (!_adkModule) _adkModule = await import("@google/adk");
  return _adkModule;
}

// ---------------------------------------------------------------------------
// Tool definitions — each delegates to the existing ToolRegistry
// ---------------------------------------------------------------------------

async function buildTools(tools: ToolRegistry) {
  const { FunctionTool } = await getAdk();
  const catalogSearch = new FunctionTool({
    name: "catalog_search",
    description:
      "Search the music catalog for tracks matching a query. " +
      "Returns a list of track objects with id, title, genre, artwork, and hasListing (boolean). " +
      "Tracks with hasListing=true are available for on-chain purchase. " +
      "Prefer tracks where hasListing is true.",
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
      "Returns the price in USD. Use this to check if a track fits within the remaining budget.",
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

  return [catalogSearch, pricingQuote, analyticsSignal, embeddingsSimilarity];
}

// ---------------------------------------------------------------------------
// System prompt — identical to the one in VertexAiAdapter
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
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
    "- STRONGLY PREFER tracks where hasListing is true — these can be purchased on-chain.",
    "- Only recommend tracks without listings if no listed alternatives exist.",
    "- Include EVERY listed track that matches the desired taste.",
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

// ---------------------------------------------------------------------------
// User message builder — identical to VertexAiAdapter.buildUserMessage
// ---------------------------------------------------------------------------

export function buildUserMessage(input: AgentRuntimeInput): string {
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

// ---------------------------------------------------------------------------
// Factory — creates the LlmAgent for use by the adapter
// ---------------------------------------------------------------------------

export async function createCurationAgent(toolRegistry: ToolRegistry) {
  const { LlmAgent } = await getAdk();
  const modelName = process.env.VERTEX_AI_MODEL ?? "gemini-2.5-flash";
  return new LlmAgent({
    name: "resonate_curation_agent",
    model: modelName,
    description: "AI DJ agent that curates music tracks based on user preferences, budget, and catalog availability.",
    instruction: buildSystemPrompt(),
    tools: await buildTools(toolRegistry),
  });
}
