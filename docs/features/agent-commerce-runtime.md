---
title: "Agent Commerce Runtime"
status: partial
owner: "@akoita"
issues: [805]
introduced_by: 808
---

# Agent Commerce Runtime

The Agent Commerce Runtime is the shared backend path for AI DJ recommendations
that need commerce-aware output: selected tracks, license type, normalized price,
runtime status, and payment-rail routing.

It lets Resonate keep the AI DJ product surface, backend agent runtime, and
future machine-commerce integrations aligned around one result shape instead of
each caller inventing its own response contract.

## Who Uses It

| Audience | Use |
| --- | --- |
| Listener | Starts an AI DJ session and receives track recommendations within budget and taste constraints. |
| Backend developer | Calls the session recommendation API or `AgentRuntimeService.runCommerce()` for a normalized commerce result. |
| Agent/API developer | Uses the normalized result and payment-router boundary for x402 and ERC-4337 payment routing. |

## Current Status

Status: `partial`

Available now:

- `SessionsService.agentNext()` routes through `AgentRuntimeService.runCommerce()`.
- Runtime output is normalized into `status`, `tracks`, `primaryTrack`, `licenseType`, and `priceUsd`.
- `PolicyGuardService` centralizes pre-execution checks for budget and license policy.
- `PaymentRouterService` centralizes ERC-4337 marketplace and x402 rail execution behind one result envelope.
- The x402 rail builds a canonical challenge from `StemPricing`, blocks policy failures before verification, verifies/settles payment proofs, records `x402.purchase` provenance, and returns a structured receipt.
- The AI DJ marketplace buy path routes through `PaymentRouterService` before calling the ERC-4337 purchase rail.
- Session recommendation events publish `agent.track_selected` with `strategy: "runtime"`.

Still to complete:

- Decide whether to expose a dedicated frontend "next AI pick" control.
- Decide whether external authenticated clients need a dedicated payment-router API, or whether public x402 endpoints plus backend service calls are enough.
- Phase 2 standalone runtime extraction remains tracked separately.

## End-User Flow

1. Open the deployed app.
2. Go to `/agent`.
3. Connect a wallet and configure the AI DJ.
4. Start a session.
5. Watch the activity feed/history for selected tracks and spend.

This verifies that the user-facing AI DJ still operates through the deployed
runtime stack. The specific `agent/next` call is currently a backend/API surface,
not a separate visible frontend button.

## Developer API Flow

The deployed backend route is authenticated with JWT.

Start a session through the app or API:

```bash
curl -X POST "$API_URL/agents/config/session" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json"
```

Then request the next commerce-aware recommendation:

```bash
curl -X POST "$API_URL/sessions/agent/next" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "SESSION_ID_HERE",
    "preferences": {
      "genres": ["electronic"],
      "energy": "medium",
      "licenseType": "remix",
      "allowExplicit": true
    }
  }'
```

Expected success shape:

```json
{
  "status": "ok",
  "track": {
    "id": "track-id",
    "title": "Track title",
    "artistId": "artist-id"
  },
  "licenseType": "remix",
  "priceUsd": 5,
  "runtimeStatus": "approved",
  "tracks": [
    {
      "trackId": "track-id",
      "licenseType": "remix",
      "priceUsd": 5,
      "reason": "within_budget"
    }
  ]
}
```

Other useful responses:

| Status | Meaning |
| --- | --- |
| `session_inactive` | Session does not exist or has ended. |
| `no_tracks` | Runtime found no candidate track. |
| `all_rejected` | Candidates were found but rejected by policy/runtime constraints. |

## Developer Payment-Router Flow

Use `PaymentRouterService.purchase(input)` when backend code needs one policy
and result envelope across supported rails.

ERC-4337 marketplace purchase:

```typescript
await paymentRouter.purchase({
  sessionId,
  userId,
  rail: "erc4337_marketplace",
  licenseType: "remix",
  listingId,
  tokenId,
  amount: 1n,
  totalPriceWei,
  priceUsd,
  budgetRemainingUsd,
});
```

x402 purchase challenge:

```typescript
const challenge = await paymentRouter.purchase({
  sessionId,
  userId,
  rail: "x402",
  stemId,
  licenseType: "remix",
  budgetRemainingUsd,
});
```

When no proof is supplied, the result has `status: "payment_required"` and
contains `paymentChallenge.paymentRequirements`. An x402-capable client such as
AgentCash can satisfy that challenge.

x402 settlement with proof:

```typescript
const result = await paymentRouter.purchase({
  sessionId,
  userId,
  rail: "x402",
  stemId,
  licenseType: "remix",
  budgetRemainingUsd,
  paymentProof,
  paymentRequirements,
});
```

Expected confirmed x402 result:

```json
{
  "success": true,
  "rail": "x402",
  "status": "confirmed",
  "reason": "payment_confirmed",
  "stemId": "stem-id",
  "licenseType": "remix",
  "priceUsd": 5,
  "receiptId": "x402r_...",
  "receipt": {
    "type": "resonate.x402.purchase_receipt",
    "protocol": "x402"
  }
}
```

Policy failures return `status: "rejected"` before any x402 verification or
chain/payment call.

## Developer Service Flow

Use `AgentRuntimeService.runCommerce(input)` when backend code needs normalized
commerce output from whichever runtime is configured.

Key inputs:

- `sessionId`
- `userId`
- `recentTrackIds`
- `budgetRemainingUsd`
- `preferences.genres`
- `preferences.energy`
- `preferences.allowExplicit`
- `preferences.licenseType`

Key output fields:

- `status`
- `tracks`
- `primaryTrack`
- `licenseType`
- `priceUsd`
- `reason`
- `generationSpendUsd`
- `generationsUsed`

## Main Code References

| Concern | File |
| --- | --- |
| Session API route | `backend/src/modules/sessions/sessions.controller.ts` |
| Session integration | `backend/src/modules/sessions/sessions.service.ts` |
| Runtime entrypoint | `backend/src/modules/agents/agent_runtime.service.ts` |
| Normalized result contract | `backend/src/modules/agents/agent_runtime.types.ts` |
| Policy guard | `backend/src/modules/agents/policy_guard.service.ts` |
| Payment routing boundary | `backend/src/modules/agents/payment_router.service.ts` |
| x402 challenge/verification helper | `backend/src/modules/x402/x402.payment.service.ts` |
| x402 receipt builder | `backend/src/modules/x402/x402.receipt.ts` |
| Runtime providers | `backend/src/modules/agents/agent_runtime.providers.ts` |

## Tests

Run the focused tests:

```bash
cd backend
npx jest --runInBand src/tests/agent_runtime_normalization.spec.ts src/tests/policy_guard.spec.ts src/tests/payment_router.spec.ts
npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='payment_router_x402.integration|sessions.integration|flow3_session.integration'
```

Run the broader backend suite:

```bash
cd backend
npm run lint
npm run test
```

## Related Docs

- [Feature catalog](README.md)
- [Agent Platform Refactor RFC](../rfc/agent-platform-refactor.md)
- [Agent Platform Refactor Backlog](agent-platform-refactor-backlog.md)
- [Agent Runtime Worker](../architecture/agent-runtime-worker.md)
- [x402 Payments](../architecture/x402_payments.md)
