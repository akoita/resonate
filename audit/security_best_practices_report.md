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

## Addendum: #279 Mood And Vibe Discovery

Reviewed the functional mood/vibe discovery branch. No Critical or High
findings were identified in the changed code.

### Scope

- `backend/prisma/schema.prisma`
- `backend/src/events/event_types.ts`
- `backend/src/modules/catalog/catalog.controller.ts`
- `backend/src/modules/catalog/catalog.service.ts`
- `backend/src/modules/ingestion/ingestion.service.ts`
- `backend/src/modules/recommendations/recommendations.controller.ts`
- `backend/src/modules/recommendations/recommendations.service.ts`
- `backend/src/tests/recommendations.controller.spec.ts`
- `backend/src/tests/recommendations.integration.spec.ts`
- `web/src/app/artist/upload/page.tsx`
- `web/src/app/page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/api.test.ts`
- `web/src/styles/home-nextgen.css`
- `docs/features/README.md`
- `docs/features/mood_vibe_discovery.md`

### Findings

- Critical: none.
- High: none.
- Medium: none.
- Low: none in the changed code.

### Notes

- Mood and genre overrides are request-scoped recommendation inputs; they do
  not replace persisted listener preferences unless the existing preference API
  is called.
- Artist-provided mood tags are normalized, bounded to eight entries, and
  stored as release metadata. They are not executed, rendered as HTML, or used
  to construct raw SQL.
- The new Home vibe signal records structured metadata through the existing
  authenticated agent signal endpoint.
- Broad scans still show pre-existing raw Prisma template queries and guarded
  JSON parsing in the ingestion/catalog modules. No new unsafe deserialization,
  dynamic SQL, secret handling, authentication bypass, or client-side XSS sink
  was introduced by this branch.

### Commands Run

```bash
cd backend && npm run lint
cd backend && npm test
cd backend && npm run test:integration -- --testPathPattern='catalog.mcp.integration|recommendations.integration'
cd web && npm run lint
cd web && npm run test:unit
git diff --check
rg -n "password|secret|api_key|private_key" backend/src/modules/catalog backend/src/modules/recommendations backend/src/modules/ingestion backend/src/events --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n "rawQuery|executeRaw|\$queryRaw" backend/src/modules/catalog backend/src/modules/recommendations backend/src/modules/ingestion backend/src/events
rg -n "JSON\.parse|eval\(" backend/src/modules/catalog backend/src/modules/recommendations backend/src/modules/ingestion backend/src/events
rg -n "dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false" web/src/app/page.tsx web/src/app/artist/upload/page.tsx web/src/lib/api.ts
```

## Addendum: Stablecoin-First Checkout, AI Generation Provenance, and Catalog Actions

Reviewed the combined branch for listener purchase defaults, catalog action
buttons, AI-generated release provenance, and upload metadata handling. No
Critical or High findings were identified in the changed code.

### Scope

- `backend/src/modules/generation/generation.service.ts`
- `backend/src/modules/ingestion/ingestion.service.ts`
- `backend/src/tests/generation.integration.spec.ts`
- `backend/src/tests/ingestion_metadata.spec.ts`
- `web/src/components/marketplace/BuyModal.tsx`
- `web/src/lib/buyPricing.ts`
- `web/src/lib/buyPricing.test.ts`
- `web/src/app/page.tsx`
- `web/src/app/artist/upload/page.tsx`
- `web/src/app/release/[id]/page.tsx`
- `web/tests/catalog.spec.ts`
- `docs/features/README.md`
- `docs/features/agent-commerce-runtime.md`
- `docs/features/ai_music_generation.md`
- `docs/features/catalog_indexing_mvp.md`

### Findings

- Critical: none.
- High: none.
- Medium: none in the changed code.
- Low: none in the changed code.

### Notes

- The stablecoin-first purchase default only changes the client-side rail
  preference when the x402 quote endpoint is available. Payment settlement
  remains behind the existing backend x402 verification path.
- AI-generated releases now record system provenance in existing rights review
  tables through Prisma transactions. The implementation does not add a public
  controller, dynamic SQL, unsafe deserialization, or secret handling.
- Catalog release actions reuse existing playlist and library APIs on the
  client and do not expose new backend authorization surfaces.
- Upload metadata changes prefer explicit artist metadata supplied by the
  artist/upload form over stale embedded file tags.
- Secret-pattern scans found the pre-existing `GOOGLE_AI_API_KEY` environment
  variable usage in generation artwork code. No literal credential or new secret
  material was introduced.

### Commands Run

```bash
cd backend && npm run lint
cd backend && npm run test -- ingestion_metadata.spec.ts generation.error_normalization.spec.ts generation.controller.spec.ts
cd backend && npm run test:integration -- generation.integration.spec.ts
cd web && npm run lint
cd web && npm run test:unit -- buyPricing.test.ts
cd web && npm run build
cd web && npm run test:e2e -- catalog.spec.ts --project=chromium
npm run security:lock-sources
git diff --check
rg -n --ignore-case 'password|secret|api[_-]?key|private[_-]?key|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|gho_[A-Za-z0-9_]+|sk-[A-Za-z0-9]' backend/src/modules/generation/generation.service.ts backend/src/modules/ingestion/ingestion.service.ts web/src/components/marketplace/BuyModal.tsx web/src/lib/buyPricing.ts web/src/app/page.tsx web/src/app/artist/upload/page.tsx 'web/src/app/release/[id]/page.tsx' --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw|eval\(' backend/src/modules/generation/generation.service.ts backend/src/modules/ingestion/ingestion.service.ts web/src/components/marketplace/BuyModal.tsx web/src/lib/buyPricing.ts web/src/app/page.tsx web/src/app/artist/upload/page.tsx 'web/src/app/release/[id]/page.tsx'
rg -n 'dangerouslySetInnerHTML|innerHTML|document\.cookie|setCookie|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/components/marketplace/BuyModal.tsx web/src/lib/buyPricing.ts web/src/app/page.tsx web/src/app/artist/upload/page.tsx 'web/src/app/release/[id]/page.tsx'
```

