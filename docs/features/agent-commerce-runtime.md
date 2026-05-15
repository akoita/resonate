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
runtime status, and future payment-rail routing.

It lets Resonate keep the AI DJ product surface, backend agent runtime, and
future machine-commerce integrations aligned around one result shape instead of
each caller inventing its own response contract.

## Who Uses It

| Audience | Use |
| --- | --- |
| Listener | Starts an AI DJ session and receives track recommendations within budget and taste constraints. |
| Backend developer | Calls the session recommendation API or `AgentRuntimeService.runCommerce()` for a normalized commerce result. |
| Agent/API developer | Uses the normalized result as the stable boundary for future x402 and ERC-4337 payment routing. |

## Current Status

Status: `partial`

Available now:

- `SessionsService.agentNext()` routes through `AgentRuntimeService.runCommerce()`.
- Runtime output is normalized into `status`, `tracks`, `primaryTrack`, `licenseType`, and `priceUsd`.
- `PolicyGuardService` centralizes pre-execution checks for budget and license policy.
- `PaymentRouterService` exists as the boundary for ERC-4337 and x402 rails.
- Session recommendation events publish `agent.track_selected` with `strategy: "runtime"`.

Still to complete:

- Implement the AgentCash/x402 rail behind `PaymentRouterService`.
- Decide whether to expose a dedicated frontend "next AI pick" control.
- Close issue #805 only after both rails share the final production envelope.

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
| Runtime providers | `backend/src/modules/agents/agent_runtime.providers.ts` |

## Tests

Run the focused tests:

```bash
cd backend
npx jest --runInBand src/tests/agent_runtime_normalization.spec.ts src/tests/policy_guard.spec.ts src/tests/payment_router.spec.ts
npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='sessions.integration|flow3_session.integration'
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
