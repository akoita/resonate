---
title: "Agent Commerce Runtime"
status: implemented
owner: "@akoita"
issues: [805, 812]
introduced_by: [808, 810, 811, 821, 823, 824]
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

Status: `implemented`

Available now:

- `SessionsService.agentNext()` routes through `AgentRuntimeService.runCommerce()`.
- Runtime output is normalized into `status`, `tracks`, `primaryTrack`, `licenseType`, and `priceUsd`.
- The `/agent` dashboard exposes a "Next AI Pick" control that calls the shared runtime-commerce path for the active session and shows track, license, price, and runtime status.
- Runtime catalog search treats explicit genre/taste queries as hard candidate constraints. A query with no catalog matches returns no candidates instead of falling back to unrelated recent tracks.
- LLM adapters can curate over the shared catalog/pricing/analytics tools when configured, but the current content-understanding layer is still metadata and embedding based; audio-feature and collaborative ranking remain follow-up work.
- The deterministic selector now produces a bounded scored shortlist with explanation signals for taste match, expanded taste match, learned preference, active listings, text similarity, recent-track exclusion, and versioned metadata-derived audio feature vectors.
- Recommendation ranking now runs behind an adapter contract. `AGENT_RECOMMENDATION_STRATEGY` selects the strategy and defaults to `deterministic`; unsupported values fall back to the deterministic adapter rather than changing user-facing behavior.
- Metadata-derived `agentAudioFeatures` are persisted on `Track.generationMetadata` as a first durable feature-vector seed. Current schema version `agent-audio-features/v2` exposes confidence, source, extractor version, tempo/duration/energy bands, normalized genre, descriptors, tags, warnings, and a normalized numeric vector while leaving full DSP/model extraction as a future implementation behind the same service boundary.
- `npm run eval:recommendations` writes replayable JSON and Markdown eval artifacts for exact matches, semantic-near matches, recent-track rejection, sparse/strict no-match behavior, precision thresholds, listing coverage, novelty, and explanation coverage. The generated `eval-results/` directory stays ignored unless an artifact is intentionally promoted into docs.
- `PolicyGuardService` centralizes pre-execution checks for budget and license policy.
- `PaymentRouterService` centralizes ERC-4337 marketplace and x402 rail execution behind one result envelope.
- The x402 rail builds a canonical challenge from `StemPricing`, blocks policy failures before verification, verifies/settles payment proofs, records `x402.purchase` provenance, and returns a structured receipt.
- The AI DJ marketplace buy path routes through `PaymentRouterService` before calling the ERC-4337 purchase rail.
- Session recommendation events publish `agent.track_selected` with `strategy: "runtime"`.

Phase 1 is complete for the in-backend runtime-commerce boundary tracked by
#805. Issue #812 resolved the public API surface decision: external clients use
the public storefront x402/MCP surfaces, while `PaymentRouterService` remains a
trusted backend boundary rather than a generic public command endpoint.

Standalone runtime extraction remains a separate Phase 2 follow-up in #424.

## End-User Flow

1. Open the deployed app.
2. Go to `/agent`.
3. Connect a wallet and configure the AI DJ.
4. Start a session.
5. Use the "Next Pick" button in the "Next AI Pick" card.
6. Review the selected track, license type, price, runtime status, and any no-pick/policy status shown in the card.
7. Watch the activity feed/history for selected tracks and spend.

This verifies that the user-facing AI DJ operates through the deployed runtime
stack and gives developers a simple manual QA path for `POST
/sessions/agent/next`.

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

Recommendation explanations are returned on commerce-aware picks when available:

```json
{
  "score": 72,
  "explanation": ["Nearby vibe match", "Purchasable stem available"],
  "signals": [
    { "label": "expanded_taste_match", "weight": 28, "reason": "matches nearby taste rap" },
    { "label": "listed", "weight": 14, "reason": "has active stem listing" }
  ],
  "audioFeatures": {
    "source": "metadata_inferred",
    "confidence": 0.6,
    "tempoBpm": 124,
    "energyBand": "high",
    "warnings": ["fingerprint_unavailable"]
  }
}
```

## External API Decision

Resonate does not expose a generic public payment-router endpoint today.
External clients should use the protocol-native surfaces that already map to a
stable public contract:

- Discover purchasable stems with `GET /api/storefront/stems` or `POST /mcp`.
- Inspect quote, license, rights, and x402 metadata with `GET /api/stems/:stemId/x402/info`.
- Purchase and download through `GET /api/stems/:stemId/x402` by satisfying the
  `PAYMENT-REQUIRED` challenge with `PAYMENT-SIGNATURE` or `X-PAYMENT`.
