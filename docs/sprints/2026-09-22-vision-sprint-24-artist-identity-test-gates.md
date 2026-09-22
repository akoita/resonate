# Vision Sprint 24: Stable artist identity, trustworthy test gates

**Status:** in progress.
**Milestone:** [26](https://github.com/akoita/resonate/milestone/26).
**Goal:** Give every credited artist a stable, claimable identity across the
catalog, Library, profiles, and rankings, while ensuring CI and mutation
testing reliably validate those changes.

## Capacity and sequencing

Capacity is one focused workstream with no due date and no fixed issue-count
commitment. The sprint admits four existing issues. Work is deliberately
ordered so the failing and incomplete validation signals are repaired before
the larger identity migration depends on them.

The recently closed Sprint 23 has no unfinished milestone issue. The only
carry-over is work started after closure on
[#1827](https://github.com/akoita/resonate/issues/1827): diagnosis found that
the two largest Gambit campaigns exceed the job timeout while scoring hundreds
of mutants. [PR #1832](https://github.com/akoita/resonate/pull/1832) split those
campaigns, and [the complete manual run](https://github.com/akoita/resonate/actions/runs/35716270899)
scored all five targets successfully. [#1827](https://github.com/akoita/resonate/issues/1827)
is closed. [#1765](https://github.com/akoita/resonate/issues/1765) is also
closed after [PR #1833](https://github.com/akoita/resonate/pull/1833)
centralized Gambit remappings. [#1783](https://github.com/akoita/resonate/issues/1783)
is closed after [PR #1834](https://github.com/akoita/resonate/pull/1834)
replaced the CI test lists with related-test selection and added web Vitest.
Work has moved to #1492.

## Dependency order

| Order | Issue | Prerequisite state | Evidence and action |
| --- | --- | --- | --- |
| 1 | [#1827](https://github.com/akoita/resonate/issues/1827) — restore the scheduled Gambit run | None declared | Split or otherwise bound the oversized campaigns without reducing the set of mutants scored; make scoring progress observable and verify a complete scheduled/manual run. |
| 2 | [#1765](https://github.com/akoita/resonate/issues/1765) — derive Gambit remappings | None declared; shares the mutation harness with #1827 | Serialize after #1827 so two changes do not compete in the same workflow and script. Make the effective Foundry remappings the single source of truth and retain all five targets' mutant generation. |
| 3 | [#1783](https://github.com/akoita/resonate/issues/1783) — make CI test selection accurate | None declared | Replace literal backend spec lists with the runner's dependency graph, preserve conservative full-suite boundaries, and add scoped web unit tests. Merge-queue and nightly full-graph gates stay unchanged. |
| 4 | [#1492](https://github.com/akoita/resonate/issues/1492) — stable credited-artist identities | Phase A is closed/satisfied by #1495 and the destination work in #1820 | Complete Phase B: stable credited-artist IDs, migration/backfill with explicit ambiguity handling, a claim lifecycle, and identity-based discovery/ranking. |

There is no dependency cycle. The ordering of #1827 and #1765 is an execution
constraint caused by overlapping files, not a product dependency.

## Admitted work

| Priority | Axis | Issue | Beneficiary and observable exit |
| --- | --- | --- | --- |
| P0 | Known issue | #1827 | Maintainers and protocol reviewers get a complete weekly mutation score. Every target finishes inside its job boundary, every generated mutant is assigned exactly once, and timeout progress is visible. |
| P0 | Known issue / developer usability | #1783 | Contributors get fast, accurate PR feedback. Analytics, payments, x402, and other changed modules select the tests that import them; a changed spec runs itself; the web Vitest suite runs in CI; the complete merge-queue/nightly graph remains the final gate. |
| P0 | Business value / user usability | #1492 | Artists and listeners see one stable credited identity rather than a manager name or a name-keyed approximation. Existing data has a reviewed migration path, ambiguous matches do not auto-merge, claims are explicit, and Top Artists plus catalog/Profile/Library navigation use the same identity. |
| P1 | Bug prevention | #1765 | Contract maintainers no longer duplicate remappings across five Gambit configs. Adding an import cannot silently turn a money-contract mutation campaign into zero coverage. |

P1 does not mean optional: all four issues must close for the milestone to
close. It records that the active timeout and inaccurate CI selection are
repaired before the recurrence guard is considered complete.

## Exit criteria

- One complete Gambit workflow finishes successfully for all targets, scoring
  every generated mutant without a timeout or silent zero-mutant result.
- Gambit remappings have one effective source of truth and a regression check.
- Representative recent backend and web changes demonstrate correct related
  test selection with before/after counts; changes to shared/global inputs
  still select the full suite.
- Credited artists have stable IDs, existing releases are migrated or
  explicitly flagged as ambiguous, and a credited artist can claim an
  eligible identity without display-name matching granting authority.
- Top Artists and related catalog, profile, and Library destinations consume
  the stable identity. The artist-identity feature page, feature catalog, and
  User Guide remain synchronized with the shipped behavior.
- All four milestone issues are closed with focused validation evidence.

## Deferred and blocked candidates

| Issue | Dependency state | Reason deferred / clearing action |
| --- | --- | --- |
| [#1762](https://github.com/akoita/resonate/issues/1762) delegated management and transfer | `open-outside` on #1492 | Build explicit profile/catalog authority only after stable credited identities exist; do not derive authority from names during the transition. |
| [#1450](https://github.com/akoita/resonate/issues/1450) popularity and artist-engagement marts | `open-outside` on #1492 | The marts must adopt the stable credited-artist key rather than cement the interim name key. Re-evaluate immediately after #1492. |
| [#1763](https://github.com/akoita/resonate/issues/1763) AI profile enrichment | `missing/inaccessible` decisions | Source/image rights, confidence thresholds, and who may apply suggestions need decisions; profile authority should follow #1762. |
| [#1774](https://github.com/akoita/resonate/issues/1774) escrow classification | `open-outside` qualified-adviser dependency | Repository work cannot supply the qualified legal answer. Keep it outside delivery capacity until advice is retained. |
| [#1776](https://github.com/akoita/resonate/issues/1776) immediate-delivery waiver | `open-outside` product/legal decisions | First decide which surfaces are consumer sales and whether they are exposed in v1; marketplace exposure remains gated. |
| [#1777](https://github.com/akoita/resonate/issues/1777) legal-surface capability gaps | Needs decomposition | Split account lifecycle, user notices/outbound delivery, unclaimed-refund detection, and pledge disclosure into independently closable issues before admission. |
| [#1759](https://github.com/akoita/resonate/issues/1759) creator stake refund | `missing/inaccessible` owner decision | Resolve the dispute-lock fail-safe window, then plan the storage migration, full custody test ladder, upgrade, and deployment as a dedicated contract slice. |
| [#1663](https://github.com/akoita/resonate/issues/1663), [#1667](https://github.com/akoita/resonate/issues/1667), [#1583](https://github.com/akoita/resonate/issues/1583) | `open-outside` operational authority | Target migration evidence, protected SemVer publication, and production go-live require separate owner-controlled external actions. |

## Boundaries and mix

This sprint does not authorize deployment, migration, production go-live,
contract upgrades, marketplace exposure, legal conclusions, or new AI
providers. It also does not absorb delegated artist management, analytics
marts, or profile enrichment into #1492.

The mix is deliberate: #1492 supplies concrete artist/listener value and the
main usability outcome; #1827 and #1783 repair known reliability defects;
#1765 removes a demonstrated recurrence class. No separate exploratory item is
admitted because the unresolved legal and authority questions cannot produce a
delivery outcome inside this capacity. Their clearing actions are recorded
above instead.

This milestone is vision-neutral quality and identity infrastructure
(`vision:keep`). It supports ADR-BM-6 revenue lines 1–3 by keeping credited
artist identity trustworthy, but changes no fee, price, split, licensing rule,
or payout eligibility. ADR-BM-4 remains unchanged.
