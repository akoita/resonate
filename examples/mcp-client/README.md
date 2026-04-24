# Resonate MCP Client Example

This is a small TypeScript smoke client for the Resonate MCP server. It connects
to the Streamable HTTP endpoint, lists tools, and calls `catalog.search`.

```bash
cd examples/mcp-client
npm install
RESONATE_MCP_URL=http://localhost:3000/mcp npm run smoke
```

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RESONATE_MCP_URL` | `http://localhost:3000/mcp` | MCP Streamable HTTP endpoint |
| `RESONATE_MCP_QUERY` | `resonate` | Query passed to `catalog.search` |
| `RESONATE_MCP_LIMIT` | `3` | Result limit passed to `catalog.search` |

Paid downloads are intentionally not executed here. The example only verifies
the public discovery path; `stem.download` requires an x402 payment proof.
