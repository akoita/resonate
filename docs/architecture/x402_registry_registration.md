# x402 Registry Submission Receipt

Issue: [#520](https://github.com/akoita/resonate/issues/520)
Current follow-up: [#783](https://github.com/akoita/resonate/issues/783)
External agent UX tracker: [#1006](https://github.com/akoita/resonate/issues/1006)

## Current Status

The app-side machine-first surfaces have been implemented, but registry
validation is intentionally deferred because staging web/API deployment details
are not published from this public repository. Public validation should wait
until a hardened validation or launch origin is explicitly approved.

Rechecked at: `2026-05-29T00:00:00+02:00`

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

## #1006 Acceptance Mapping

Issue [#1006](https://github.com/akoita/resonate/issues/1006) treats registry
validation as part of the external agent application journey, but not as a
reason to publish private staging details. The registry-related acceptance
criteria map to this document as follows:

| #1006 requirement | Registry validation expectation |
| --- | --- |
| Discovery metadata lists capabilities, versions, docs, payment assets, and supported networks. | `/.well-known/x402`, `/.well-known/mcp.json`, `/mcp`, and `/openapi.json` must be reachable from the approved public origin before scanners run. |
| Paid and irreversible flows have a free quote or dry-run path before spend. | `GET /api/stems/:stemId/x402/info` and MCP `stem.quote` must return a current quote for the same seeded stem used by scanner checks. |
| Agent-facing errors use stable codes plus recovery guidance. | MCP `stem.download` missing-proof and invalid-proof probes should return stable error codes and recovery hints; HTTP x402 probes should return protocol-correct 402 challenges or documented failure bodies. |
| Paid stem download is documented and tested as retry-safe/idempotent. | Operators must capture challenge, verification, settlement, and receipt evidence for the same stem without serving a resource after failed verification or failed settlement. |
| Receipt shape is documented for machine storage and human explanation. | Successful paid validation must record receipt ID, encoded receipt presence, license key, payment asset, settlement status, and resource metadata. |
| Example clients cover discovery, quote, payment-required, receipt parsing, and retry behavior. | The MCP example client can be pointed at the approved public origin for discovery, quote, missing-proof recovery, and opt-in paid receipt parsing. |
| Public registry validation remains deferred until a hardened validation origin/window is approved and observable. | This document remains the source of truth for `Deferred`, `Ready`, `Running`, `Passed`, or `Failed` registry status. |

## Public Validation Readiness Checklist

Use this checklist before changing registry status from `Deferred` to `Ready`.
All items should be true for the same public origin and validation window.

| Area | Ready requirement | Evidence to capture |
| --- | --- | --- |
| Approval | Project owner has approved the public origin, start time, end time, and scanner set. | Issue or release comment with the window, scanner names, and operator owner. |
| Origin | The origin is intentionally public and may receive scanner, bot, and adversarial probing traffic. | Public origin hostname or redacted origin ID stored outside source when needed. |
| Deployment | Backend x402 is enabled with a funded payout address, supported network, facilitator URL, and stable app revision. | Non-secret runtime config summary and deploy revision ID from private IaC/deploy logs. |
| Discovery | `/openapi.json`, `/.well-known/x402`, `/.well-known/mcp.json`, and `/mcp` return current metadata. | Timestamped curl artifacts or scanner discovery receipts. |
| Seed content | At least one clean, public, purchasable stem has canonical USDC pricing and no rights-review blocker. | Stem ID, quote URL, purchase URL, license tiers, price, and rights status. |
| Free quote | x402 info and MCP quote paths return the same network, asset, amount, pay-to address, and resource target for the seeded stem. | Saved quote payloads with secrets and private origins redacted. |
| Payment challenge | Unpaid HTTP download emits a protocol-correct 402 challenge and MCP missing-proof emits `PAYMENT_REQUIRED` with recovery guidance. | HTTP response headers/body and MCP structured error payload. |
| Settlement safety | Invalid proofs and settlement failures do not serve audio resources and do produce actionable logs/errors. | Negative-path request IDs, error codes, and facilitator/settlement reasons. |
| Observability | Operators can see discovery, quote, challenge, verification, settlement, receipt, rate-limit, and error events. | Dashboard links, log queries, or event counts for the validation window. |
| Abuse controls | Rate limits, spend limits, alert ownership, and rollback/disable procedure are active. | Limit configuration summary and operator escalation path. |
| Privacy | No private staging URLs, secrets, payment proofs, or raw audio blobs will be committed to public docs/issues. | Redaction review before posting scanner receipts. |

Suggested status vocabulary:

- `Deferred`: no approved public validation window exists.
- `Ready`: every readiness checklist item is satisfied.
- `Running`: scanners are actively probing the approved public origin.
- `Passed`: scanners registered the expected paid resources and receipt
  evidence was captured.
- `Failed`: an approved public validation run exposed a real contract, x402,
  metadata, settlement, receipt, observability, or abuse-control problem.

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

## Scanner Receipt Capture Template

For each approved scanner run, add a short receipt entry with this shape. Keep
private origins, payment proofs, secrets, and raw resource payloads redacted.

```json
{
  "status": "Passed | Failed",
  "scanner": "x402scan | mppscan | Agentic.Market | AgentCash | other",
  "startedAt": "2026-05-29T00:00:00Z",
  "completedAt": "2026-05-29T00:05:00Z",
  "operator": "@owner-or-team",
  "publicOrigin": "<approved-public-origin-or-redacted-origin-id>",
  "originId": "<scanner-origin-id-if-issued>",
  "resourceCount": 1,
  "seededStem": {
    "stemId": "<public-stem-id>",
    "licenseType": "personal | remix | commercial",
    "price": "0.05",
    "currency": "USDC",
    "network": "eip155:84532"
  },
  "discovery": {
    "openapi": "passed",
    "x402WellKnown": "passed",
    "mcpWellKnown": "passed",
    "mcpTools": ["catalog.search", "stem.quote", "stem.download"]
  },
  "payment": {
    "unpaidChallenge": "passed",
    "quoteMatchesChallenge": true,
    "invalidProofRecovery": "passed",
    "successfulReceipt": "passed"
  },
  "receipt": {
    "receiptId": "<receipt-id-or-redacted>",
    "encodedReceiptPresent": true,
    "settlementStatus": "settled | authorized | failed | deferred",
    "resourceMimeType": "audio/mpeg",
    "resourceBytes": 0
  },
  "failures": [],
  "notes": "No private staging URL, raw proof, secret, or audio blob included."
}
```

If a run fails, preserve the same fields and add concise failure objects:

```json
{
  "step": "unpaidChallenge | quote | proofVerification | settlement | receipt | registryMutation",
  "code": "RESOURCE_UNAVAILABLE | X402_DISABLED | FACILITATOR_FAILED | SETTLEMENT_FAILED | other",
  "message": "Short operator-readable summary",
  "requestId": "<request-id-if-safe-to-share>",
  "recovery": "Next action before rerun"
}
```

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