## Addendum: #823 Track Feature Vectors

Reviewed the richer AI DJ track feature vector changes. No Critical or High
findings were identified in the changed code.

### Scope

- `backend/src/modules/agents/agent_audio_feature.service.ts`
- `backend/src/tests/agent_audio_feature.integration.spec.ts`
- `docs/features/agent-commerce-runtime.md`
- `docs/features/README.md`

### Findings

- Critical: none.
- High: none.
- Medium: none.
- Low: none in the changed code.

### Notes

- Feature vectors are deterministic metadata-derived JSON stored in existing
  `Track.generationMetadata`; no new table, file parser, external network
  client, dynamic SQL, controller, or public endpoint was introduced.
- Legacy `agent-audio-features/v1` values are lazily recomputed into
  `agent-audio-features/v2` through the same get-or-create path.
- Missing metadata degrades through warnings and lower confidence rather than
  throwing or blocking recommendations.
- Changed-file secret and dynamic SQL scans returned no matches.

### Commands Run

```bash
cd backend && npm run lint
cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='agent_audio_feature.integration'
cd backend && npx jest --runInBand src/tests/agent_learning.spec.ts src/tests/agent_recommendation_adapter.spec.ts src/tests/agent_recommendation_eval.spec.ts
cd backend && npm run eval:recommendations
cd backend && npm run test
git diff --check
rg -n --ignore-case 'password|secret|api[_-]?key|private[_-]?key|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|gho_[A-Za-z0-9_]+|sk-[A-Za-z0-9]' backend/src/modules/agents/agent_audio_feature.service.ts backend/src/tests/agent_audio_feature.integration.spec.ts docs/features/agent-commerce-runtime.md docs/features/README.md
rg -n 'rawQuery|executeRaw|\$queryRaw|eval\(' backend/src/modules/agents/agent_audio_feature.service.ts
```

## Addendum: #824 Recommendation Eval Expansion

Reviewed the expanded AI DJ recommendation eval suite for semantic matches,
strict no-match cases, and product-readable eval metrics. No Critical or High
findings were identified in the changed code.

### Scope

- `backend/src/modules/agents/agent_recommendation_eval.service.ts`
- `backend/src/tests/agent_recommendation_eval.spec.ts`
- `docs/features/agent-commerce-runtime.md`
- `docs/features/README.md`

### Findings

- Critical: none.
- High: none.
- Medium: none.
- Low: none in the changed code.

### Notes

- The eval service writes deterministic JSON and Markdown artifacts under the
  ignored `eval-results/` directory; no new controller, public endpoint,
  external network client, dynamic SQL, or secret handling was introduced.
- Candidate and signal fields are local eval metadata only and do not carry
  user tokens, private keys, or credentials.
- Strict no-match cases now fail when unrelated catalog candidates are selected,
  and semantic-match cases can enforce precision thresholds, listed-track
  coverage, novelty, and explanation coverage.
- Changed-file secret and dynamic SQL scans returned no matches.

### Commands Run

```bash
cd backend && npm run lint
cd backend && npm run eval:recommendations
cd backend && npx jest --runInBand src/tests/agent_recommendation_eval.spec.ts
cd backend && npm run test
git diff --check
rg -n --ignore-case 'password|secret|api[_-]?key|private[_-]?key|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|gho_[A-Za-z0-9_]+|sk-[A-Za-z0-9]' backend/src/modules/agents/agent_recommendation_eval.service.ts backend/src/tests/agent_recommendation_eval.spec.ts docs/features/agent-commerce-runtime.md docs/features/README.md
rg -n 'rawQuery|executeRaw|\$queryRaw|eval\(' backend/src/modules/agents/agent_recommendation_eval.service.ts backend/src/tests/agent_recommendation_eval.spec.ts
```

## Addendum: #822 Model-Assisted Recommendation Ranking

Reviewed the AI DJ model-assisted recommendation adapter and strict relevance
guards. No Critical or High findings were identified in the changed code.

### Scope

- `backend/src/modules/agents/agent_recommendation.adapter.ts`
- `backend/src/modules/agents/agent_recommendation.service.ts`
- `backend/src/modules/agents/agent_runtime.providers.ts`
- `backend/src/modules/agents/agent_selector.service.ts`
- `backend/src/modules/agents/model_assisted_recommendation.adapter.ts`
- `backend/src/tests/agent_recommendation_adapter.spec.ts`
- `docs/deployment/environment.md`
- `docs/features/agent-commerce-runtime.md`
- `docs/features/README.md`

### Findings

- Critical: none.
- High: none.
- Medium: none.
- Low: none in the changed code.

### Notes

- The adapter is disabled unless `AGENT_RECOMMENDATION_STRATEGY=model-assisted`
  is configured, and falls back to deterministic ranking when
  `GOOGLE_AI_API_KEY` is absent, model output is malformed, a timeout occurs, or
  the SDK call fails.
- The model receives bounded catalog candidate summaries, taste preferences,
  recent track IDs, budget, and non-secret feature summaries. It does not receive
  user tokens, private keys, session keys, wallet credentials, or raw secrets.
- Structured JSON output is validated before use. Post-model guards reject
  unknown track IDs, recent tracks, `none` relevance, and confidence below the
  configured threshold.
- No controller, public endpoint, dynamic SQL, file parser, or persistent secret
  store was introduced.
- Changed-file secret-pattern scans reported environment variable names and
  test-only placeholder strings such as `test-key`; no literal credentials or
  private material were introduced. Dynamic SQL/eval scans returned no matches.

### Commands Run