- Use `/.well-known/x402`, `/.well-known/mcp.json`, and `/openapi.json` for
  machine-readable discovery.

The generic router stays internal because it accepts trusted runtime context
such as `userId`, `sessionId`, budget state, allowed rails, marketplace listing
data, and rail-specific proof material. Exposing that as a public endpoint now
would freeze an authenticated command API before Resonate has a concrete first
external client that needs one. When that client exists, the new API should be
designed as a narrow command surface that still returns the existing normalized
router result envelope and enforces `PolicyGuardService` before rail execution.

## Developer Payment-Router Flow

Use `PaymentRouterService.purchase(input)` when trusted backend code needs one
policy and result envelope across supported rails. This is a backend service
contract, not a public HTTP endpoint.

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
- `preferences.stemTypes`
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
| `/agent` UI card | `web/src/components/agent/AgentNextPickCard.tsx` |
| Frontend API helper | `web/src/lib/api.ts` |
| Session API route | `backend/src/modules/sessions/sessions.controller.ts` |
| Session integration | `backend/src/modules/sessions/sessions.service.ts` |
| Runtime entrypoint | `backend/src/modules/agents/agent_runtime.service.ts` |
| Normalized result contract | `backend/src/modules/agents/agent_runtime.types.ts` |
| Recommendation adapter contract | `backend/src/modules/agents/agent_recommendation.adapter.ts` |
| Deterministic recommendation adapter | `backend/src/modules/agents/deterministic_recommendation.adapter.ts` |
| Recommendation strategy switch | `backend/src/modules/agents/agent_recommendation.service.ts` |
| Track feature vectors | `backend/src/modules/agents/agent_audio_feature.service.ts` |
| Policy guard | `backend/src/modules/agents/policy_guard.service.ts` |
| Payment routing boundary | `backend/src/modules/agents/payment_router.service.ts` |
| x402 challenge/verification helper | `backend/src/modules/x402/x402.payment.service.ts` |
| x402 receipt builder | `backend/src/modules/x402/x402.receipt.ts` |
| Runtime providers | `backend/src/modules/agents/agent_runtime.providers.ts` |

## Current Recommendation Limits

The runtime is intentionally a hybrid foundation, not a Spotify-scale
recommendation system yet. The live stack can use ADK/Gemini or other runtime
adapters to call tools and reason over candidates, while recommendation ranking
itself now has a smaller adapter boundary for deterministic, model-assisted, or
future specialized ranking strategies. Today only the deterministic
recommendation strategy is implemented. It uses bounded taste expansion,
persists metadata-derived audio feature vectors, and ranks candidates with
explainable signals. The feature vector is lazily backfilled with
`getOrCreate()` and old schema versions are recomputed into the current schema
without blocking recommendations. Confidence and source fields indicate whether
the vector came from fingerprint metadata, generated metadata, or metadata-only
inference. It does not yet extract audio spectrogram features or train
collaborative models from behavior logs.

For investor-facing demos, the reliable claim is: policy-bounded agent commerce
with taste-constrained candidate retrieval, tool-mediated LLM curation, budget
guards, and purchase routing. The follow-up product claim is: richer taste
matching through audio features, stronger embeddings, collaborative learning,
and evaluation-backed recommendation quality.

## Recommendation Evals

Run:

```bash
cd backend
npm run eval:recommendations
```

The command writes:

- `eval-results/agent-recommendation-results.json` for machine-readable replay.
- `eval-results/agent-recommendation-summary.md` for product-readable review.

Important metrics:

- `precision`: selected candidates marked exact or semantic divided by selected candidates with known relevance.
- `refusalCorrectness`: strict no-match cases that correctly selected zero tracks.
- `listingCoverage`: selected candidates with known active listing availability.
- `noveltyCoverage`: selected candidates that were not recently played.
- `explanationCoverage`: selected candidates with explanation text or top scoring signals.

The eval suite intentionally fails if a strict no-match case selects unrelated
catalog inventory, or if a semantic-match case falls below its configured
precision threshold.

## Tests

Run the focused tests:

```bash
cd backend
npx jest --runInBand src/tests/agent_recommendation_adapter.spec.ts src/tests/agent_runtime_normalization.spec.ts src/tests/policy_guard.spec.ts src/tests/payment_router.spec.ts
npm run eval:recommendations
npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='agent_audio_feature.integration|payment_router_x402.integration|sessions.integration|flow3_session.integration'
```

Run the focused frontend API test:

```bash
cd web
npx vitest run src/lib/api.test.ts
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
- [Public payment-router API decision](https://github.com/akoita/resonate/issues/812)
