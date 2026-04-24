# Resonate MCP Module

This module exposes Resonate through the Model Context Protocol (MCP).

PR 1 intentionally keeps the surface small and read-only:

- Endpoint: `POST /mcp`
- Curl-friendly capability check: `GET /mcp`
- Tool: `catalog.search(query, limit)`
- Auth: none for this first read-only catalog tool
- Payment: none in PR 1; quote and paid download tools ship later

`catalog.search` returns public release cards with stable fields:

```json
{
  "id": "rel_123",
  "title": "The Horizon Is Home",
  "artist": "Resonate Artist",
  "genre": "electronic",
  "releaseDate": "2026-04-22T00:00:00.000Z",
  "artworkUrl": "http://localhost:3000/catalog/releases/rel_123/artwork",
  "trackCount": 4,
  "licensable": true,
  "deeplink": "http://localhost:3001/release/rel_123"
}
```

Quick route check:

```bash
curl http://localhost:3000/mcp
```

Initialize handshake:

```bash
curl -s http://localhost:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.1"}}}'
```

Verify PR 1 with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

Verify with Codex as an MCP client:

```bash
codex mcp add resonate-local --url http://localhost:3000/mcp
codex mcp list
```

Equivalent `~/.codex/config.toml` entry:

```toml
[mcp_servers.resonate-local]
url = "http://localhost:3000/mcp"
```

Codex CLI and IDE configuration are shared. Claude Desktop and Cursor configs
are intentionally deferred to PR 3.
