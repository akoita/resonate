# Security Best Practices Report

## Executive Summary

Reviewed the agent commerce runtime x402 payment-router slice for #805. No
Critical or High findings were identified in the changed backend code.

## Scope

- `backend/src/modules/agents/agent_runtime.providers.ts`
- `backend/src/modules/agents/agent_runtime.service.ts`
- `backend/src/modules/agents/agent_runtime.types.ts`
- `backend/src/modules/agents/agent_config.controller.ts`
- `backend/src/modules/agents/agents.module.ts`
- `backend/src/modules/agents/payment_router.service.ts`
- `backend/src/modules/agents/policy_guard.service.ts`
- `backend/src/modules/sessions/sessions.module.ts`
- `backend/src/modules/sessions/sessions.service.ts`
- `backend/src/tests/agent_runtime_normalization.spec.ts`
- `backend/src/tests/payment_router.spec.ts`
- `backend/src/tests/payment_router_x402.integration.spec.ts`
- `backend/src/tests/policy_guard.spec.ts`
- `backend/src/tests/flow3_session.integration.spec.ts`
- `backend/src/tests/sessions.integration.spec.ts`
- `docs/features/agent-platform-refactor-backlog.md`
- `docs/features/agent-commerce-runtime.md`
- `docs/features/README.md`
- `docs/rfc/agent-platform-refactor.md`

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None in the changed code.

## Low Findings

None in the changed code.

## Informational Notes

- The new `PolicyGuardService` is a positive security boundary: it rejects
  over-budget purchases and disallowed license or rail choices before purchase
  execution.
- The updated `PaymentRouterService` normalizes the existing ERC-4337
  marketplace purchase result and the x402 proof-settlement path behind one
  result envelope.
- The x402 rail builds payment requirements from the existing x402 helper and
  `StemPricing`, applies policy before verification/settlement, and records
  only receipt/provenance metadata after a verified proof.
- The AI DJ marketplace buy path now passes through `PaymentRouterService`
  before the ERC-4337 purchase rail, preserving the existing purchase execution
  service while adding a pre-execution policy boundary.
- The session runtime path keeps using server-side session IDs and user IDs from
  existing session records; it does not introduce new public identifiers,
  secrets, dynamic SQL, unsafe deserialization, or new controllers.
- Broad repository scans still report pre-existing items outside this change
  set, such as development JWT fallbacks and existing raw Prisma template
  queries. No new Critical or High issue was introduced by this branch.

## Commands Run

```bash
cd backend && npm run lint
cd backend && npx jest --runInBand src/tests/payment_router.spec.ts src/tests/agent_runtime_normalization.spec.ts src/tests/policy_guard.spec.ts
cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='payment_router_x402.integration|sessions.integration|flow3_session.integration'
git diff --check
rg 'password|secret|api_key|private_key|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY' backend/src/modules/agents/payment_router.service.ts backend/src/modules/agents/agent_config.controller.ts backend/src/modules/agents/agents.module.ts backend/src/tests/payment_router.spec.ts backend/src/tests/payment_router_x402.integration.spec.ts
rg 'rawQuery|executeRaw|\$queryRaw|eval\(' backend/src/modules/agents/payment_router.service.ts backend/src/modules/agents/agent_config.controller.ts backend/src/modules/agents/agents.module.ts backend/src/tests/payment_router.spec.ts backend/src/tests/payment_router_x402.integration.spec.ts
```

## Addendum: #812 Public Payment-Router API Surface

Reviewed the #812 OpenAPI guidance change. The update documents that external
agent clients should use storefront discovery, x402 payment endpoints, and MCP
tools, while `PaymentRouterService` remains a trusted backend boundary. No new
controller, authentication path, payment execution path, environment variable,
secret, dynamic SQL, or deserialization surface was introduced.

### Scope

- `backend/src/modules/openapi/openapi.service.ts`
- `backend/src/tests/openapi.controller.spec.ts`
- `docs/architecture/x402_payments.md`
- `docs/features/agent-commerce-runtime.md`
- `docs/features/README.md`

### Findings

- Critical: none.
- High: none.
- Medium: none.
- Low: none.

### Commands Run

```bash
cd backend && npx jest --runInBand src/tests/openapi.controller.spec.ts
cd backend && npm run lint
```

## Addendum: #814-#818 Agent Recommendation Engine Slice

Reviewed the bundled AI DJ recommendation changes for audio feature seeds,
candidate scoring, replayable recommendation evals, and UI explanation states.
No Critical or High findings were identified in the changed code.

### Scope

- `backend/src/modules/agents/agent_audio_feature.service.ts`
- `backend/src/modules/agents/agent_recommendation_eval.service.ts`
- `backend/src/modules/agents/agent_selector.service.ts`
- `backend/src/modules/agents/agent_orchestrator.service.ts`
- `backend/src/modules/agents/agent_runtime.types.ts`
- `backend/src/modules/agents/agent_config.controller.ts`
- `backend/src/modules/sessions/sessions.service.ts`
- `backend/src/tests/agent_audio_feature.integration.spec.ts`
- `backend/src/tests/agent_recommendation_eval.spec.ts`
- `backend/src/tests/agent_learning.spec.ts`
- `web/src/components/agent/AgentNextPickCard.tsx`
- `web/src/components/agent/AgentHistoryCard.tsx`
- `web/src/components/agent/AgentNextPickCard.test.tsx`
- `web/src/lib/api.ts`
- `docs/features/agent-commerce-runtime.md`
- `docs/features/README.md`

