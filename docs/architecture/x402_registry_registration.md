# x402 Registry Submission Receipt

Issue: [#520](https://github.com/akoita/resonate/issues/520)
Current follow-up: [#783](https://github.com/akoita/resonate/issues/783)

## Current Status

The app-side machine-first surfaces have been implemented, but registry
validation is intentionally deferred because the staging web/API hosts are not
supposed to be publicly published at this stage. Staging is kept down/private
while the project is not ready to absorb large public traffic or adversarial
probing.

Rechecked at: `2026-05-09T14:28:00Z`

| URL | Result |
| --- | --- |
| `https://api-staging.resonate.pydes.xyz/openapi.json` | HTTP 404 |
| `https://api-staging.resonate.pydes.xyz/.well-known/x402` | HTTP 404 |
| `https://api-staging.resonate.pydes.xyz/.well-known/mcp.json` | HTTP 404 |
| `https://api-staging.resonate.pydes.xyz/api/storefront/stems?limit=1` | HTTP 404 |

These 404s are not a product bug to fix by republishing staging. They are the
current operational posture for both `staging.resonate.pydes.xyz` and
`api-staging.resonate.pydes.xyz` until there is a hardened public validation
window or production launch target with capacity and abuse controls in place.

## Previous Submission Attempt

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

To complete registry validation, choose an intentional public validation origin
or launch window and deploy with:

```env
X402_ENABLED=true
X402_NETWORK=eip155:84532
X402_FACILITATOR_URL=https://x402.org/facilitator
X402_PAYOUT_ADDRESS=<base-sepolia-wallet>
```

Those values are defined in `resonate-iac`, which owns Cloud Run service
configuration. Do not use the current staging host as an always-on public
registration target until capacity, rate limiting, abuse monitoring, and
adversarial-traffic readiness are explicitly in place. After an intentional
public validation deploy, rerun both submissions and update this receipt with
the successful resource count or registry ID.

The current tracker for this deployment/registry follow-up is
[#783](https://github.com/akoita/resonate/issues/783). The parent AgentCash epic
[#499](https://github.com/akoita/resonate/issues/499) should remain open until
that validation is complete or explicitly moved to a separate operational
roadmap.
