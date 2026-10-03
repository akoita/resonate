# #2064 Listening lanes

Status: implemented and verified; publication and merge authorized. Parent #2061 remains partial; mixes and ranking follow in #2065–#2067.

Vision-neutral taste infrastructure; enables ADR-BM-6 Line 4 Listener Pro, phase 4. Taste Memory lane visibility and controls remain free.

## Baseline and dependency

Origin/main verified at 5a336a37. Separate branch feat/2064-listening-lanes in /home/koita/dev/web3/resonate-2064 contains a local snapshot of the verified, uncommitted #2063 dependency. Its original checkout remains untouched. #2062 is published as draft PR #2068 and is unmerged. The user authorized publication and merging in dependency order.

## Architecture and ownership

1. Backend worker owns config additions, pure listening_lanes.ts, and listening_lanes.spec.ts. Bound inputs to 500 signals/730 days; reuse v2 decay and controls. Aggregate catalog genre/mood/strict coarse context vectors within sessions; assign sorted vectors to centroids by deterministic normalized similarity (at most 250,000 comparisons). Signed negative-only sessions reduce matching lanes and do not satisfy evidence floors. Require configurable minimum decayed weight and two distinct sessions per lane, maximum six lanes. Two observed lanes are valid per the acceptance fixture; never manufacture a minimum of three. Energy uses measured provenance only. Stable opaque IDs derive from catalog membership.
2. Root owns history session mapping, user-scoped lane resolver and bounded cache keyed by history/profile policy fingerprint plus hourly decay epoch. Cache holds only derived public summaries. Taste Memory exposes cards including hidden state; the mix-facing resolver excludes hidden lanes and returns empty for insufficient evidence so consumers retain single-profile fallback. Existing string-valued controls gain lane hidden-only validation; reset removes lane hides while preserving declared preferences. No schema migration.
3. Web worker owns API types, Taste Memory cards/helpers/tests, mounted browser fixture and screenshot fixture. Cards show catalog labels/coarse times, hide/restore, and evidence-empty guidance; reset clears cards. Generic control editor excludes arbitrary lane entry. Root owns User Guide, screenshot capture, feature/RFC docs and final integration.
4. Root reviews all code/privacy/security and change impact, runs focused unit and real DB lifecycle tests, backend type check, full frontend unit suite (shared API), changed-file lint, web build and mounted lane controls smoke test, captures settings screenshot, and checks docs/diff. Broad DB suites deferred to CI.

## Invariants

No tracks, session identifiers, precise timestamps or free-form labels appear in lane summaries. Hidden catalog values/artist aliases cannot contribute. Cache invalidates for changed history, metadata, policy and reset, including aging. Hidden lanes never reach mix consumers. No model, deployment, environment, fee or payout changes.

## Verification and change impact

- Maestro routing passed fail-closed checks: root rollout 01a10375-9486-7901-b8ea-679e0e1cdbc8 proves Sol/medium; reused native workers 01a10377-6987-7d53-ae61-f02329b5d640 and 01a10378-7dd7-7b30-a0a8-2fce62488944 prove Luna/max. Root reviewed all results and performed final integration.
- Backend `npm run lint` passed. Focused Jest lane/learning/HTTP/declared-policy gate passed 73 tests; parser/controller compatibility also passed. New pure lane coverage passed 12 tests, including shuffled fixed history, varied intensity/age, strong negative cancellation, catalog alias precedence, measured provenance and 500-signal bounds. The policy is normalized once per computation.
- Real Testcontainers Postgres: new lane lifecycle 5 tests, v2 summaries 5 tests and learning 13 tests passed. Final lane DB rerun passed after global alias normalization. An early concurrent run started before the module existed; a subsequent compile failure exposed a multiline cast, which was fixed before the successful gates. No Prisma mocks.
- Full frontend Vitest: 211 files / 2,532 tests passed. Focused panel 7 tests passed again after final catalog-fixture changes. Changed-file ESLint, screenshot-script syntax and help integrity (26 tests) passed. Production build passed TypeScript and 70 generated routes; existing ox/viem dynamic-dependency warning remains.
- Mounted Chromium smoke passed all 3 tests with an isolated mocked-API configuration, exercising reset, lane hide/restore and ordinary-control restoration rebuilding lanes. Temporary config removed; no local backend seeding was used for this smoke.
- Settings screenshot refreshed at 1440×2800 and visually reviewed: both catalog-labelled cards, privacy controls, declared edits and Reset are visible. User Guide and feature/RFC links updated; diff and local documentation links pass.
- Security review used the current uncommitted diff and new files, with #2063 as the dependency baseline. Checked JWT-owned control routes, lane ownership validation, cache user/version separation, alias-hidden precedence, reset serialization, catalog label allowlists and React text rendering. No unresolved findings. Lane derivation adds no model/tool authority or external calls; existing AI learning/consent boundaries remain in place.
- Impact: optional authenticated summary contract and hidden-only lane control type; existing hide/restore/reset domain events and frontend analytics are reused, with categorical payloads only. Reset atomically clears profile and lane hides while preserving declared/catalog controls. No schema, environment, deployment, contracts, prices or payouts change. Greedy clustering and hourly decay-cache refresh are intentional documented limits. Full backend container sweeps are deferred to CI; My Mix, quotas, ordering and measurement remain tracked in #2065–#2067.
