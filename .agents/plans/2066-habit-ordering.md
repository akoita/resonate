# #2066 — Habit-aware ordering

Parent #2061. Depends on #2065 (PR #2072, merge pending at start).
ADR-BM-6 Line 4 Listener Pro, phase 4 candidate; default ordering is free.
No fee, payout, purchase, generation, deployment or schema change.

## Integration boundary

Create the branch from fetched main. Implement independent new files while
#2072 finishes CI; incorporate its merged main before changing shared runtime
files. Root handles the #2072 integration regression separately on its branch.
Order only a server-resolved My Mix after selection/policy and before mixer
planning. Preserve the exact selected objects and coverage; ordinary sessions
retain their existing order. #1971 is open and gated, so tempo/Camelot sequencing
and DSP transitions remain future work, with a clean post-lane-run seam.

## Pure ordering contract (worker 1)

Own new `backend/src/config/habit_ordering.ts`,
`backend/src/modules/agents/habit_ordering.ts` and
`backend/src/tests/habit_ordering.spec.ts` only.

Central defaults: minimum decayed transition evidence 3; pair evidence 1;
short-run target 3 and maximum 4; early skip at no more than 30 seconds AND
25% of known positive duration. A learned large energy jump requires at least
3 decayed positive examples and a positive share of at least 0.75. Import the
existing 60-day behavioral half life and bounded history limits.

Export `HabitOrderingObservation`: stable `id`, `sessionKey`, `trackId`,
`createdAt: Date`, `action`, optional `playbackInstanceId`, `agentSessionId`,
`laneId`, `energyBand`, `energySource`, `positionMs`, `durationMs`.
Export `HabitTransition`: `fromLaneId`, `toLaneId`, decayed `good`, `bad`,
`largeEnergyGood`. Export `HabitOrderingState`: `transitions` plus optional
`previous: {laneId?: string, energyBand?: low|medium|high, runLength: number}`.
`deriveHabitOrderingState(observations, now, agentSessionId?)` returns only these
aggregates/state, never track/session identifiers or raw sequences.

An episode begins with accept/start; outcomes attach by session+instance+track.
Duplicate starts/outcomes count once. With no instance ID, only the current
same-track started episode can receive an outcome; ambiguous/late outcomes do
not fabricate transitions. Completion/replay/save are good; a measured early
skip is bad and wins conflicting outcomes. Other actions do not teach a pair.
Sort starts by timestamp then stable ID, never outcome time. Count adjacent
started episodes within the same browser session, using the destination's
outcome and 60-day decay at its start. Missing/hidden lane episodes break the
chain. Missing starts yield neutral ordering. Only measured energy contributes
to large-jump evidence. Boundary state comes from the latest started episode
associated with the current agent session, including its trailing lane run.

Export `HabitOrderTrack`: `id`, `rank` (original unique index), optional `laneId`,
`energyBand`, `energySource`. `orderHabitTracks(tracks, state, laneStrengths)`
returns a permutation of the same descriptor objects. Reject no track and
create none. Stable ties use original rank then ID. Below threshold, use
strongest lane, measured energy continuity, then rank. Continue a short lane
run where possible, switching after the target/max when an acceptable
alternative exists. With learned evidence, avoid negative lane transitions
when an alternative with nonnegative/unknown evidence exists; select the best
smoothed `(good+1)/(good+bad+2)` transition, then strength/energy/rank. Unknown
pairs are neutral (0.5). Prefer a measured one-band-or-less jump when an
alternative exists; inferred/missing energy never supplies continuity or an
exception. Learned large-jump evidence may permit an otherwise abrupt move.

Tests: deterministic histories/ties; permutations/duplicate IDs; two runs and
boundary continuation; avoided habitual skip; neutral threshold; decay,
deduplication, delayed outcomes, unknown lanes/session separation; measured
versus inferred energy and measured learned jump exception.

## Owner-scoped service (worker 2, after dependency merge)

