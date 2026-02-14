/**
 * Converts ToolRegistry tools into Gemini function declarations
 * and provides a dispatcher for executing Gemini function calls.
 */
import { type FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { ToolRegistry } from "./tool_registry";

/**
 * Returns Gemini-compatible function declarations for all agent tools.
 * These are passed to the model so it can call them during reasoning.
 */
export function getToolDeclarations(): FunctionDeclaration[] {
  return [
    {
      name: "catalog_search",
      description:
        "Search the music catalog for tracks matching a query. " +
        "Returns a list of track objects with id, title, genre, artwork, and hasListing (boolean). " +
        "Tracks with hasListing=true are available for on-chain purchase. " +
        "Prefer tracks where hasListing is true.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          query: {
            type: SchemaType.STRING,
            description:
              "Search query — a genre name, mood, artist style, or keyword (e.g. 'deep house', 'chill lo-fi')",
          },
          limit: {
            type: SchemaType.NUMBER,
            description: "Maximum number of results to return (1-50, default 20)",
          },
          allowExplicit: {
            type: SchemaType.BOOLEAN,
            description: "Whether to include explicit tracks (default false)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "pricing_quote",
      description:
        "Get the price for a specific license type. " +
        "Returns the price in USD. Use this to check if a track fits within the remaining budget.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          licenseType: {
            type: SchemaType.STRING,
            description: "License type: 'personal', 'remix', or 'commercial'",
          },
          volume: {
            type: SchemaType.BOOLEAN,
            description: "Whether to apply volume discount (default false)",
          },
        },
        required: ["licenseType"],
      },
    },
    {
      name: "analytics_signal",
      description:
        "Get analytics signals for a track — play count and popularity score. " +
        "Use this to assess track popularity before recommending.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          trackId: {
            type: SchemaType.STRING,
            description: "The track ID to look up analytics for",
          },
        },
        required: ["trackId"],
      },
    },
    {
      name: "embeddings_similarity",
      description:
        "Rank a set of candidate tracks by semantic similarity to a query. " +
        "Returns candidates ordered from most to least similar. " +
        "Use this to find the best match when you have multiple candidates.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          query: {
            type: SchemaType.STRING,
            description: "The mood/genre/vibe query to match against",
          },
          candidates: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: "Array of track IDs to rank",
          },
        },
        required: ["query", "candidates"],
      },
    },
  ];
}

/**
 * Maps a Gemini function call name back to the ToolRegistry name.
 * Gemini doesn't allow dots in function names, so we use underscores.
 */
function toRegistryName(geminiName: string): string {
  return geminiName.replace("_", ".");
}

/**
 * Executes a Gemini function call by dispatching to the matching ToolRegistry tool.
 * Returns the tool output as a JSON-serializable object.
 */
export async function executeTool(
  registry: ToolRegistry,
  functionCall: { name: string; args: Record<string, unknown> }
): Promise<Record<string, unknown>> {
  const registryName = toRegistryName(functionCall.name);
  const tool = registry.get(registryName);
  const result = await tool.run(functionCall.args);
  return result;
}
