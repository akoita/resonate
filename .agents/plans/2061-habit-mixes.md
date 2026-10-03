# Habit mixes (#2061)

Status: #2062–#2065 merged in PRs #2068–#2070 and #2072. #2066 is implemented;
#2067 remains planned and tracked by the open parent epic. Revenue: vision-neutral
infrastructure (ADR-BM-6), enabling Line 4 Listener Pro, phase 4.

## First slice: habit telemetry (#2062)

1. Backend learning and instrumentation: centralize signal weights; mirror
   unsaves and loop intent; replace repeat completions with replay signals when
   a prior consented completion exists within seven days. Use durable, user-scoped
   signal identifiers and serialized writes for retry and session-loop deduplication.
   Enforce current analytics consent and the playback-training setting at persistence.
   Store pseudonymized browser session identifiers in metadata, never in the
   Session foreign key. Keep new habit actions off the legacy manual signal route.
2. Playback API: accept and validate bounded localHourBucket / weekdayKind enums,
   playlistId, repeatMode, and completion playbackInstanceId. Preserve optional-field
   compatibility. Reject invalid context before ingestion.
3. Web telemetry: calculate coarse context in the browser; include it on lifecycle
   and completion events, carry playback instance and playlist provenance. Playlist
   starts use the existing accept mirror once, with playlist context; do not mirror
   playlist.played again and count the same start twice.
4. Update the event taxonomy, feature catalog, analytics ledger and learning docs.
   Clarify the existing playback-training gate in the User Guide. No new control,
   layout or fee change; retain the existing settings screenshot.
5. Validate focused controller, instrumentation, learning integration and web helper
   tests; package type/lint gates and required security diff / AI review.

## Risks and checks

- Consent and training gates must refuse all new habit signals. Test persisted
  consent states and disabled training, not only mocked forwarding.
- Concurrent retries and re-enabling loops must not strengthen taste twice.
  Test real Postgres deduplication, cross-session and cross-user isolation.
- Replays must use successful history within the lookback and after taste reset;
  first completions and stale history remain complete signals.
- No exact local clock, time zone, raw text, or extra playback history is stored.
- Browser playlist provenance must survive immediate queue starts and navigation.

## Remaining epic

- #2063: decayed, multidimensional taste profile — merged in #2069;
  see [its plan](2063-habit-profile-v2.md).
- #2064: deterministic listening lanes — merged in #2070;
  see [its plan](2064-listening-lanes.md).
- #2065: My Mix and editable lane quotas — merged in #2072;
  see [its plan](2065-my-mix.md).
- #2066: learned ordering — implemented; see [its plan](2066-habit-ordering.md).
- #2067: measurement and promotion evidence — planned.

## First-slice validation and change impact

Worktree: `/home/koita/dev/web3/resonate-2061`, branch
`feat/2061-habit-mixes`, based on `5a336a37`. Unrelated Scene Scout work remains
in the original checkout. Publication is authorized by the request to finish this slice; the draft PR targets main and closes only #2062. The parent epic remains open.

Maestro's enforced routing checks passed for the root (`gpt-6.1-sol`, medium)
and both bounded workers (`gpt-6-luna`, max) before their substantive work.
Root review covered authentication, enum validation, parameterized SQL,
user-scoped deduplication, consent, reset/hidden controls, concurrency, and the
manual signal endpoint. New habit actions cannot bypass analytics gating through
that endpoint. The AI review found no new model input, tool authority, or
untrusted-text execution path; this slice learns from bounded telemetry. No
unresolved security finding remains in the reviewed change.

Passed checks:

- Backend learning and instrumentation unit tests: 2 suites, 37 tests.
- Real Postgres/Testcontainers learning integration: 1 suite, 12 tests,
  including concurrent distinct writes and retries, consent/training gates,
  replay history/reset exclusions, hidden controls, loop scope, and unsaves.
- Analytics and consent HTTP tests: 2 suites, 106 tests. Agent configuration
  HTTP tests: 11 tests, including rejection of manual loop/unsave submissions.
- Warehouse and parity tests: 2 suites, 19 tests. Python transform: 16 tests.
- Discovery journal replay regression: 2 tests. Taste memory policy: 14 tests.
- Full frontend unit suite: 210 files, 2,525 tests. Focused playback/API tests:
  4 files, 123 tests. Updated User Guide integrity: 26 tests.
- ESLint on the changed frontend files and User Guide; web production build,
  including TypeScript and all 70 static routes.
- Backend `npm run lint` (TypeScript compile gate).
- Documentation link checks and `git diff --check`.

The analytics HTTP additions are optional for existing clients; invalid supplied
context is rejected. Backend and Python warehouse mappings stay in parity.
Feature pages, event taxonomy, learning architecture, and User Guide describe
the current behavior. Existing settings screenshots remain applicable because
controls and layout did not change. No schema migration, environment variable,
contract, fee, payout, or deployment change is required. Broader backend suites
are deferred to CI under the focused validation policy. Remaining mix/profile
features are tracked by #2063–#2067; the parent epic remains partial.