Own new `habit_ordering.service.ts` and its real Testcontainers integration
spec, plus analytics instrumentation's existing lifecycle metadata assignment
and focused tests. Read the current owner's bounded `readTasteHistory` and
Taste Memory policy. Current consent/version and playback training must permit
learning. Use only trusted mirrored telemetry and valid playback session keys;
apply reset and current hidden genre/artist/lane controls. Map canonical catalog
metadata to current server lanes deterministically, using genre/mood fit then
strength/ID, keeping unmatched/hidden starts as chain breaks.

Map rows and existing history inputs into the pure observation contract.
Persist no new raw history or aggregate schema. Return neutral ordering on
missing/disabled history or read failure. For the current boundary, use actual
started playback tagged with the owner session, never queued License rows or
`recentTrackIds`. Preserve existing `agentSessionId` on mirrored lifecycle
metadata so starts can be associated with the DJ session, as completions already
are. Do not add fields to public events or warehouse payloads.

Expose `orderMyMix(userId, sessionId, selected, plan)` returning the exact
selected objects in the new order. Descriptor energy comes only from per-field
measured provenance in selected audio features. Boundary energy comes from
measured history. No model input, tool authority or Pro style is introduced.

## Root integration, review and publication

Root review found that the browser API accepts `agentSessionId`, but playback
payload builders do not currently send it. Root will add owner-session
provenance from the existing active DJ set, establish that set before initial
playback starts, and verify lifecycle/completion payloads and initial autoplay.
This adds no new browser history or storage. Initial autoplay currently reads
unordered License rows, which cannot represent batch order. Root will retain
the latest ordered pick IDs in the existing bounded private My Mix cache and
expose optional owner-only `mixTrackIds` in session history. Initial autoplay
uses this batch when available; history/cache loss keeps the existing fallback.
No new table or raw playback history is added.

Root owns service registration and the orchestrator's optional service seam,
ordering before constructing transitions with each preceding ordered track.
Own orchestrator regression tests, feature catalog/page, learning architecture,
RFC status, parent plan and the AI DJ User Guide. Current UI screenshot remains
applicable because ordering adds no visible control; refresh it if presentation
changes. Keep #2067 and gated #1971 tracked.

Verify pure and orchestrator tests, real PostgreSQL service/telemetry boundaries,
backend TypeScript, affected web help tests/lint, links and diff checks. Apply
finish-issue's application/AI security review. Broad backend CI covers other
surfaces. Publication and merge authorization from the conversation persists;
root alone publishes. Root Sol/medium and both reused Luna/max routes passed
fail-closed checks before delegation.

## Delivered and verified

Dependency #2065 merged as PR #2072 at `a68e7682`; this branch includes that
base. The root reviewed all worker files and corrected eligibility precedence,
legacy delayed-outcome ambiguity, historical genre anchors and neutral
fallbacks before publication. Ordered initial autoplay and actual session
provenance are wired through the existing owner-scoped surfaces.

Passed local checks:

- Pure ordering, permutation acceptance, orchestrator and runtime regressions:
  five suites, 44 tests. Pure episode/order coverage includes 18 tests, and the
  independent permutation test exercises 81 mixed batches with duplicate IDs.
- Analytics instrumentation: one suite, 21 tests.
- Real PostgreSQL/Testcontainers ordering service: seven tests; owner history,
  private cache and runtime/controller boundaries: four tests.
- Backend TypeScript lint; full web unit suite (213 files, 2,556 tests); web
  lint and changed-file lint; web production build, TypeScript and 70 routes.
- User Guide integrity, local documentation links and `git diff --check`.

Root application and AI boundary reviews covered current consent/version,
owner/session isolation, reset/hidden controls, trusted telemetry provenance,
exact permutations, measured energy, bounded reads and cache state, private
history response and safe fallback. No unresolved finding remains in the
reviewed diff. No new model input, tool capability or purchase authority exists.

Change impact includes ordering behavior, optional owner-history `mixTrackIds`,
existing playback session provenance, private derived lifecycle state and
synchronized feature/RFC/architecture/User Guide documentation. No schema,
dependency, environment, contract, fee, payout or deployment changes are needed.
Existing My Mix screenshots remain accurate because presentation is unchanged;
Home sections and first-paint behavior are unchanged. Broad integration and E2E
sweeps remain CI scope. #2067 measurement and gated #1971 sequencing remain
tracked; the parent #2061 stays open. Advanced ordering styles remain OFF.
