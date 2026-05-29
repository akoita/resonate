# Resonate MCP Client Example

This is a small TypeScript smoke client for the Resonate MCP server. It connects
to the Streamable HTTP endpoint, lists tools, calls `catalog.search`, and can
optionally exercise quote, payment-required recovery, and paid receipt parsing
for a known stem.

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
| `RESONATE_MCP_STEM_ID` | unset | Optional stem ID used for `stem.quote` and `stem.download` examples |
| `RESONATE_MCP_LICENSE_TYPE` | `remix` | License tier for optional stem calls: `personal`, `remix`, or `commercial` |
| `RESONATE_MCP_PAYMENT_PROOF` | unset | Optional x402 proof/header used for an explicit paid `stem.download` attempt |

## Flows

### Discovery and catalog search

With no stem environment variables, the smoke command is read-only. It connects
to `/mcp`, lists tools, and calls `catalog.search`.

```bash
RESONATE_MCP_URL=http://localhost:3000/mcp npm run smoke
```

### Quote and payment-required recovery

Set a known public stem ID to run a free quote and then call `stem.download`
without a proof. The expected download response is an MCP tool error with
`PAYMENT_REQUIRED`, a recovery hint, and a fresh x402 challenge.

```bash
RESONATE_MCP_URL=http://localhost:3000/mcp \
RESONATE_MCP_STEM_ID=stem_123 \
RESONATE_MCP_LICENSE_TYPE=remix \
npm run smoke
```

### Paid receipt parsing

Paid download is opt-in. Set `RESONATE_MCP_PAYMENT_PROOF` only when the proof
was created for the current quote's payment requirements. The client redacts
proof-bearing fields and omits binary resource blobs from console output while
printing the receipt ID, encoded receipt presence, license, payment, settlement,
and resource summary.

```bash
RESONATE_MCP_URL=http://localhost:3000/mcp \
RESONATE_MCP_STEM_ID=stem_123 \
RESONATE_MCP_LICENSE_TYPE=remix \
RESONATE_MCP_PAYMENT_PROOF="$PAYMENT_SIGNATURE" \
npm run smoke
```

## Typecheck

```bash
npm run typecheck
```
