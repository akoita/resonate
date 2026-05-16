# x402 Registry Submission Receipt

Issue: [#520](https://github.com/akoita/resonate/issues/520)
Current follow-up: [#783](https://github.com/akoita/resonate/issues/783)

## Current Status

The app-side machine-first surfaces have been implemented, but registry
validation is intentionally deferred because staging web/API deployment details
are not published from this public repository. Public validation should wait
until a hardened validation or launch origin is explicitly approved.

Rechecked at: `2026-05-16T12:00:00+02:00`

| Check | App-repo evidence | Public-origin status |
| --- | --- | --- |
| `GET /openapi.json` | `OpenApiController`, `OpenApiService`, `openapi.controller.spec.ts` | Deferred until approved validation origin |
| `GET /.well-known/x402` | `WellKnownController`, `buildWellKnownDocument`, `openapi.controller.spec.ts` | Deferred until approved validation origin |
| `GET /.well-known/mcp.json` | `WellKnownController`, `buildMcpWellKnownDocument`, `openapi.controller.spec.ts` | Deferred until approved validation origin |
| `GET /api/storefront/stems?limit=1` | `StorefrontController`, `StorefrontService`, `storefront.service.spec.ts` | Deferred until seeded public origin |
| `GET /api/stems/:stemId/x402/info` | `X402Controller`, `buildStemX402Quote`, `storefront.service.spec.ts` | Deferred until seeded public origin |
| `GET /api/stems/:stemId/x402` unpaid challenge | `X402Middleware`, `X402PaymentService`, `x402.controller.http.spec.ts` | Deferred until seeded public origin |

These 404s are not a product bug to fix by republishing staging. They are the
current operational posture until there is a hardened public validation window
or production launch target with capacity and abuse controls in place. Concrete
staging URLs and deployment details belong in the private IaC repository.

## #783 Deferral Decision

Issue [#783](https://github.com/akoita/resonate/issues/783) closes the public
app-repo decision to **not** run x402scan, mppscan, Agentic.Market, or
AgentCash registry validation against unpublished staging hosts.

Validation may resume only when all of the following are true:

- An explicit public validation origin and time window are approved by the
  project owner.
- The origin is intended to receive scanner, bot, and adversarial probing
  traffic.
- The backend is deployed with `X402_ENABLED=true`, a valid
  `X402_PAYOUT_ADDRESS`, and either the Base Sepolia or Base x402 profile.
- The public storefront is seeded with at least one clean, purchasable stem that
  has canonical USDC pricing.
- Basic rate limiting, abuse-response ownership, and payment-path observability
  are active for the validation window.
- The validation run records scanner receipts here without publishing private
  staging URLs.

Until those gates are met, the expected result for registry validation is
`Deferred`, not `Failed`.

## Validation Window Runbook

Use this checklist only after the public validation origin/window is approved.
Do not replace `PUBLIC_API_ORIGIN` with a private staging URL in commits, issue
comments, PR descriptions, or public logs.

```bash
export PUBLIC_API_ORIGIN="https://<approved-public-api-origin>"

curl -fsS "$PUBLIC_API_ORIGIN/openapi.json" >/tmp/resonate-openapi.json
curl -fsS "$PUBLIC_API_ORIGIN/.well-known/x402" >/tmp/resonate-x402.json
curl -fsS "$PUBLIC_API_ORIGIN/.well-known/mcp.json" >/tmp/resonate-mcp.json
curl -fsS "$PUBLIC_API_ORIGIN/api/storefront/stems?limit=1" >/tmp/resonate-storefront.json

node - <<'NODE'
const fs = require('node:fs');
const storefront = JSON.parse(fs.readFileSync('/tmp/resonate-storefront.json', 'utf8'));
const stem = storefront.items?.[0];
if (!stem?.id) throw new Error('No public purchasable stem returned');
if (stem.price?.currency !== 'USDC') throw new Error('Stem price is not canonical USDC');
console.log(stem.id);
NODE
```

Then run the concrete-stem payment checks:

```bash
export STEM_ID="<stem-id-from-storefront>"

curl -fsS "$PUBLIC_API_ORIGIN/api/stems/$STEM_ID/x402/info" >/tmp/resonate-x402-info.json
curl -isS "$PUBLIC_API_ORIGIN/api/stems/$STEM_ID/x402" >/tmp/resonate-x402-challenge.txt
grep -i '^HTTP/.* 402' /tmp/resonate-x402-challenge.txt
grep -i '^payment-required:' /tmp/resonate-x402-challenge.txt
```

Only after those checks pass should scanners be pointed at the public origin.
Capture the scanner timestamps, resource counts, origin IDs, and any failure
details in this document.

## Validation Observability Expectations

For the public window, operators should be able to answer:

- How many unpaid x402 challenges were issued per route and stem?
- How many retries used `PAYMENT-SIGNATURE` versus legacy `X-PAYMENT`?
- How many facilitator verification, settlement, and receipt issuance attempts
  succeeded or failed?
- Which failures were expected unpaid probes, invalid proofs, rate limits,
  missing seeded data, or facilitator/network errors?
- Whether scanner traffic caused API latency, error rate, queue depth, or spend
  anomalies outside the documented SLO envelope.

## Previous Submission Attempt

Checked at: `2026-04-26T00:32:49Z`

## Public Metadata

Base URL: `<redacted-staging-api-origin>`

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
<redacted-staging-api-origin>
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
      "url": "<redacted-staging-api-origin>/api/stems/%7BstemId%7D/x402",
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
      "url": "<redacted-staging-api-origin>/api/stems/%7BstemId%7D/x402",
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
<redacted-staging-api-origin>
```

Registration response:

```json
{
  "type": "done",
  "origin": {
    "id": "3ac4b7baee04e69605a7c9f85f35389c583a0634b773ce958ef4a9b309e85247",
    "origin": "<redacted-staging-api-origin>",
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
[#499](https://github.com/akoita/resonate/issues/499) is closed for the shipped
app-foundation work; future public scanner runs are operational launch-window
work and should not reopen private staging details in this public repository.