```bash
cd backend && npm run lint
cd backend && npx jest --runInBand src/tests/agent_recommendation_adapter.spec.ts src/tests/agent_recommendation_eval.spec.ts src/tests/agent_runtime_normalization.spec.ts
cd backend && npm run eval:recommendations
cd backend && npm run test
git diff --check
rg -n --ignore-case 'password|secret|api[_-]?key|private[_-]?key|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|gho_[A-Za-z0-9_]+|sk-[A-Za-z0-9]' backend/src/modules/agents/agent_recommendation.adapter.ts backend/src/modules/agents/agent_selector.service.ts backend/src/modules/agents/model_assisted_recommendation.adapter.ts backend/src/modules/agents/agent_recommendation.service.ts backend/src/modules/agents/agent_runtime.providers.ts backend/src/tests/agent_recommendation_adapter.spec.ts docs/deployment/environment.md docs/features/agent-commerce-runtime.md docs/features/README.md
rg -n 'rawQuery|executeRaw|\$queryRaw|eval\(' backend/src/modules/agents/agent_recommendation.adapter.ts backend/src/modules/agents/agent_selector.service.ts backend/src/modules/agents/model_assisted_recommendation.adapter.ts backend/src/modules/agents/agent_recommendation.service.ts backend/src/modules/agents/agent_runtime.providers.ts backend/src/tests/agent_recommendation_adapter.spec.ts
```

## Addendum: #250 AI-Driven Song Recommendations

Reviewed the Home "Recommended for You" surface, recommendation API enrichment,
and AI DJ seeded-session entry point. No Critical or High findings were
identified in the changed code.

### Scope

- `backend/src/modules/recommendations/recommendations.service.ts`
- `backend/src/tests/recommendations.integration.spec.ts`
- `web/src/app/page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/api.test.ts`
- `web/src/styles/home-nextgen.css`
- `docs/features/agent-commerce-runtime.md`
- `docs/features/README.md`

### Findings

- Critical: none.
- High: none.
- Medium: none.
- Low: none in the changed code.

### Notes

- Recommendation retrieval remains behind the existing JWT guard and now filters
  to published/ready public-catalog releases before scoring tracks.
- The Home seeded-session action uses existing authenticated agent-config and
  session endpoints. It does not expose new credentials, payment rails, or
  privileged backend commands.
- The recommendation mapper uses Prisma structured filters and in-memory scoring;
  no dynamic SQL, raw query construction, external network client, or file parser
  was introduced.
- Changed-file secret-pattern scans reported environment variable documentation
  names and CSS `mask-*` properties that match the generic `sk-` token pattern;
  no literal credentials or private material were introduced. Dynamic SQL/eval
  scans returned no matches.

### Commands Run

```bash
cd backend && npm run lint
cd backend && npx jest --runInBand src/tests/recommendations.controller.spec.ts
cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='recommendations.integration'
cd backend && npm run test
cd web && npm run lint
cd web && npx vitest run src/lib/api.test.ts
cd web && npm run build
git diff --check
rg -n --ignore-case 'password|secret|api[_-]?key|private[_-]?key|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|gho_[A-Za-z0-9_]+|sk-[A-Za-z0-9]' backend/src/modules/recommendations/recommendations.service.ts backend/src/tests/recommendations.integration.spec.ts web/src/app/page.tsx web/src/lib/api.ts web/src/lib/api.test.ts web/src/styles/home-nextgen.css docs/features/README.md docs/features/agent-commerce-runtime.md
rg -n 'rawQuery|executeRaw|\$queryRaw|eval\(' backend/src/modules/recommendations/recommendations.service.ts backend/src/tests/recommendations.integration.spec.ts web/src/app/page.tsx web/src/lib/api.ts web/src/lib/api.test.ts
```

## Addendum: #806 npm Supply-Chain Hardening

Reviewed the package-manager hardening change for npm install, CI, Docker, and
runtime-startup behavior. No Critical or High findings were identified in the
changed code.

### Scope

- `.npmrc`
- `backend/.npmrc`
- `web/.npmrc`
- `.github/actions/setup-npm-hardened/action.yml`
- `.github/workflows/ci.yml`
- `scripts/check-npm-lock-sources.mjs`
- `package.json`
- `backend/package.json`
- `web/package.json`
- `backend/Dockerfile`
- `web/Dockerfile`
- `docs/operations/npm_supply_chain_hardening.md`
- dependency lockfile metadata updates

### Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none.
- Low: existing npm audit advisories remain in the dependency graph and require
  separate dependency-remediation work.

### Notes

- npm is pinned to `11.14.1` in package metadata, CI, and Docker installs so
  npm 11 `min-release-age` enforcement is available.
- `.npmrc` enables `min-release-age=7` and `engine-strict=true`; the web
  workspace keeps `legacy-peer-deps=true` to preserve the current peer-dependency
  resolution behavior.
- CI adds a lockfile source scan that rejects git, tarball, or unexpected
  registry sources in committed npm lockfiles.
- Backend Docker no longer uses runtime `npx` for migrations. The Prisma CLI is
  installed from the committed backend lockfile and executed from
  `node_modules`.
- The change does not introduce new secrets, credential material, public
  endpoints, dynamic SQL, or new file upload/parsing surfaces.
- Existing npm audit advisories are not resolved by this package-manager
  hardening PR; the new controls reduce future compromised-release exposure and
  install-source drift.

### Commands Run

```bash
npm install -g npm@11.14.1
npm install --package-lock-only --ignore-scripts
cd backend && npm install --package-lock-only --ignore-scripts
cd web && npm install --package-lock-only --ignore-scripts --legacy-peer-deps
npm ci --ignore-scripts
cd backend && npm ci
cd web && npm ci --legacy-peer-deps
npm run security:lock-sources
cd backend && npm run lint
cd backend && npm run test
cd web && npm run lint
cd web && npm run build
cd web && npm run test:unit
docker build --target deps -t resonate-backend-npm-hardening-check ./backend
docker build --target deps -t resonate-web-npm-hardening-check ./web
docker build -t resonate-backend-npm-hardening-runtime-check ./backend
docker run --rm --entrypoint sh resonate-backend-npm-hardening-runtime-check -c 'test -x ./node_modules/.bin/prisma && ./node_modules/.bin/prisma --version | head -1'
python3 - <<'PY'
from pathlib import Path
import yaml
for path in ['.github/workflows/ci.yml', '.github/actions/setup-npm-hardened/action.yml']:
    yaml.safe_load(Path(path).read_text())
PY
git diff --check
rg -n --ignore-case 'password|secret|api[_-]?key|private[_-]?key|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|gho_[A-Za-z0-9_]+|sk-[A-Za-z0-9]'
```

