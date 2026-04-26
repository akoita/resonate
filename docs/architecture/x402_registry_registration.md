# x402 Registry Submission Receipt

Issue: [#520](https://github.com/akoita/resonate/issues/520)

Checked at: `2026-04-26T00:32:49Z`

## Public Metadata

Base URL: `https://api-staging.resonate.pydes.xyz`

Verified public endpoints:

- `GET /openapi.json` returns the machine-readable OpenAPI contract.
- `GET /.well-known/x402` returns the x402 discovery document.
- `GET /.well-known/mcp.json` returns the MCP discovery document.
- `GET /api/storefront/stems?limit=5` returns live purchasable storefront stems with USDC pricing.

Representative storefront stem used for validation:

- Stem ID: `stem_1777163111376_f0c81f6d`
- Quote URL: `/api/stems/stem_1777163111376_f0c81f6d/x402/info`
- Purchase URL: `/api/stems/stem_1777163111376_f0c81f6d/x402`
- Advertised price: `0.05 USDC`

Discovery advertises `USDC` on Base Sepolia (`eip155:84532`) and points
clients to the paid x402 route plus the free quote route.

## x402scan

Submitted origin:

```text
https://api-staging.resonate.pydes.xyz
```

Discovery probe result:

```json
{
  "found": true,
  "source": "well-known",
  "resourceCount": 1,
  "resources": [
    {
      "method": "GET",
      "url": "https://api-staging.resonate.pydes.xyz/api/stems/%7BstemId%7D/x402",
      "authMode": "paid"
    }
  ]
}
```

Registration mutation receipt:

```json
{
  "success": true,
  "registered": 0,
  "failed": 1,
  "total": 1,
  "source": "well-known",
  "originId": null,
  "failedDetails": [
    {
      "url": "https://api-staging.resonate.pydes.xyz/api/stems/%7BstemId%7D/x402",
      "error": "No valid x402 response found",
      "status": null
    }
  ]
}
```

The request was accepted by x402scan, but the registry could not validate the
paid resource. A concrete staging stem currently returns:

```json
{
  "error": "x402 payments are not enabled on this server"
}
```

for both `/api/stems/stem_1777163111376_f0c81f6d/x402/info` and
`/api/stems/stem_1777163111376_f0c81f6d/x402`.

## mppscan

Submitted origin:

```text
https://api-staging.resonate.pydes.xyz
```

Registration response:

```json
{
  "type": "done",
  "origin": {
    "id": "3ac4b7baee04e69605a7c9f85f35389c583a0634b773ce958ef4a9b309e85247",
    "origin": "https://api-staging.resonate.pydes.xyz",
    "name": "Resonate API"
  },
  "resourceCount": 0
}
```

mppscan created the origin record, but did not register paid resources because
the deployed staging x402 route does not emit a live 402 challenge yet.

## Follow-Up Required

To complete registry validation, deploy staging with:

```env
X402_ENABLED=true
X402_NETWORK=eip155:84532
X402_FACILITATOR_URL=https://x402.org/facilitator
X402_PAYOUT_ADDRESS=<base-sepolia-wallet>
```

Those values are defined in `resonate-iac`, which owns Cloud Run service
configuration. After redeploy, rerun both submissions and update this receipt
with the successful resource count or registry ID.