### Findings

- Critical: none.
- High: none.
- Medium: none.
- Low: none in the changed code.

### Notes

- The new audio feature seed uses deterministic metadata/fingerprint/stem
  duration signals and persists them in existing `Track.generationMetadata`;
  it does not introduce external network calls, secret handling, file parsing,
  or dynamic SQL.
- Recommendation explanations are derived server-side from bounded signals and
  returned as structured JSON for UI display.
- Replayable eval artifacts are written under `eval-results/`, which is ignored
  and not committed as generated output.
- Existing broad scans still find pre-existing test placeholders and
  environment-variable names in unrelated agent modules; no literal credentials
  or new secret material were introduced by this slice.

### Commands Run

```bash
cd backend && npm run lint
cd backend && npx jest --runInBand src/tests/agent_learning.spec.ts src/tests/agent_recommendation_eval.spec.ts src/tests/agent_runtime_normalization.spec.ts
cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='agent_audio_feature.integration|agent_catalog_search.integration|agent_orchestrator.integration'
cd backend && npm run eval:recommendations
cd web && npm run lint
cd web && npx vitest run src/components/agent/AgentNextPickCard.test.tsx
rg 'password|secret|api_key|private_key|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY' backend/src/modules/agents backend/src/modules/sessions backend/src/tests/agent_* web/src/components/agent web/src/lib/api.ts --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/agents backend/src/modules/sessions
rg 'dangerouslySetInnerHTML|innerHTML|document\.cookie|setCookie|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/components/agent web/src/lib/api.ts
```

## Addendum: #821 Recommendation Adapter Strategy Switch

Reviewed the AI DJ recommendation adapter refactor and strategy switch. No
Critical or High findings were identified in the changed code.

### Scope

- `backend/src/modules/agents/agent_recommendation.adapter.ts`
- `backend/src/modules/agents/agent_recommendation.service.ts`
- `backend/src/modules/agents/deterministic_recommendation.adapter.ts`
- `backend/src/modules/agents/agent_orchestrator.service.ts`
- `backend/src/modules/agents/agent_runtime.providers.ts`
- `backend/src/events/event_types.ts`
- `backend/src/tests/agent_recommendation_adapter.spec.ts`
- `backend/src/tests/agent_orchestrator.integration.spec.ts`
- `docs/deployment/environment.md`
- `docs/features/agent-commerce-runtime.md`
- `docs/features/README.md`

### Findings

- Critical: none.
- High: none.
- Medium: none.
- Low: none in the changed code.

### Notes

- `AGENT_RECOMMENDATION_STRATEGY` is a non-secret backend behavior switch. It
  defaults to deterministic ranking and unsupported values fall back to the
  deterministic adapter.
- The adapter boundary introduces no new controller, public endpoint, network
  client, dynamic SQL, deserialization path, or secret handling.
- The deterministic adapter preserves strict no-match behavior by routing
  through the existing selector contract.
- Secret-pattern scans report existing environment-variable documentation names
  in `docs/deployment/environment.md`; no literal credentials or new secret
  material were introduced.

### Commands Run

```bash
cd backend && npm run lint
cd backend && npx jest --runInBand src/tests/agent_recommendation_adapter.spec.ts src/tests/agent_learning.spec.ts src/tests/agent_runtime_normalization.spec.ts
cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='agent_orchestrator.integration|sessions.integration|flow3_session.integration'
cd backend && npm run eval:recommendations
cd backend && npm run test
git diff --check
rg -n --ignore-case 'password|secret|api[_-]?key|private[_-]?key|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|gho_[A-Za-z0-9_]+|sk-[A-Za-z0-9]' backend/src/modules/agents/agent_recommendation.adapter.ts backend/src/modules/agents/agent_recommendation.service.ts backend/src/modules/agents/deterministic_recommendation.adapter.ts backend/src/modules/agents/agent_orchestrator.service.ts backend/src/modules/agents/agent_runtime.providers.ts backend/src/events/event_types.ts backend/src/tests/agent_recommendation_adapter.spec.ts backend/src/tests/agent_orchestrator.integration.spec.ts docs/deployment/environment.md docs/features/agent-commerce-runtime.md docs/features/README.md
rg -n 'rawQuery|executeRaw|\$queryRaw|eval\(' backend/src/modules/agents/agent_recommendation.adapter.ts backend/src/modules/agents/agent_recommendation.service.ts backend/src/modules/agents/deterministic_recommendation.adapter.ts backend/src/modules/agents/agent_orchestrator.service.ts backend/src/modules/agents/agent_runtime.providers.ts backend/src/events/event_types.ts
```