## Addendum: x402 Encrypted Stem Download Redemption

Reviewed the x402 paid-download source-loading change for backend data handling,
authorization bypass risk, and secret exposure. No Critical or High findings
were identified in the changed code.

### Scope

- `backend/src/modules/encryption/encryption.service.ts`
- `backend/src/modules/x402/x402.controller.ts`
- `backend/src/tests/encryption.spec.ts`
- `backend/src/tests/x402.controller.spec.ts`

### Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none.
- Low: none in the changed code.

### Notes

- The x402 controller still verifies payment before the paid download path runs.
  The change only alters how already-authorized downloads load encrypted source
  bytes: DB/storage first, then HTTP fallback.
- The new `decryptBuffer` helper reuses the existing AES metadata validation,
  provider access checks for cached content, and server-side auth context; it
  does not introduce a new public endpoint.
- Secret-pattern scanning found only the existing `INTERNAL_SERVICE_KEY`
  environment variable reference, not a literal credential.
- Dynamic SQL/eval scans found no raw SQL or `eval` usage in the changed
  backend files. `JSON.parse` remains limited to AES metadata parsing with raw
  buffer fallback on invalid/non-AES metadata.

### Commands Run

```bash
cd backend && npx jest --runInBand --testPathPattern='x402.controller.spec|encryption.spec'
cd backend && npx jest --runInBand --testPathPattern='x402.controller.http.spec'
cd backend && npm run lint
cd backend && npm test
git diff --check
rg -n "(PRIVATE KEY|BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]|ghp_|gho_|AIza|password\\s*=|api[_-]?key\\s*=|secret\\s*=|token\\s*=|https://staging|pydes\\.xyz)" backend/src/modules/encryption/encryption.service.ts backend/src/modules/x402/x402.controller.ts backend/src/tests/encryption.spec.ts backend/src/tests/x402.controller.spec.ts -S
rg -n "(JSON\\.parse|eval\\(|\\$queryRaw|\\$executeRaw|@Body\\(\\)|@Query\\(\\)|@Param\\(\\))" backend/src/modules/encryption/encryption.service.ts backend/src/modules/x402/x402.controller.ts -S
rg -n "(password|secret|api_key|private_key|INTERNAL_SERVICE_KEY|PRIVATE KEY|sk-[A-Za-z0-9]|ghp_|gho_)" backend/src/modules/encryption/encryption.service.ts backend/src/modules/x402/x402.controller.ts -S
```

## Addendum: #841 Marketplace Checkout Rail Semantics

Reviewed the #841 checkout rail semantics slice for backend data exposure,
frontend rendering safety, and secret handling. No Critical or High findings
were identified in the changed code.

### Scope

- `backend/src/modules/contracts/metadata.controller.ts`
- `backend/src/tests/metadata.controller.integration.spec.ts`
- `web/src/components/marketplace/BuyModal.tsx`
- `web/src/lib/buyPricing.ts`
- `web/src/lib/buyPricing.test.ts`
- `docs/architecture/x402_payments.md`
- `docs/features/README.md`
- `docs/features/agent-commerce-runtime.md`
- `docs/smart-contracts/marketplace_integration.md`

### Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none in the changed code.
- Low: none in the changed code.

### Notes

- The backend change exposes `StemListing.paymentToken`, an existing indexed
  on-chain listing field, through the existing public marketplace listing
  response. It does not expose wallet private data, proofs, keys, or new
  settlement authority.
- The frontend change formats on-chain listing amounts with configured payment
  asset decimals and labels checkout choices as rails. It does not introduce
  HTML injection, cookie access, client-side secrets, or new network origins.
- Broad repository scans still report pre-existing development JWT fallbacks,
  environment-variable names, and raw Prisma template queries outside this
  change set. No new Critical or High issue was introduced by this branch.
- The x402 rail remains documented as not yet equivalent to direct
  contract-backed ownership/license settlement; that limitation is product
  scope, not a newly introduced security regression.

### Commands Run

```bash
cd backend && npm run lint
cd backend && npm test
cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='metadata.controller.integration' -t 'returns the payment token for ERC-20 marketplace listings'
cd web && npm run lint
cd web && npm run test:unit
git diff --check
rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/contracts/metadata.controller.ts
rg 'JSON\.parse|eval\(' backend/src/modules/contracts/metadata.controller.ts
rg '@Body\(\)|@Query\(\)|@Param\(' backend/src/modules/contracts/metadata.controller.ts
rg 'dangerouslySetInnerHTML|innerHTML' web/src/components/marketplace web/src/lib/buyPricing.ts
rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/components/marketplace web/src/lib/buyPricing.ts
rg 'document\.cookie|setCookie|httpOnly.*false' web/src/components/marketplace web/src/lib/buyPricing.ts
```

## Addendum: #841 x402 Settlement Ledger

Reviewed the #841 x402 settlement-ledger slice for payment replay handling,
receipt contents, backend data handling, and frontend rendering safety. No
Critical or High findings were identified in the changed code.

