# Habit profile v2 (#2063)

Status: implemented and verified; publication and merge authorized. Depends on #2062 (PR #2068); this
local branch `feat/2063-habit-profile-v2` starts at its committed head.
Vision-neutral infrastructure (ADR-BM-6), enabling Line 4 Listener Pro, phase 4.

## Architecture and ownership

1. Backend worker owns `agent_learning.service.ts`, `config/agent_learning.ts`,
   and learning unit/integration tests. Produce `agent-taste-profile/v2` with
   retained v1 fields and optional typed mood/artist/energyBand/tempoBand maps
   and `contextWeights` keyed by `hour:weekdayKind`, containing genre/mood maps.
   Derive genre/moods and credited artists from release data; energy/tempo only
   from current original full-mix measured features using the existing reader.
   Behavioral half-life 60 days; purchase/pledge/collect 365 days. Bound history
   to newest 500 signals within 730 days, all constants in configuration.
   Apply controls per dimension and context, exclude hidden genre/artist tracks,
   respect reset, and keep fallback genres out after reset. Undated unit inputs
   represent current signals; permit explicit no-decay mode for compatibility
   tests. Refresh profiles on reads so decay and controls cannot become stale.
2. Root owns Taste Memory backend summary integration and its database tests.
   Reuse the v2 computation rather than summing persisted and recent history
   twice. Return ranked safe labels and bounded context summaries, never IDs
   or itemized playback history. Existing intent/novelty/commerce summaries
   remain, bounded to the same history window.
3. Web worker owns API response types, TasteMemorySettingsPanel, its component
   tests, and the settings screenshot fixture. Add optional energy/tempo and
   context summary rows; tolerate old responses, clear all dimensions on reset.
4. Root updates feature catalog, feature pages, architecture, RFC and User Guide,
   captures the changed Settings screenshot, reviews security/AI trust boundaries
   and validates focused tests, backend lint, frontend lint/unit/build gates.

## Risks and validation

- Fixed clocks prove half-life, commitment decay, time-window and newest-N bounds.
- Inferred or unreliable measured features must not produce tempo/energy bands.
- Hidden values and reset cannot survive in any global or contextual dimension;
  boosted/downranked values must use existing control multipliers.
- v1 genre consumers retain fields and equal-history behavior with decay off.
- Real Testcontainers verify metadata joins, persistence, fresh resolver reads,
  and privacy-safe summaries. Frontend tests cover legacy responses and reset.
- #2064–#2067 and parent #2061 remain planned; this slice does not add mixes.

## Verification and impact

Publication: #2062 is committed as `8ed6639f` and published in
[draft PR #2068](https://github.com/akoita/resonate/pull/2068); all CI checks
passed. The user authorized merging the slices in dependency order.

Completed checks:

- Learning pure unit tests: 23 passed, including fixed-clock decay, independent
  control multipliers, alias precedence, reset, bounds and legacy parsing.
- Full frontend suite: 211 files, 2,529 tests; focused settings/API tests:
  3 files, 101 tests. Changed frontend files passed ESLint; screenshot script
  passed `node --check`.
- Mounted Chromium test `tests/taste-memory-habits.spec.ts` passed against the
  local dev server with mocked API/auth fixtures, confirming the reset dialog,
  one reset request, empty learned dimensions and retained declared controls.
  The local run used a temporary config with the shared backend/global setup
  disabled; the durable spec also runs under the normal Playwright harness.
- Updated User Guide integrity: 26 passed; content and browser spec ESLint passed.
- Settings screenshot refreshed at 1440×2400 and visually reviewed; it includes
  all summaries, proposed edits, controls and reset. Web production build passed
  TypeScript and all 70 static routes. Its existing ox/viem dynamic dependency
  warning is unrelated to this change.
- Real Postgres summary integration: 5 passed on the final computation and
  strengthened alternate-credit fixture. Shared Home/DJ discovery integration
  passed (4 tests). Backend TypeScript lint passed. Learning integration passed
  all 13 tests after replacing two near-now exact weight assertions with
  five-decimal comparisons; exact counts and keys remain.

Root security/AI review covered user-scoped history queries, fixed bounds,
measured provenance, sanitized labels, controls, reset, legacy snapshot migration,
JSON/React output and existing authentication. No new model/tool authority is
introduced; existing ranking consumers receive their compatible genre fields.
Review fixes prevent stale legacy snapshots from resurrecting aged-out history
and apply canonical/credited artist controls without duplicate weighting.

Relevant change-impact areas: private summaries and User Guide, additive API
contracts, learning/profile lifecycle, metadata provenance, controls and bounded
queries. No schema migration, new environment variable, fee/payout, contract or
deployment change is required. Broader backend suites are deferred to CI.
#2064–#2067 remain planned and the parent epic remains partial.

Final local gates passed; no unresolved review findings remain. The learning
rerun stopped its Testcontainers cleanly. An unrelated local Pub/Sub emulator
startup timeout did not affect the selected Postgres learning/summary/discovery
tests; no pipeline test was selected. Original Scene Scout edits remain in the
original checkout. Publication is authorized; remaining epic work stays tracked in #2064–#2067.
