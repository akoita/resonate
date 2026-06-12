---
title: "Implementation Plan: Remix Studio Queue-Backed Generation Jobs"
status: draft
owner: "@akoita"
issues:
  - "https://github.com/akoita/resonate/issues/1167"
related:
  - docs/features/remix_studio.md
  - docs/features/remix_studio_backlog.md
  - docs/issue-1165-implementation-plan.md
  - backend/src/modules/generation/generation.processor.ts
---

# Implementation Plan: #1167 Remix Studio Queue-Backed Generation Jobs

Branch: `feat/1167-remix-queue-generation-jobs`

Backlog D3 moves Remix Studio generation off the HTTP request path. The
endpoint should validate ownership, rate limits, rights, mode/prompt, and
constraint bounds, then enqueue a BullMQ job and return the updated project
state immediately. The worker owns the long provider/storage call and records
the terminal project state.

## Decisions

- `force` remains accepted for one compatibility slice but is deprecated in
  favor of explicit retry semantics. The frontend should send `retry: true`
  when replacing a completed or failed generation; `force` maps to the same
  backend behavior and docs should call it legacy.
- BullMQ retries should not call the provider multiple times after an ambiguous
  successful vendor/store write. Use a stable project-scoped job id plus
  project metadata checks so retries are idempotent; prefer `attempts: 1` unless
  a retry can prove no output was recorded.
- Duplicate prevention must be a conditional database write before enqueue, not
  a read-then-act check.

## Slice 1 - Backend job state and queue wiring

Add queue-backed remix generation alongside the existing provider boundary:

- register a Remix generation BullMQ queue in `RemixModule`;
- add a `RemixGenerationProcessor` following the existing
  `GenerationProcessor` shape;
- add service methods that separate enqueue-time validation from worker-time
  execution;
- write `generationMetadata.status` values such as `pending`, `completed`, and
  `failed`, plus `requestedAt`, `completedAt`, `failedAt`, `errorCode`,
  `errorMessage`, retry marker, constraints, policy version, and output
  metadata;
- keep `generationProvider` and `generationJobId` populated before enqueue so
  project reads can show pending state immediately.

The conditional claim should update only when no active job is recorded. A
completed or failed job may be replaced only by explicit retry.

## Slice 2 - Enqueue endpoint semantics

Change `POST /remix/projects/:id/generate` so it:

- validates #1162 constraints before any project or provider work;
- enforces #1144 generation rate limits before enqueue;
- re-checks draft status, mode/prompt requirements, ownership, and eligibility
  before enqueue;
- prevents duplicate active jobs with a conditional write;
- publishes `remix.generation_started` with the job id after the enqueue claim;
- returns the project state with pending metadata instead of blocking for the
  provider call.

The response remains the existing `RemixProject` shape so the web client can
keep refetching with `GET /remix/projects/:id`.

## Slice 3 - Worker execution and terminal events

The worker loads the claimed project by job id, rebuilds the
`RemixGenerationInput`, calls `RemixGenerationProvider.createRemixDraft`, and
records one terminal outcome:

- success writes provider output, mime type, cost/provenance, `completedAt`,
  and status `completed`;
- success publishes a new `remix.generation_completed` event containing the
  remix project id, creator id, source track id, provider, job id, mode, and
  policy version;
- failure normalizes unknown exceptions into the existing
  `RemixGenerationProviderError` contract, writes status `failed` with a
  normalized error, and publishes `remix.generation_failed` carrying the job id;
- exhausted worker errors must not leave a project permanently pending.

## Slice 4 - Analytics bridge and event types

Extend backend event typing and analytics bridge configuration:

- add `RemixGenerationCompletedEvent`;
- add `generationJobId` to failed generation events;
- map `remix.generation_completed` in
  `analytics_domain_event_bridge.service.ts`;
- update analytics event ledger docs without changing the product analytics
  allow-list.

## Slice 5 - Studio polling and retry UI

Update the web Remix Studio flow:

- extend `RemixProject` generation metadata typing with status/error/output;
- make `generateRemixDraft` accept `retry?: boolean` while preserving legacy
  `force?: boolean`;
- after enqueue, show a pending state in the Draft status panel and poll/refetch
  `GET /remix/projects/:id` until status is `completed` or `failed`;
- disable generate while pending and show the pending job id;
- show normalized failure copy and an explicit retry action;
- only show the C3 play control when completed output metadata has an output URI;
- stop and revoke cached draft playback blobs when a new pending generation is
  enqueued or a retry starts.

## Slice 6 - Tests

Backend:

- controller/service coverage that invalid constraints and rate limits fail
  before enqueue;
- integration coverage for enqueue response returning quickly with pending
  metadata;
- duplicate active generation returns a conflict/bad request without adding a
  second queue job;
- explicit retry replaces completed/failed metadata and records a new job id;
- worker success records completed metadata and emits
  `remix.generation_completed`;
- worker failure records failed metadata, emits `remix.generation_failed` with
  job id, and never leaves the project pending;
- draft mime type from #1166 remains written in output metadata.

Web:

- API helper tests for retry payload and metadata parsing;
- component tests for pending copy, polling/refetch completion, failure copy,
  retry action, and play control visibility;
- existing Remix Studio preview/playback tests stay green.

## Docs

- `docs/features/remix_studio.md`: document queued generation lifecycle,
  polling UI, retry semantics, and `remix.generation_completed`.
- `docs/features/remix_studio_backlog.md`: mark D3 implemented once complete.
- `docs/features/analytics_event_ledger.md`: add the new bridged backend event.
- PR summary should cite change-impact checklist areas for API contract,
  backend events/analytics bridge, user-facing Studio state, and validation.

## Commit plan

1. `feat(#1167): enqueue remix generation jobs`
2. `feat(#1167): process remix generation jobs to terminal state`
3. `feat(#1167): poll remix studio generation status`
4. `docs(#1167): document queued remix generation`

## Verification

- Backend: targeted Remix integration tests, queue processor tests, and
  `npm run lint`.
- Web: `npx vitest run src/components/remix`, targeted API helper tests, and
  lint/build for changed files.
- Security/quality: `git diff --check`, hardcoded config/secrets scan, and the
  relevant `/finish-issue` checks before commit/PR.
