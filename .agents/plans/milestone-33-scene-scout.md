# Milestone 33 implementation plan

Scope: issues #1968, #1969, #1970 and #1450. Publication of draft PRs is
authorized; merging and deployment require separate authorization. Root routing
is independently verified as GPT-6.1 Sol/high, explicitly authorized by the user
on 2026-10-03. Workers must prove Luna/max before receiving real tasks.

## Delivery order and boundaries

1. **#1968:** add a Scene Scout module, pure qualified-demand aggregation,
   thresholded Postgres city/release snapshots and focused integration tests.
   Integrate aggregate cards through an injected source in AnalyticsService.
   Use 7/28-day windows, consent-qualified ledger records, coarse declared
   geography, the shared 90%-completion then replay/save resonance definition,
   unique listeners and the cockpit signal floor. Empty data returns an explicit
   thin-data status. Extend the typed web dashboard and prefill the existing
   Shows draft form through validated query parameters; no automatic campaign
   creation. Add an entitlement seam, currently free.
2. **#1969:** add consent-governed demand records for bounded categorical crate
   filters and session intents. Attribute specific deficits to tracks/artists
   only when their metadata and unmet filters justify it. Deduplicate requester
   contributions, expire raw records, and expose only thresholded aggregates
   with catalog/stem-listing actions. Never retain prompts or expose identities.
3. **#1970:** prioritize fresh verified-human releases within the existing
   exploration budget, preserving taste fit, listener hides, AI exclusions and
   diversity. Bound exposure per listener/release using durable interaction
   history, including actual model-driven DJ picks and every track of a fresh
   release. Unreturned fallback candidates must never consume placements;
   attach the existing discovery explanation. Produce a day-seven
   aggregate reception card through the Scene Scout source with the same
   privacy and entitlement checks.
4. **#1450 (independent worktree):** add Dataform popularity/engagement marts
   over clean events, 24h/7d/30d windows, decay, genre and assertions. Export
   bounded complete snapshots to the existing Postgres serving tables; use a
   configurable backend scheduler/source mode and fail closed on incomplete
   warehouse results. Version cache namespaces on refresh so all genres and
   limits invalidate. Document cost, scheduling and deployment handoff.

## Validation and review

- Real Testcontainers Postgres/Redis tests for snapshot privacy, ownership,
  replacement and cache refresh; no Prisma mocks.
- Pure tests for resonance, demand attribution and discovery-policy caps;
  controller contracts where routes change.
- Focused web component/prefill/help tests, changed-file lint, backend type
  checking, and web production build for changed route/API boundaries.
- Refresh the artist analytics help screenshot with deterministic fixtures.
- Update feature pages/catalog, analytics docs, sprint status and configuration
  docs in each PR. Review the change-impact checklist and diff-scoped security
  requirements before publication.
- Warehouse cloud assertions and staging verification need external execution;
  report their actual status and link private deployment tracking without
  claiming they ran locally. Parent epic remains open for other milestones.

## Tracking

| Issue | State |
| --- | --- |
| #1968 | draft [PR #2044](https://github.com/akoita/resonate/pull/2044); remaining signal families tracked in the open issue |
| #1969 | application implemented and locally verified in this branch; depends on PR #2044; external acceptance tracked in resonate-iac#264 |
| #1970 | in progress in isolated worktree |
| #1450 | draft [PR #2045](https://github.com/akoita/resonate/pull/2045); external warehouse acceptance tracked in resonate-iac#263 |
