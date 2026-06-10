---
title: "Implementation Plan: RemixGenerationProvider Interface"
status: draft
owner: "@akoita"
issues:
  - "https://github.com/akoita/resonate/issues/891"
  - "https://github.com/akoita/resonate/issues/896"
related:
  - docs/rfc/remix-studio.md
  - docs/rfc/ai-derivative-rights-policy.md
  - docs/features/remix_studio_backlog.md
  - docs/issue-895-implementation-plan.md
---

# Implementation Plan: #896 RemixGenerationProvider

Branch: `feat/896-remix-generation-provider`

Adds the backend provider boundary for AI-assisted remix draft generation
(backlog D1) and wires `POST /remix/projects/:id/generate` to it. The first
provider is a deterministic stub, disabled by config in production — the
boundary, policy context, provenance shape, and normalized errors are the
deliverable. A real provider (D2) and queue-backed jobs (D3) follow.

## Backend-only scope

The studio UI already renders generation state (`generationJobId`/provider in
the draft status panel); a user-facing Generate button ships with the first
real provider (D2), so no frontend changes beyond none. The status-panel copy
stays accurate ("No AI draft yet").

### 1. Provider boundary (`backend/src/modules/remix/remix-generation.provider.ts`)

- `REMIX_GENERATION_PROVIDER` DI token + `RemixGenerationProvider` interface
  per the RFC shape:

  ```ts
  createRemixDraft(input: RemixGenerationInput): Promise<RemixGenerationJob>
  ```

- `RemixGenerationInput` carries explicit rights/policy context:
  `sourceTrackId`, `stemIds`, `mode`, `prompt?`, `constraints`
  (`durationSeconds?`, `bpm?`, `key?`, `explicitAllowed?`), and `provenance`
  (`remixProjectId`, `creatorUserId`, `licenseType`, `licenseId?`,
  `sourceRightsRoute`, `sourceContentStatus`, `sourcePolicyVersion`,
  `voiceLikenessAllowed: false` — hard-disabled in the MVP policy context,
  typed as `false` so a provider cannot receive `true` without a type change).
- `RemixGenerationJob` output: `provider`, `jobId`, `estimatedCostUsd?`,
  `outputMetadata` placeholders (`outputUri: null`, `synthIdPresent: null`,
  `seed: null`, `sampleRate: null`).
- `RemixGenerationError`: normalized shape `{ code, message, retryable }`
  with codes `provider_disabled`, `invalid_input`, `provider_rejected`,
  `provider_unavailable` — mirroring the catalog generation stack's
  `normalizeGenerationErrorMessage` categories so D2 can map Lyria errors
  directly.
- Pure `buildRemixGenerationInput(project, options)` so input construction
  (including the forced `voiceLikenessAllowed: false`) is unit-testable.

### 2. Stub provider, disabled by config

- `StubRemixGenerationProvider` implements the interface:
  - `REMIX_GENERATION_ENABLED !== "true"` (default) → throws normalized
    `provider_disabled` ("AI remix generation is not enabled on this
    environment yet").
  - Enabled (dev/test) → returns a deterministic job
    (`provider: "remix-stub"`, derived jobId, `estimatedCostUsd` from the
    same $0.06/30s model as catalog generation) without producing audio.
- Registered as the default binding for `REMIX_GENERATION_PROVIDER` in
  `RemixModule`; swapping in Lyria/audio-conditioned/DSP providers later is a
  module-level binding change, not a service change.

### 3. Endpoint wiring (`POST /remix/projects/:id/generate`)

In `RemixProjectService.generateDraft(userId, projectId, options?)`:

1. Owner check (existing `loadOwnedProject`).
2. **Eligibility re-check** via `RemixEligibilityService` — generation is a
   rights-relevant action, so creation-time eligibility is not trusted
   (fulfils the re-check note added in #895); denial → 403 with the full
   eligibility payload + `remix.policy_rejected`/`remix.license_required`
   events (same denial path as creation).
3. Validation: prompt required for `variation`/`extension`; prompt ignored
   (not sent to the provider) for `stem_mix` per the #895 note; reject when a
   generation job is already recorded and `force` is not set (D3 owns real
   retry semantics).
4. Call the provider; persist `generationProvider`, `generationJobId`,
   `generationMetadata` (input echo minus prompt + output placeholders +
   estimated cost + requested-at policy version) on the project.
5. Events: `remix.generation_started` on success;
   `remix.generation_failed` (with the normalized error code) on provider
   failure — both typed in `event_types.ts` and mapped in the analytics
   bridge with compact payloads (no prompt text).
6. Controller maps normalized errors: `provider_disabled`/
   `provider_unavailable` → 503, `invalid_input` → 400,
   `provider_rejected` → 422; the JSON body carries `{ code, message,
   retryable }` for the studio's status panel.

### 4. Tests

- `remix-generation.spec.ts` (pure unit): input builder (field mapping,
  prompt stripped for stem_mix, `voiceLikenessAllowed` always false),
  stub provider disabled/enabled behavior, cost estimation, error
  normalization.
- `remix.integration.spec.ts` additions: generate happy path with stub
  enabled (metadata persisted, started event), disabled-by-config 503 shape,
  eligibility re-check denial (blocked source → 403 + policy_rejected),
  duplicate-job rejection, ownership.
- `remix.controller.http.spec.ts`: route, guard, status-code mapping.

### 5. Docs

- `docs/deployment/environment.md`: `REMIX_GENERATION_ENABLED` (and its
  default-off posture).
- `docs/features/remix_studio.md` + catalog row: generate endpoint,
  provider boundary, env var, normalized error contract.
- `docs/features/remix_studio_backlog.md`: D1 shipped; D2/D3 remain.

## Commit plan

1. `feat(#896): add RemixGenerationProvider boundary with stub provider`
2. `feat(#896): wire POST /remix/projects/:id/generate with policy re-check`
3. `docs(#891): document remix generation provider boundary and env`

## Verification

- Backend lint/typecheck, remix unit + integration suites, HTTP contract.
- Security scan greps + `git diff --check` + audit report entry.
- No frontend changes → no web build gate (vitest sweep only if api.ts
  touched — it is not).
