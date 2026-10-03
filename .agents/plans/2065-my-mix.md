# #2065 — My Mix

Parent #2061; starts from merged #2064 (`de18f8ac`). ADR-BM-6 Line 4,
Listener Pro phase 4 candidate; basic mixes are free Line 1 engagement.
No fees, payouts, purchase flow, or deployment change.
Status: implemented and locally validated; publication targets only #2065.

## Architecture and ordered ownership

1. Backend worker owns agent modules, sessions preferences/response plumbing,
   discovery-policy quota extension, and backend tests. Add bounded untrusted
   `preferences.myMix`: `{ context?: "morning:weekday" | ...,
   lanes?: Array<{id:string; boost?:boolean}>, additions?: Array<{genre?:string;
   mood?:string}> }`. Omitted lanes means all visible lanes; an explicit empty
   list means removed lanes. Resolve IDs from the authenticated listener's
   current visible lanes on every run, reject unknown/hidden IDs, and accept
   additions only from the catalog vocabulary. Never accept client lane weights
   or labels. Context has only the existing eight coarse buckets.

2. Resolve internal lane requests at the runtime choke point. My Mix uses the
   deterministic orchestrator and deterministic recommendation adapter even
   when model runtimes are configured, ensuring quota and explanation coverage.
   No visible lanes and no valid additions falls back to the existing profile.

3. Compute shares as strength × (1 + current-context weight / largest positive
   context weight), with baseline 1 when no context matches. Boolean boost is
   ×2. Centralize these constants in agent learning configuration. Use
   deterministic largest-remainder allocation over the
   requested batch. Rank each lane with session-request intent. A lane matches
   catalog genre (or catalog mood for a mood-only addition), never fuzzy search
   alone. Apply hidden taste/AI removal, exploration and artist caps globally
   once. Exploration picks count against their matched lane quota where possible.
   Fill outstanding quotas first, transfer unfilled slots to strongest eligible
   lanes, then use the existing #2056 fallback conditions. Coverage preserves
   original requested counts and actual lane assignments; unrelated fallback
   tracks never count as covering a lane.

   Expose JWT `GET /agents/config/session/mix-vocabulary` from canonical
   backend genre/mood constants so additions can include any catalog category,
   rather than only categories already learned.
   Additions are canonical genre/mood lanes with `mix_` plus a stable 32-hex
   digest, median positive learned-lane strength (or 1 with no learned lanes),
   no inferred context/energy, and at most eight resolved lanes total. A pick
   is assigned once, to a matching lane with unmet quota first, strongest on a
   tie. `matched` includes transferred extras and can exceed `requested`.

4. Carry additive `mixCoverage` through adapter, orchestrator, runtime
   normalization and owner-checked next-pick responses:
   `{ lanes: Array<{id:string;label:string;requested:number;matched:number}> }`.
   Record each unmet lane through the existing unmet-demand mechanism, including
   successful batches filled by another lane. Attach catalog lane descriptions
   to pick explanations; preserve discovery reason codes.

   Root review found that live agent events broadcast publicly. Do not place
   lane labels, IDs or coverage in those events. Add owner-checked JWT
   `GET /agents/config/session/:sessionId/mix-coverage` over a bounded ephemeral
   runtime cache (128 sessions maximum) for initial coverage. Bind session start
   and next routes to the authenticated owner before lane reads. Generic live
   event messages may report a gap without naming private lanes. Fully absent
   catalog genres have no artist owner to attribute in existing unmet demand;
   test an exhausted lane against real catalog ownership, never invent an owner.

5. Web worker owns web API types, My Mix helper/editor, presets/session panel,
   pick reason display, focused unit and browser tests. Fetch Taste Memory and
   show My Mix first only with visible lanes. Edit/remove/boost/add before and
   during a session through existing replan flow. No automatic Taste Memory
   writes; explicit save persists only additions and boosted lanes' bounded
   canonical terms through existing catalog boost APIs, never unchanged lanes
   or removed-lane hides. Derive coarse local
   context on the client, never send a clock, timezone or location. Pro controls
   remain hidden behind a centralized OFF entitlement seam; no purchase step.

