import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcpUrl = process.env.RESONATE_MCP_URL ?? "http://localhost:3000/mcp";
const query = process.env.RESONATE_MCP_QUERY ?? "resonate";
const limit = Number(process.env.RESONATE_MCP_LIMIT ?? 3);

if (!Number.isInteger(limit) || limit < 1) {
  throw new Error("RESONATE_MCP_LIMIT must be a positive integer");
}

const client = new Client({
  name: "resonate-mcp-client-example",
  version: "0.1.0",
});

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(
    JSON.stringify(
      {
        mcpUrl,
        tools: tools.tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
        })),
      },
      null,
      2,
    ),
  );

  const searchResult = await client.callTool({
    name: "catalog.search",
    arguments: { query, limit },
  });

  console.log(JSON.stringify({ catalogSearch: searchResult }, null, 2));
}

try {
  await main();
} finally {
  await client.close();
}
