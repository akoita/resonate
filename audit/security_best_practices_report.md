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