6. Root owns final integration, architecture/security review, documentation,
   User Guide, screenshot fixture/capture and verification. Update feature
   catalog/page and parent plan, preserve remaining #2066–#2067 tracking.

## Validation

Fixed-clock quota/context tests, sparse lanes/transfer/demand, exploration,
artist window, hidden taste and AI checks; real PostgreSQL Testcontainers for
DB-dependent flows, never Prisma mocks. Web tests cover absence of lanes,
session-only edits/explicit save, hidden Pro controls and mounted replanning.
Run focused backend tests/type/lint, web unit suite/lint/build, help integrity,
browser smoke, screenshot inspection and diff check. Broad integration sweeps
remain CI scope. Maestro root and existing Luna/max worker routing verified.

## Dependency reconciliation

#2059 remains open at this base. Its request-first ranking seam is required by
My Mix, so the backend worker also owns a narrow optional `sessionRequest`
context in `discovery-ranking.service.ts`: canonical genre/mood matches add
`session_request` at `DECLARED_PREFERENCE_WEIGHT` (20), above the learned cap
(18). Only My Mix lane ranking supplies it in this slice. Home and no-request
behavior remain unchanged. The broader ordinary-session/preset corrections in
#2059 remain tracked there; this branch does not close that issue.

Privacy review expanded session route owner checks because My Mix returns
private learned labels. The public agent event feed remains generic for mixes.
A warehouse bridge fixture and public gateway test verify that lane preferences
and coverage do not enter those outputs.

Final lifecycle review requires validation before remembering a next-pick edit,
so rejected lane IDs cannot poison continuation preferences. In-flight frontend
replans and manual picks must ignore responses after a newer mix edit or session
change. Actual lane explanations appear first because the pick card displays
only the first two reasons. These corrections preserve the original worker
ownership and routing.

## Retrieval and performance scope

Search each lane's two strongest genres and strongest mood, while retaining all
canonical terms for metadata matching and ranking. This bounds additional
catalog queries; the existing per-query candidate bound and first-listener
validation cap still apply. Coverage describes the retrieved selection, not an
exhaustive scan of the catalog. Do not bypass failed first-listener validation.

The Home change adds signed-in reads and a quick-start/editor inside the
existing AI DJ section. Local browser checks cover mounted behavior and layout.
The five-pair Home performance comparison requires the existing comparable
staging target/machine; no such baseline is available in this task. Record that
comparison as a pre-publication deployment validation deferral rather than
claiming a performance improvement from a local mock.

## Completed local checks

- Web unit suite: 213 files, 2,553 tests. The subsequent stale-response change
  passed the affected session panel's 38 tests and focused ESLint.
- Mounted Chromium My Mix flow: one test covering start, session-only edits,
  partial and empty coverage, explicit save, and hidden Pro controls.
- Web package lint: no errors; 12 pre-existing warnings outside this change.
- Web production build: TypeScript and all 70 routes passed. The existing
  `ox` dynamic-dependency warning remains; generated build metadata was restored.
- Backend focused unit/HTTP run: eight suites, 124 tests. Additional context
  allocation and shared-policy acceptance checks: three tests. Public event gateway privacy:
  17 tests; warehouse event compaction: eight tests.
- Runtime adapter/orchestrator/normalization/fallback regressions: four suites,
  32 tests. Real PostgreSQL/Testcontainers: controller/history/lane/selector/
  runtime boundaries (three tests) and sessions/demand persistence (13 tests).
  Backend `npm run lint` passed.
- Refreshed AI DJ and Settings guide screenshots were visually inspected.
  Local Markdown links and `git diff --check` passed.

Root diff review covered JWT ownership, fresh server lane resolution, input
bounds and canonical vocabulary, rejection before preference mutation, public
event privacy, cache ownership, and the existing policy and unmet-demand trust
paths. The AI review confirmed that My Mix bypasses model runtimes and accepts
no model-supplied lane plan, new tool authority, or purchase instruction. No
unresolved security finding remains in the reviewed changes. Broader backend
integration sweeps remain CI scope; no schema, environment, dependency,
contract, fee, payout, or deployment wiring changed.
