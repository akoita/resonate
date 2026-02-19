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

// ---------------------------------------------------------------------------
// Tool definitions — each delegates to the existing ToolRegistry
// ---------------------------------------------------------------------------

function buildTools(tools: ToolRegistry, userId: string): FunctionTool[] {
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

  // -------------------------------------------------------------------------
  // Lyria Generation Tools — new for #335
  // -------------------------------------------------------------------------

  const generateTrack = new FunctionTool({
    name: "generate_track",
    description:
      "Generate a new 30-second track matching a mood/genre/description using Lyria 3. " +
      "Costs $0.06 per generation. Use this when the catalog is sparse for the desired vibe. " +
      "Returns a jobId that can be tracked. The generated track will be stored automatically.",
    parameters: z.object({
      prompt: z
        .string()
        .describe(
          "Description of the track to generate (e.g. 'ambient deep house with warm pads and subtle percussion')"
        ),
      negativePrompt: z
        .string()
        .optional()
        .describe("What to avoid in the generation (e.g. 'harsh distortion, screaming')"),
      style: z
        .string()
        .optional()
        .describe("Style hint appended to prompt (e.g. 'lo-fi', 'cinematic')"),
    }),
    execute: async (args) => {
      const prompt = args.style ? `${args.prompt} (style: ${args.style})` : args.prompt;
      const result = await tools.get("generation.create").run({
        userId,
        prompt,
        negativePrompt: args.negativePrompt,
      });
      return result;
    },
  });

  const generateComplementaryStem = new FunctionTool({
    name: "generate_complementary_stem",
    description:
      "Generate a stem that complements existing stems (e.g., bass line for a track with only vocals+drums). " +
      "Costs $0.06 per generation. Use this to fill gaps in a mix when a track is missing key elements.",
    parameters: z.object({
      context: z
        .string()
        .describe(
          "Description of the musical context (e.g. 'upbeat house track at 124 BPM')"
        ),
      stemType: z
        .string()
        .describe("Type of stem to generate: 'bass', 'drums', 'synth', 'pad', 'fx', 'melody'"),
      existingStems: z
        .array(z.string())
        .describe("Array of stem types already present (e.g. ['vocals', 'drums'])"),
    }),
    execute: async (args) => {
      const result = await tools.get("generation.complementary").run({
        userId,
        context: args.context,
        stemType: args.stemType,
        existingStems: args.existingStems,
      });
      return result;
    },
  });

  return [
    catalogSearch,
    pricingQuote,
    analyticsSignal,
    embeddingsSimilarity,
    generateTrack,
    generateComplementaryStem,
  ];
}

// ---------------------------------------------------------------------------
// System prompt — updated for generation capability
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return [
    "You are a creative music curation DJ agent for the Resonate platform.",
    "Your job is to find and create the best possible music session for the user.",
    "",
    "You have access to tools to search the catalog, check pricing, get analytics,",
    "rank tracks by similarity, AND generate new audio content using Lyria 3.",
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
    "Generation Guidelines (NEW):",
    "- If catalog search results are sparse (fewer than 3 good matches), use generate_track to create complementary content.",
    "- Use generate_complementary_stem to fill gaps (e.g., missing bass line for a track).",
    "- Each generation costs $0.06 — track this against the generation budget.",
    "- STOP generating when the generation budget is exhausted.",
    "- PREFER catalog tracks over generated ones — generation is a last resort to fill gaps.",
    "- Generated content is tagged with GENERATED: prefix in the response.",
    "",
    "After using tools, respond with ALL matching and generated tracks.",
    "List each track on its own line using this exact format:",
    "",
    "TRACK: <trackId> | LICENSE: <personal|remix|commercial> | PRICE: <price in USD>",
    "GENERATED: <jobId> | COST: <cost in USD> | PROMPT: <brief description>",
    "...",
    "",
    "Then on a new line:",
    "REASONING: <1-2 sentence explanation of your overall curation strategy>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// User message builder — updated with generation budget
// ---------------------------------------------------------------------------

export function buildUserMessage(input: AgentRuntimeInput): string {
  const parts: string[] = [
    `Session: ${input.sessionId}`,
    `Budget remaining: $${input.budgetRemainingUsd.toFixed(2)}`,
  ];
  if (input.generationBudgetUsd !== undefined) {
    parts.push(`Generation budget: $${input.generationBudgetUsd.toFixed(2)} (~${Math.floor(input.generationBudgetUsd / 0.06)} clips available)`);
  }
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
  parts.push("", "Please find and recommend the best tracks for me. If the catalog is sparse for my taste, generate complementary content.");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Factory — creates the LlmAgent for use by the adapter
// ---------------------------------------------------------------------------

export function createCurationAgent(toolRegistry: ToolRegistry, userId: string): LlmAgent {
  const modelName = process.env.VERTEX_AI_MODEL ?? "gemini-2.5-flash";
  return new LlmAgent({
    name: "resonate_curation_agent",
    model: modelName,
    description: "Creative AI DJ agent that curates and generates music tracks based on user preferences, budget, and catalog availability.",
    instruction: buildSystemPrompt(),
    tools: buildTools(toolRegistry, userId),
  });
}
