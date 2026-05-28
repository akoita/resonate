# MCP Server

Resonate exposes a Model Context Protocol server for catalog discovery and
paid stem licensing tools. The server is HTTP-native, requires no Resonate user
JWT, and uses x402 inside the tool protocol for paid downloads.

## Endpoints

| Route | Purpose |
| --- | --- |
| `POST /mcp` | MCP Streamable HTTP transport |
| `GET /mcp` | Curl-friendly capability check |
| `GET /.well-known/mcp.json` | Client discovery metadata convention |

`/.well-known/mcp.json` is ecosystem compatibility metadata, not a core MCP
spec requirement. The authoritative live capability source is still the MCP
`initialize` response and subsequent `tools/list` call.

`GET /mcp` and `/.well-known/mcp.json` also expose Resonate-specific
capability metadata for external agents:

- capability schema version;
- tool details and versions;
- supported license tiers;
- x402 payment asset, network, facilitator, and retry headers;
- stable error codes with recovery hints;
- links to OpenAPI, x402, registry, and external-agent contract docs.

## Tools

| Tool | Payment | Purpose |
| --- | --- | --- |
| `catalog.search(query, limit)` | Free | Search public release cards |
| `stem.quote(stemId, licenseType)` | Free | Return a USDC quote and x402 challenge |
| `stem.download(stemId, licenseType, paymentProof)` | x402 | Validate proof and return the purchased stem resource |

`stem.download` does not use HTTP-level 402 at `/mcp`. Missing proofs return an
MCP tool error with `code: "PAYMENT_REQUIRED"` and the same challenge shape as
`stem.quote`. Invalid proofs, facilitator failures, settlement failures, missing
stems, and unavailable resources return stable MCP tool error codes with
machine-readable recovery hints.

Stable error codes and receipt expectations for external agents are documented
in [External Agent Application Contract](external_agent_application_contract.md).

## 30-second local check

Start the backend, then:

```bash
export RESONATE_MCP_URL="${RESONATE_MCP_URL:-http://localhost:3000/mcp}"

curl http://localhost:3000/.well-known/mcp.json
curl http://localhost:3000/mcp
npx @modelcontextprotocol/inspector "$RESONATE_MCP_URL"
```

## Codex

Codex supports Streamable HTTP MCP servers:

```bash
codex mcp add resonate-local --url http://localhost:3000/mcp
codex mcp list
```

Equivalent `~/.codex/config.toml` entry:

```toml
[mcp_servers.resonate-local]
url = "http://localhost:3000/mcp"
```

## Claude Desktop

For Claude Desktop builds that support HTTP MCP servers, add this to the
Claude Desktop config JSON and restart the app:

```json
{
  "mcpServers": {
    "resonate-local": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Cursor

For Cursor builds that support HTTP MCP servers, add this to `.cursor/mcp.json`
or the equivalent user-level MCP config:

```json
{
  "mcpServers": {
    "resonate-local": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Example client

The repo includes a small smoke client:

```bash
cd examples/mcp-client
npm install
RESONATE_MCP_URL=http://localhost:3000/mcp npm run smoke
```

It connects to `/mcp`, lists tools, and calls `catalog.search`. When
`RESONATE_MCP_STEM_ID` is set, it also calls `stem.quote` and demonstrates the
missing-proof `PAYMENT_REQUIRED` recovery path. `RESONATE_MCP_PAYMENT_PROOF`
enables an explicit paid `stem.download` attempt and prints a receipt summary
without dumping proof-bearing fields or audio blobs.
