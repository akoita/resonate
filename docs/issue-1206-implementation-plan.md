# Issue #1206 — remaining slice: scale-to-zero + studio pre-warm ping

> Plan author: Fable; implementation delegated to Codex CLI (working mode).
> Context: the bulk of #1206 already shipped (worker `workers/stable-audio`
> with startup model warm + mono up-mix, provider
> `audio-conditioned-remix-generation.provider.ts` with full error mapping,
> IAM auth #1327, cold-start survival #1328, IaC scale-to-zero service
> resonate-iac#177/#178). Provider spec: 14/14 green, all four normalized
> error codes + encrypted deferral + env-config knobs covered.

## Operational decision (settled 2026-07-04 by @akoita)

**Scale-to-zero + pre-warm ping.** No `minScale=1` warm instance for now
(~$600–750/mo standing L4 cost pre-revenue contradicts the margin doctrine;
ADR-BM-3 credit billing is not live). Revisit warm/minScale when credits bill
and volume justifies it. The issue's "warm min-instance required" scope is
amended accordingly.

## The slice to implement

When a user opens Remix Studio, fire-and-forget a pre-warm request to the GPU
worker so the ~4-min model load happens while they arrange stems; by Generate
time the instance is usually warm. The worker loads the default model in its
FastAPI lifespan hook, so ANY instance-spinning request triggers the load —
reuse its existing health route.

### Backend (only surface touched)

- New `RemixWorkerPrewarmService` in `backend/src/modules/remix/`:
  - `prewarm(): void` — fire-and-forget (`void`-returning; internally async,
    never throws, never blocks the caller; failures are `log.debug/warn` only).
  - **Gate:** no-op unless the audio-conditioned provider is the active,
    enabled generation kind — REUSE the provider's existing config/enabled
    resolution (do not duplicate env parsing).
  - **Debounce:** in-memory last-attempt timestamp; skip when the last attempt
    is younger than `REMIX_WORKER_PREWARM_TTL_SECONDS` (default 600). One
    in-flight attempt max.
  - **Call:** GET the worker's existing health route using the SAME identity-
    token minting path as the provider (IAM-protected worker); abort after a
    short `AbortSignal.timeout` (~5s is fine — spinning the instance is the
    goal; abandoning the response is expected and must not log as error).
- **Hook:** invoke `prewarm()` from the existing backend path(s) the studio
  hits on load — the remix project GET (and/or eligibility check) in the remix
  controller/service. No new route, no web changes. Keep the call site
  one-line and non-blocking.
- Bind the service in `RemixModule`.

### Tests (backend/src/tests, existing conventions)

- New `remix-worker-prewarm.spec.ts` (pure unit; mock fetch + token minter —
  external boundary, allowed):
  - no-op when provider kind is not the audio-conditioned one;
  - debounce: second call within TTL does not fetch; after TTL does;
  - identity token attached when mintable; unauthenticated locally;
  - fetch rejection/timeout is swallowed (no throw, no unhandled rejection);
  - hook: project-open path triggers prewarm (extend the existing remix
    project/controller spec minimally).

### Docs

- `docs/features/remix_studio.md`: short honest note — with scale-to-zero
  inference, the first AI draft after idle can take ~4–5 minutes; opening the
  studio pre-warms the worker; subsequent drafts ~seconds.
- User guide (`web/src/lib/help/content.ts`): if the remix article mentions
  generation, add one plain-language sentence about the first-draft warm-up
  wait; keep `npx vitest run src/lib/help` green. Skip if no remix article
  exists.

### Out of scope

- resonate-iac changes (scale-to-zero already deployed there; port-env fix in
  flight on its own branch).
- Warm `minScale=1` (deferred — revisit post ADR-BM-3).
- Frontend changes (studio already calls the hooked endpoint on mount).

## Gates

- `cd backend && npm run lint`
- Focused jest: the new prewarm spec + `remix-audio-conditioned-provider` +
  the touched project/controller spec — all green.
- Help test only if content.ts changed.

## Close-out (reviewer)

- Post checklist evidence on #1206 (spec names for each checklist box, the
  scale-to-zero decision, iac links) and close via the PR.