### Scope

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260517010000_x402_settlement_ledger/migration.sql`
- `backend/src/modules/x402/x402.controller.ts`
- `backend/src/modules/x402/x402.middleware.ts`
- `backend/src/modules/x402/x402.receipt.ts`
- `backend/src/tests/x402.controller.http.spec.ts`
- `backend/src/tests/x402.controller.spec.ts`
- `backend/src/tests/x402.middleware.spec.ts`
- `backend/src/tests/x402.receipt.spec.ts`
- `web/src/components/marketplace/BuyModal.tsx`
- `web/src/lib/x402Pay.ts`
- `docs/architecture/x402_payments.md`
- `docs/features/README.md`
- `docs/features/agent-commerce-runtime.md`
- `docs/smart-contracts/marketplace_integration.md`

### Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none in the changed code.
- Low: none in the changed code.

### Notes

- The new `X402Settlement` table stores receipt/provenance metadata and hashes
  the x402 payment proof before persistence. It does not store private keys,
  bearer tokens, API credentials, or raw wallet secrets.
- Replay protection is explicit: same-stem retries reuse the stored settlement
  receipt, while proof/transaction reuse for a different stem returns a
  conflict instead of re-serving content.
- The middleware checks existing settlement hashes before calling the
  facilitator, which avoids settling the same proof twice for idempotent client
  retries.
- The smart-account path validates a successful ERC-20 transfer to the
  configured payout address before recording settlement metadata.
- Listed-stem receipts are marked `contract_required_missing` until a future
  contract execution/verification step can produce canonical marketplace or
  license settlement. This avoids falsely treating an x402 download payment as
  protocol ownership.
- Broad repository scans still report pre-existing development JWT fallbacks,
  environment-variable names, raw Prisma template queries, and controller input
  validation backlog outside this change set. No new Critical or High issue was
  introduced by this branch.

### Commands Run

```bash
cd backend && npx prisma generate
cd backend && npx jest --runInBand src/tests/x402.middleware.spec.ts src/tests/x402.controller.spec.ts src/tests/x402.controller.http.spec.ts src/tests/x402.receipt.spec.ts
cd backend && npm run lint
cd backend && npm test
cd web && npm run lint
cd web && npx vitest run src/lib/x402Pay.test.ts src/lib/buyPricing.test.ts
git diff --check
rg -n 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg -n '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/ | grep -v 'Guard\|Auth'
rg -n 'JSON\.parse|eval\(' backend/src/
rg -n '@Body\(\)|@Query\(\)|@Param\(' backend/src/ | grep -v 'Pipe\|Dto\|Validation'
rg -n 'dangerouslySetInnerHTML|innerHTML' web/src/
rg -n 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/
rg -n 'document\.cookie|setCookie|httpOnly.*false' web/src/
rg -n 'password|secret|api_key|private_key|process\.env' backend/src/modules/x402 backend/prisma --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw|JSON\.parse|eval\(' backend/src/modules/x402 backend/prisma
```

## Addendum: #841 Contract-Backed x402 Marketplace Settlement

Reviewed the #841 x402 settlement execution slice for backend secret handling,
payment replay behavior, contract-call safety, receipt correctness, and
frontend receipt parsing. No Critical or High findings were identified in the
changed code.

### Scope

- `backend/src/modules/x402/x402.config.ts`
- `backend/src/modules/x402/x402.controller.ts`
- `backend/src/modules/x402/x402.middleware.ts`
- `backend/src/modules/x402/x402.payment.service.ts`
- `backend/src/modules/x402/x402.receipt.ts`
- `backend/src/tests/x402.config.spec.ts`
- `backend/src/tests/x402.controller.spec.ts`
- `backend/src/tests/x402.middleware.spec.ts`
- `contracts/src/core/StemMarketplaceV2.sol`
- `contracts/test/unit/StemMarketplace.t.sol`
- `web/src/lib/x402Pay.ts`
- `docs/architecture/x402_payments.md`
- `docs/deployment/environment.md`
- `docs/features/README.md`
- `docs/features/agent-commerce-runtime.md`
- `docs/smart-contracts/marketplace_integration.md`

### Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none in the changed code.
- Low: none in the changed code.

### Notes

- `X402_SETTLEMENT_PRIVATE_KEY` is read from backend configuration, validated as
  a 32-byte hex private key, and never exposed to browser code or docs as a
  literal value.
- The backend requires the settlement wallet derived from
  `X402_SETTLEMENT_PRIVATE_KEY` to match `X402_PAYOUT_ADDRESS`, so the same
  wallet that receives facilitator-settled USDC performs the marketplace
  `approve` and `buyFor` calls.
- Listed x402 purchases require a buyer wallet before a 402 challenge is issued
  and reject active listings that are not priced in the configured x402
  stablecoin asset.
- Failed contract settlement is recorded as a non-downloadable
  `contract_settlement_failed` ledger row, and the controller does not fetch or
  serve audio until settlement is `contract_backed` or otherwise
  `download_granted`.
- The backend verifies the marketplace transaction receipt contains the expected
  `Sold(listingId,buyer,...)` event before marking a receipt as
  `contract_backed`.
- Secret, dynamic SQL, unsafe deserialization, and frontend XSS/cookie scans
  found no new issue in the changed files. Broad matches are existing env-var
  names and server-side `process.env` reads.

### Commands Run

```bash
cd backend && npx jest --runInBand src/tests/x402.controller.spec.ts src/tests/x402.middleware.spec.ts src/tests/x402.config.spec.ts src/tests/x402.receipt.spec.ts src/tests/payment_router.spec.ts
cd backend && npm run lint
cd backend && npm test
cd web && npm run lint
cd web && npx vitest run src/lib/x402Pay.test.ts src/lib/buyPricing.test.ts
forge test --match-contract StemMarketplaceTest
forge test
git diff --check
rg -n 'password|secret|api_key|private_key|process\.env|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|sk-[A-Za-z0-9]|ghp_|gho_|AIza' backend/src/modules/x402 backend/src/tests/x402.config.spec.ts backend/src/tests/x402.controller.spec.ts backend/src/tests/x402.middleware.spec.ts web/src/lib/x402Pay.ts docs/architecture/x402_payments.md docs/deployment/environment.md docs/features/agent-commerce-runtime.md docs/features/README.md docs/smart-contracts/marketplace_integration.md --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw|JSON\.parse|eval\(' backend/src/modules/x402
rg -n 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/lib/x402Pay.ts
rg -n '\.call\{|_safeMint|_safeTransfer|safeTransferFrom|onlyOwner|onlyRole|_checkRole|require.*msg\.sender|selfdestruct|delegatecall|tx\.origin|unchecked|assembly' contracts/src
```

## Addendum: #472 Rights Verification Workflow

Reviewed the #472 rights-verification workflow changes for backend routing
classification, trusted-source operator review, evidence handling, and frontend
rendering. No Critical or High findings were identified in the changed code.

### Scope

- `backend/src/modules/rights/upload-rights-policy.ts`
- `backend/src/tests/upload-rights-policy.spec.ts`
- `backend/src/tests/upload-rights-routing.integration.spec.ts`
- `web/src/components/disputes/AdminDisputeQueue.tsx`
- `web/src/lib/verificationSemantics.ts`
- `docs/architecture/upload_rights_routing_policy.md`
- `docs/features/README.md`
- `docs/features/rights_verification_workflow.md`

### Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none in the changed code.
- Low: none in the changed code.

### Notes

- The backend change adds deterministic uploader classification to the existing
  upload-rights policy. It does not add a new controller, authentication path,
  database query shape, raw SQL, deserialization path, secret handling, or
  environment-specific configuration value.
- Trusted-source review actions in the admin queue use existing authenticated
  API client methods and existing backend review endpoints.
- The frontend renders trusted-source and evidence data as React text nodes and
  regular links with `rel="noopener noreferrer"`; no `innerHTML` or
  `dangerouslySetInnerHTML` path is introduced.
- The only external URL composition added in the admin queue normalizes a
  trusted-source domain into an HTTPS URL for reviewer convenience; it does not
  execute user-provided markup.
- Secret, dynamic SQL, unsafe deserialization, and frontend XSS/cookie scans
  found no new issue in the changed files.

### Commands Run

```bash
cd backend && npm run test -- upload-rights-policy.spec.ts
cd backend && npm run test:integration -- --testPathPattern='trusted-source.service.integration|upload-rights-routing.integration|rights-route-reassessment.integration'
cd backend && npm run lint
cd web && npx vitest run src/lib/api.test.ts src/lib/__tests__/rightsOnboarding.test.ts
cd web && npm run lint
git diff --check
rg -n 'password|secret|api_key|private_key' backend/src/modules/rights backend/src/tests/upload-rights-policy.spec.ts backend/src/tests/upload-rights-routing.integration.spec.ts --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/rights
rg -n 'JSON\.parse|eval\(' backend/src/modules/rights
rg -n 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/components/disputes web/src/lib/verificationSemantics.ts
```

## Addendum: #356 License-Tier Marketplace Listings

Reviewed the #356 license-tier listing changes for backend listing indexing,
metadata API output, purchase persistence, and frontend tier selection. No
Critical or High findings were identified in the changed code.

### Scope

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260518173000_stem_listing_license_type/migration.sql`
- `backend/src/events/event_types.ts`
- `backend/src/modules/contracts/contracts.service.ts`
- `backend/src/modules/contracts/metadata.controller.ts`
- `backend/src/modules/shared/events.gateway.ts`
- `backend/src/tests/flow2_contracts.integration.spec.ts`
- `web/src/app/marketplace/page.tsx`
- `web/src/components/marketplace/BuyModal.tsx`
- `web/src/components/marketplace/LicenseTypeSelector.tsx`
- `web/src/components/marketplace/MintStemButton.tsx`
- `web/src/hooks/useContracts.ts`
- `web/src/hooks/useWebSockets.ts`
- `web/src/lib/api.ts`
- `web/src/styles/license-badges.css`
- `docs/features/agent-commerce-runtime.md`
- `docs/features/README.md`

### Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none in the changed code.
- Low: none in the changed code.

### Notes

- `licenseType` is constrained to the existing Prisma enum and normalized to
  the three currently purchasable listing tiers before persistence.
- `StemListingIntent` stores post-transaction listing metadata from the
  frontend notification path and is keyed by transaction hash plus token ID; it
  does not store secrets or payment proofs.
- Marketplace listing reads continue to use Prisma query builders and enum
  filters, not dynamic SQL.
- The public metadata listing endpoint still returns marketplace metadata only;
  it does not add new authentication bypasses or owner-only state.
- Frontend tier selection renders structured React state and disables missing
  tier listings; it does not introduce `innerHTML`, cookie handling, or exposed
  client secrets.
- Broad security scans still report pre-existing development secret names,
  Prisma raw queries, and JSON parsing outside this change set. No new Critical
  or High issue was introduced by this branch.

### Commands Run

```bash
cd backend && npm run lint
cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='flow2_contracts.integration'
cd web && npm run lint -- src/app/marketplace/page.tsx src/components/marketplace/BuyModal.tsx src/components/marketplace/LicenseTypeSelector.tsx src/hooks/useContracts.ts src/hooks/useWebSockets.ts src/lib/api.ts
git diff --check
rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg 'JSON\.parse|eval\(' backend/src/
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/contracts/metadata.controller.ts backend/src/modules/contracts/contracts.service.ts
rg '@Body\(\)|@Query\(\)|@Param\(' backend/src/modules/contracts/metadata.controller.ts
rg 'dangerouslySetInnerHTML|innerHTML' web/src/
rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/
rg 'document\.cookie|setCookie|httpOnly.*false' web/src/
```

## Addendum: #859 Listed x402 Settlement Gating

Reviewed the #859 listed-stem x402 settlement gating changes for public config,
middleware preflight, controller settlement handling, marketplace listing
payment-token reconciliation, WebSocket listing notifications, and the
marketplace buy modal. No Critical or High findings were identified in the
changed code.

### Scope

- `backend/src/modules/x402/x402.public.controller.ts`
- `backend/src/modules/x402/x402.middleware.ts`
- `backend/src/modules/x402/x402.controller.ts`
- `backend/src/modules/contracts/contracts.service.ts`
- `backend/src/modules/contracts/metadata.controller.ts`
- `backend/src/modules/shared/events.gateway.ts`
- `backend/src/events/event_types.ts`
- `backend/src/tests/flow2_contracts.integration.spec.ts`
- `backend/src/tests/metadata.controller.integration.spec.ts`
- `backend/src/tests/x402.public-config.spec.ts`
- `backend/src/tests/x402.middleware.spec.ts`
- `backend/src/tests/x402.controller.spec.ts`
- `web/src/hooks/useX402PublicConfig.ts`
- `web/src/components/marketplace/BuyModal.tsx`
- `docs/features/agent-commerce-runtime.md`
- `docs/features/README.md`

### Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none in the changed code.
- Low: none in the changed code.

### Notes

- Listed-stem x402 requests are rejected before payment challenge when
  marketplace contract settlement is not configured.
- The smart-account/controller path no longer serves audio for listed stems
  that would produce `contract_required_missing`.
- Public x402 config exposes only a boolean settlement capability flag, not
  secrets or private settlement wallet data.
- Listing intent reconciliation and listing-read backfill update native fallback
  rows with the frontend selected payment token, keeping stablecoin listing
  display consistent without exposing privileged signer data.
- The marketplace modal hides x402 for finite listings unless the selected
  listing uses the configured x402 asset on the configured x402 chain and
  contract-backed settlement is enabled.

### Commands Run

```bash
cd backend && npm run lint
cd backend && npx jest --runInBand src/tests/x402.controller.spec.ts src/tests/x402.middleware.spec.ts src/tests/x402.public-config.spec.ts
cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='metadata.controller.integration' --testNamePattern='hydrates an indexed listing|backfills native fallback listing rows'
cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='flow2_contracts.integration'
cd web && npm run lint -- src/components/marketplace/BuyModal.tsx src/hooks/useX402PublicConfig.ts
```

The broader `metadata.controller.integration` suite was also sampled while
testing the reconciliation path; it still has an unrelated content-protection
diagnostic assertion that fails when the local Anvil fallback contract is not
deployed.

## Addendum: #867 Analytics Event Ledger

Reviewed the analytics event ledger branch covering shared event validation,
durable Postgres analytics event storage, warehouse export layers, producer
instrumentation helpers, retention/deletion/consent governance, maintenance
cleanup wiring, and current artist report reads from generated analytics facts.
No Critical or High findings were identified in the changed code.

### Scope

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260520090000_analytics_event_ledger/migration.sql`
- `backend/src/modules/analytics/analytics_event.ts`
- `backend/src/modules/analytics/analytics_event_store.ts`
- `backend/src/modules/analytics/analytics_governance.service.ts`
- `backend/src/modules/analytics/analytics_instrumentation.service.ts`
- `backend/src/modules/analytics/analytics_warehouse.ts`
- `backend/src/modules/analytics/analytics_ingest.service.ts`
- `backend/src/modules/analytics/analytics.service.ts`
- `backend/src/modules/analytics/analytics.controller.ts`
- `backend/src/modules/analytics/analytics.module.ts`
- `backend/src/modules/maintenance/maintenance.controller.ts`
- `backend/src/modules/maintenance/maintenance.module.ts`
- `backend/src/modules/maintenance/maintenance.service.ts`
- `backend/src/tests/analytics*.spec.ts`
- `docs/rfc/analytics-event-ledger.md`
- `docs/features/analytics_event_ledger.md`
- `docs/features/analytics_dashboard_v0.md`
- `docs/features/README.md`
- `docs/architecture/data_model_storage_plan.md`
- `docs/architecture/event_taxonomy_domain_model.md`
- `docs/compliance/security_review_data_retention.md`
- `docs/deployment/environment.md`

### Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none in the changed code.
- Low: none in the changed code.

### Notes

- The analytics controller remains protected by the existing JWT guard, and the
  new retention cleanup endpoint remains admin-only behind the JWT and roles
  guards.
- Event ingestion now validates envelopes with Zod before persistence, requires
  a consent basis for personal/sensitive events, and quarantines invalid or
  unsupported records in the export layer instead of silently accepting them as
  report facts.
- Durable storage uses Prisma model operations and idempotent `eventId` upserts;
  no dynamic raw SQL was introduced in the analytics ledger path.
- Warehouse project/dataset and retention windows are configurable through
  documented environment variables with local-development fallbacks.
- Broad repository scans still report pre-existing items outside this branch,
  including development JWT fallbacks and existing raw Prisma template queries.
  No new Critical or High issue was introduced by this branch.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg -n 'JSON\.parse|eval\(' backend/src/
rg -n '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/analytics backend/src/modules/maintenance
rg -n '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/analytics backend/src/modules/maintenance
rg -n 'ANALYTICS_|GCP_PROJECT_ID|dev-secret|0x[0-9a-fA-F]{64}|AIza|ghp_|gho_|sk-[A-Za-z0-9]' backend/src/modules/analytics backend/src/modules/maintenance backend/prisma docs/rfc/analytics-event-ledger.md docs/features/analytics_event_ledger.md docs/deployment/environment.md
cd backend && npm run lint
cd backend && npm run test -- --runInBand
cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js src/tests/analytics_event_store.integration.spec.ts
cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js src/tests/analytics_instrumentation.integration.spec.ts
cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js src/tests/analytics_governance.integration.spec.ts
git diff --check
```

## Addendum: Release Artist Credits And Uploader Catalog Split

Reviewed the release/track artist-credit fix, including public catalog artist
grouping, authenticated managed-catalog grouping, public artist discography
filtering, ingestion metadata normalization, release-page display logic, tests,
and feature docs. No Critical or High findings were identified in the changed
code.

### Scope

- `backend/src/modules/catalog/catalog.service.ts`
- `backend/src/modules/ingestion/ingestion.service.ts`
- `backend/src/tests/catalog.integration.spec.ts`
- `backend/src/tests/ingestion_metadata.spec.ts`
- `web/src/app/page.tsx`
- `web/src/app/release/[id]/page.tsx`
- `docs/features/README.md`
- `docs/features/catalog_indexing_mvp.md`

### Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none in the changed code.
- Low: none in the changed code.

### Notes

- The catalog change narrows public artist discography reads by matching
  `primaryArtist` to the profile display name, while keeping authenticated
  owner reads scoped to the uploader profile. It does not introduce a new
  controller or authentication boundary.
- The new Prisma filtering composes the public rights-route filter and the
  artist-credit filter under `AND`, avoiding dynamic SQL and preserving the
  existing public visibility policy.
- The ingestion metadata cleanup normalizes plain strings only and does not
  deserialize untrusted structures beyond the pre-existing upload metadata JSON
  parse in the controller.
- The frontend changes render existing catalog strings through React text nodes;
  no `dangerouslySetInnerHTML`, direct cookie access, or client-exposed secret
  configuration was introduced.
- Broad scoped scans still report pre-existing public catalog endpoints and
  existing Prisma template raw queries used for legacy cleanup; no new Critical
  or High issue was introduced by this branch.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key' backend/src/modules/catalog backend/src/modules/ingestion --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw|\$executeRaw' backend/src/modules/catalog backend/src/modules/ingestion
rg -n '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/catalog backend/src/modules/ingestion | grep -v 'Guard\|Auth'
rg -n 'JSON\.parse|eval\(' backend/src/modules/catalog backend/src/modules/ingestion
rg -n '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/catalog backend/src/modules/ingestion | grep -v 'Pipe\|Dto\|Validation'
rg -n 'dangerouslySetInnerHTML|innerHTML' web/src/app/page.tsx 'web/src/app/release/[id]/page.tsx'
rg -n 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/app/page.tsx 'web/src/app/release/[id]/page.tsx'
cd backend && npx jest --runInBand src/tests/ingestion_metadata.spec.ts
cd backend && npm run lint
cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js src/tests/catalog.integration.spec.ts
cd web && npm run lint
cd web && npm run build
git diff --check
```

## Addendum: #879 Analytics Warehouse Loading And Backfill

Reviewed the analytics warehouse loader/backfill slice for #879, including
scoped event listing, schema-version quarantine, local JSONL loading, BigQuery
insert-all loading, admin maintenance endpoints, and related tests/docs. No
Critical or High findings were identified in the changed code.

### Scope

- `backend/src/modules/analytics/analytics_event_store.ts`
- `backend/src/modules/analytics/analytics_warehouse.ts`
- `backend/src/modules/analytics/analytics_warehouse_loader.ts`
- `backend/src/modules/analytics/analytics.module.ts`
- `backend/src/modules/maintenance/maintenance.controller.ts`
- `backend/src/modules/maintenance/maintenance.service.ts`
- `backend/src/tests/analytics_warehouse_loader.spec.ts`
- `backend/src/tests/analytics_warehouse_loader.integration.spec.ts`
- `docs/architecture/data_model_storage_plan.md`
- `docs/deployment/environment.md`
- `docs/features/README.md`
- `docs/features/analytics_event_ledger.md`

### Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none in the changed code.
- Low: none in the changed code.

### Notes

- The new loader/backfill routes are admin-only under the existing JWT and
  roles guards.
- The local JSONL target writes to a configured server-side directory and uses
  idempotent row keys, atomic temp-file replacement, and no user-controlled file
  names.
- The BigQuery target uses Google ADC through `google-auth-library`; no service
  account keys, tokens, or credentials are stored in source.
- Unsupported event versions are written to raw/quarantine and do not get
  promoted into clean/fact/view layers.
- No raw SQL, dynamic query construction, shell execution, or new unauthenticated
  controller path was introduced.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|ghp_|gho_|sk-[A-Za-z0-9]' backend/src/modules/analytics backend/src/modules/maintenance backend/src/tests/analytics_warehouse_loader.spec.ts backend/src/tests/analytics_warehouse_loader.integration.spec.ts --iglob '!*.test.*'
rg -n 'rawQuery|executeRaw|\$queryRaw|eval\(' backend/src/modules/analytics backend/src/modules/maintenance backend/src/tests/analytics_warehouse_loader.spec.ts backend/src/tests/analytics_warehouse_loader.integration.spec.ts
rg -n 'JSON\.parse|client\.request|readFile|writeFile|rename|mkdir' backend/src/modules/analytics/analytics_warehouse_loader.ts backend/src/modules/maintenance backend/src/tests/analytics_warehouse_loader.spec.ts backend/src/tests/analytics_warehouse_loader.integration.spec.ts
rg -n '@Controller|@Get|@Post|@Put|@Delete|@Patch|@UseGuards|@Roles|@Body' backend/src/modules/maintenance backend/src/modules/analytics
cd backend && npm run lint
cd backend && npm run test -- --runInBand
cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js src/tests/analytics_warehouse_loader.integration.spec.ts
git diff --check
```

## Addendum: #886 Analytics Pub/Sub Event Publisher

Reviewed the backend analytics Pub/Sub publisher slice for #886, including
disabled-by-default publishing configuration, Pub/Sub message attributes,
non-strict and strict publish-failure behavior, structured logging, and related
tests/docs. No Critical or High findings were identified in the changed code.

### Scope

- `backend/src/modules/analytics/analytics_event_publisher.ts`
- `backend/src/modules/analytics/analytics_ingest.service.ts`
- `backend/src/modules/analytics/analytics.module.ts`
- `backend/src/tests/analytics_event_publisher.spec.ts`
- `docs/deployment/environment.md`
- `docs/features/README.md`
- `docs/features/analytics_event_ledger.md`

### Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none in the changed code.
- Low: none in the changed code.

### Notes

- Pub/Sub publishing is disabled by default and must be explicitly enabled by
  environment configuration.
- The publisher uses Google Cloud Pub/Sub Application Default Credentials
  through the existing runtime environment; no service account key, token, or
  credential value is stored in source.
- Non-strict publish failures are logged with structured metadata and do not
  replace or interrupt analytics ledger persistence.
- Strict mode is opt-in for environments that intentionally want analytics
  ingestion to fail when Pub/Sub publishing fails.
- No raw SQL, shell execution, dynamic code execution, new unauthenticated
  controller path, or user-controlled filesystem path was introduced.

### Commands Run

```bash
rg -n '(secret|password|private[_-]?key|api[_-]?key|token|authorization|Bearer|BEGIN |0x[a-fA-F0-9]{64})' backend/src/modules/analytics backend/src/tests/analytics_event_publisher.spec.ts docs/deployment/environment.md docs/features/analytics_event_ledger.md docs/features/README.md
cd backend && npx jest --runInBand src/tests/analytics_event_publisher.spec.ts src/tests/analytics_event.spec.ts
cd backend && npm run lint
cd backend && npm run test
git diff --check
```
