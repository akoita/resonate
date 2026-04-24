# Resonate MCP Module

This module exposes Resonate through the Model Context Protocol (MCP).

Current surface:

- Endpoint: `POST /mcp`
- Curl-friendly capability check: `GET /mcp`
- Discovery metadata: `GET /.well-known/mcp.json`
- Tools:
  - `catalog.search(query, limit)`
  - `stem.quote(stemId, licenseType)`
  - `stem.download(stemId, licenseType, paymentProof)`
- Auth: no user JWT required
- Payment: x402 quote-pay-confirm for `stem.download`

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

`stem.quote` is free. It returns `{ priceUsdc, expiresAt, paymentChallenge }`,
where `paymentChallenge` contains the facilitator URL and x402 payment
requirements. `stem.download` validates a `paymentProof`; without one it returns
an MCP tool error with `code: "PAYMENT_REQUIRED"` and the same quote challenge.
With a valid proof, it returns an embedded MCP resource for the purchased stem.

Quick route check:

```bash
curl http://localhost:3000/mcp
curl http://localhost:3000/.well-known/mcp.json
```

Initialize handshake:

```bash
curl -s http://localhost:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.1"}}}'
```

Verify with MCP Inspector:

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

Claude Desktop, Cursor, and the TypeScript smoke client are documented in
`docs/architecture/mcp_server.md`.
