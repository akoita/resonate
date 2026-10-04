# Habit Mix measurement (#2067)

Vision-neutral measurement infrastructure under ADR-BM-6, serving Line 4
Listener Pro phase 4 decisions. Parent #2061 stays open until all six slices
are merged. No fees, payouts, purchase authority or generation are changed.

## Implementation contract

1. Reuse DISCOVERY_RANKER_EXPERIMENT's stable user assignment. Only explicit
   `my_mix_habits`, `my_mix_lanes`, `single_profile` arms affect requested My Mix.
   Unset/invalid/other assignments retain the existing My Mix behavior. Validate
   the owner lane request before applying an arm. Single-profile uses the
   deterministic selector without quotas; lanes-only bypasses habit ordering.
   Server-generated labels reflect actual execution, including empty-lane fallback.
2. Emit per-track `recommendation.generated` impressions for DJ results, with
   owner session, source (`my_mix`, `described` for parsed request, else `preset`),
   ranker/ordering variants, experiment key, and actual exploration status from
   policy reason `discovery_pick`. No prompt text or lane identifiers in events.
3. Preserve coarse dimensions plus private pseudonymous actor/session/track
   linkage in TS/Python warehouse transforms. Aggregate only on the authorized
   quality dashboard. Join playback episodes to preceding owner-session track
   impressions; deduplicate event IDs and playback instances. Unattributed old
   events stay out of new metrics. Saves without explicit DJ session require a
   recent same-actor track start and DJ attribution, with 30-minute expiry.
4. Report source and experiment/variant breakdowns: plays, skips/early skips
   (position < 30 seconds), completions, saves, playlist adds, resonance union,
   session tracks and played minutes, and exploration acceptance union. Outcomes
   count once per episode; ratios use observed starts. Report attribution limits.
   Promotion compares randomized My Mix candidate against single-profile in
   the same experiment and source, requires 100 sessions and 500 plays each,
   skip improvement >= 0 and completion OR resonance improvement > 0. Report
   eligibility only; no feature default, entitlement or automatic activation.
5. Offline replay accepts an explicit day-D cutoff, bounded training-mart
   exports and catalog fixtures. Rebuild production lanes from strictly earlier
   signals; held-out targets are later completions/saves only. Use production
   lane matching/quota policy and shared recall@k/NDCG, compare genre-only v1,
   exclude seen training tracks, report unreachable targets and aggregate only.
   Reproducible CLI uses files without production secrets or database access.

## Ownership and validation

- Backend worker: pure offline replay, CLI and focused unit tests only.
- Web-context worker: pure online aggregation, promotion config and unit tests
  only (despite historical worker name); no service/runtime/event writes.
- Root: runtime experiment behavior, event and warehouse parity integration,
  dashboard integration, real-DB and HTTP contracts, docs, security review,
  verification and publication. Serialize any overlapping work.

Focused backend unit and HTTP tests, real Testcontainer impression/aggregation
integration, backend lint/type checks, warehouse parity and Dataflow tests,
CLI fixture execution, docs links and git diff --check. Full sweeps are CI.
No listener UI change or User Guide update is required by #2067.

## Replay invocation

From `backend/`, use local pseudonymous fixture files (never commit exports):

```sh
npx ts-node --transpile-only scripts/eval_habit_mix.ts \
  --signals /path/to/signals.ndjson --catalog /path/to/catalog.json \
  --cutoff 2026-07-01 --k 10 --max-users 500 --out /path/to/habit-mix.json
```

The signal input accepts actual training-mart columns (`user_id`, `track_id`,
`event_name`, `signal_type`, `signal_weight`, `completion_ratio`, `session_id`,
`occurred_at`, `payload`) and action-based fixtures. Separate 500-row training
and held-out bounds prevent future events from evicting historical evidence.
Offline targets are strong completions (80%) and saves/playlist additions;
the existing mart's 30-second completion telemetry limits the available strong
completion evidence. The replay reports aggregate cohort/target coverage.

Online full-track completion uses existing matched heartbeat progress at 80%
as well as strong completion ratios. Legacy 30-second qualified-play counts
stay in the older quality sections. No new browser event is introduced.
Generic ingest rejects listener-supplied habit impressions; server events
produce experiment attribution. Quality reports remain operator-authorized.

## Change impact and review

API and event semantics: quality responses add optional aggregate sections; DJ
generation exposure is now per pick. TS/Python dimensions remain identical.
Browser telemetry stays unchanged; existing heartbeats establish full-track
completion and measured duration. Canonical playlist additions use the same
actor pseudonym as browser playback. Generic ingest cannot accept habit
impressions from a listener. No IDs appear in the new report sections.

The three explicit experiment arms retain global selector safety and validate
owner-visible lane preferences before branching. Neutral ordering bypasses
history reads; the single-profile control bypasses model adapters. Application
and AI diff review checked ownership, telemetry trust, authorization, privacy,
configuration, bounded replay, and model/tool boundaries. No new model input,
spending authority, generation path, secret, dependency or deployment variable
is introduced. Promotion remains evidence only, with no automatic activation.

Offline replay preserves optional catalog AI disclosure, excludes fully
AI-generated candidates from reachability, and reports the common lane-eligible
cohort explicitly. Catalog snapshots and pseudonymous mart exports stay local.
Metadata scoring and the mart's strong-completion coverage remain documented
limitations; live experiment outcomes are not asserted by fixture tests.

Maestro root and both reused implementation-worker runtime preflights passed
before implementation: Sol/medium root and Luna/max workers. The root owns
integration, final review, verification and publication.

## Final validation

All selected local gates passed: 10 focused backend unit/HTTP suites (153
tests), 3 real Testcontainer integration suites (13 tests), backend TypeScript
lint, 16 Python Dataflow tests, TS/Python warehouse parity, a local replay with
`DATABASE_URL` unset, changed Markdown links, and `git diff --check`. Broad
repository suites remain CI gates. No frontend or contract behavior changed.
