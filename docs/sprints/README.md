# Sprints — Working Mode

> Adopted 2026-07-04 (@akoita). Flexible priority-set sprints, not rigid
> unmodifiable iterations.

## How Resonate sprints work

A sprint is a **set of priorities that addresses one subject we judge to be
the next most important thing** — an important technical question, an
important user feature, an economic/business-model subject, or a mix. Sprints
are planning instruments, not contracts:

- **Theme first.** Each sprint has one theme and a one-sentence goal. If that
  sentence isn't true at the demo, the sprint missed.
- **Adjustable, explicitly.** Scope can change mid-sprint when reality
  demands it — but every re-scope is recorded in the sprint doc (what moved,
  why), never silent.
- **Priority tiers, not fixed backlogs.** P0 = the sprint fails without it;
  P1 = strongly expected; P2/stretch = only if P0s land early.
- **Exit criteria over dates.** Dates are indicative (usually ~10 working
  days); the sprint closes when exit criteria are met or the theme is
  re-judged.

## Artifacts per sprint

| Artifact | Convention |
| --- | --- |
| Sprint doc | `docs/sprints/<start-date>-<theme>.md` — goal, priorities, capacity, exit criteria; updated in place on re-scope and closed with an outcome banner |
| GitHub milestone | One per sprint; issues assigned |
| Sprint label | `sprint:<name>` on every sprint issue |

## Choosing the next sprint

At each sprint close, pick the next theme by judging what matters most now
across three lenses:

1. **Technical** — a hard question blocking future work (e.g., custody
   hardening, GPU inference shape).
2. **User** — a feature that changes what artists/listeners can do (e.g.,
   Remix Studio, Shows).
3. **Economic** — a Business Model v2 activation step (revenue-line
   sequencing per ADR-BM-6; see
   `docs/strategy/business-model-review-2026-07.md`).

Every sprint plan passes the **Business Model Conformance** check in
`CLAUDE.md` (red lines, revenue line/phase, canonical fees).

## Sprint index

| Sprint | Theme | Outcome |
| --- | --- | --- |
| [2026-06-29](2026-06-29-shows-mvp.md) | Shows MVP — campaign funding & trust escrow | ✅ Closed — over-delivered (12/12) |
| [2026-06-30](2026-06-30-remix-licensed-remixing.md) | Remix — licensed remixing end-to-end | ✅ Closed 2026-07-04 — 9/9, goal met on staging |
| [2026-07-06](2026-07-06-vision-sprint-1.md) | Vision Sprint 1 — remix finish + first revenue rails | ✅ Closed 2026-07-05, 12 days early — all P0s/P1s incl. ADR-BM-1…6 accepted; Phase 0 complete |
| [2026-07-06](2026-07-06-vision-sprint-2-first-real-money.md) | Vision Sprint 2 — first real money (Shows go-live + take-rate) | ✅ Closed 2026-07-06 — goal met: 6% fee loop proven end to end on staging (campaign 3: gross 5.00 / net 4.70 / fee 0.30 USDC, indexer-reconciled); 10%/15% take-rate live; carryovers → Sprint 3 |
| [2026-07-06](2026-07-06-vision-sprint-3-dependable-shows-ops.md) | Vision Sprint 3 — dependable shows ops (lifecycle smoke + operator usability) | ✅ Closed 2026-07-06 — goal met, all 5 items: automated lifecycle smoke green on staging (#1392), copy-paste-free activation (#1390), contract-term validation + correction path (#1356), operator guidance (#1363), honest fixtures (#1355) |
| [2026-07-07](2026-07-07-vision-sprint-4-portable-deployments.md) | Vision Sprint 4 — portable deployments (app data + user accounts survive GCP-project migration) | ✅ Closed 2026-07-07 — goal met, all 5 items: data-plane migration tool (iac#188), identity continuity + provable diagnostic (#1407), verification gate (#1408), durable content default-fix (iac#186, a live content-loss bug), complete runbook (iac#187) |
| [2026-07-07](2026-07-07-vision-sprint-5-generation-to-ownership.md) | Vision Sprint 5 — generation-to-ownership (Line 2: metered fair AI creation that feeds sellable ownership) | ✅ Closed — metered generation, provenance/rights gates, and creation-to-ownership foundation landed; live charging remained gated |
| [2026-07-10](2026-07-10-vision-sprint-6-production-billing.md) | Vision Sprint 6 — production billing | ✅ Closed — pricing/meter and Usage & Billing foundation landed; fiat charging remained gated |
| [2026-07-10](2026-07-10-vision-sprint-7-punchline-drops.md) | Vision Sprint 7 — Punchline Drops MVP | ✅ Closed — 12/12 Drops MVP slices completed |
| [2026-07-11](2026-07-11-vision-sprint-8-trustworthy-money-discovery.md) | Vision Sprint 8 — trustworthy money + discovery foundations | ✅ Closed — money-loop fixes and discovery-ranking foundations completed |
| [2026-07-12](2026-07-12-vision-sprint-9-custody-to-production.md) | Vision Sprint 9 — custody to production + first paid collects | ✅ Closed — custody/readiness and paid-collect foundations landed; Home performance carried forward |
| Vision Sprint 10 | Home performance follow-through | ✅ Closed as a carry-over planning milestone; #1491 moved into Sprint 11 |
| [2026-08-11](2026-08-11-vision-sprint-11-production-readiness.md) | Vision Sprint 11 — production readiness, not production | ✅ Closed — all nine focused slices landed; #1593 external release evidence and evergreen #1595 explicitly carried forward |
| [2026-08-11](2026-08-11-vision-sprint-12-production-controls.md) | Vision Sprint 12 — production controls and trust | ✅ Closed — all seven finite sprint outcomes landed; cache-TTL and first-software-release operations remain explicitly unmilestoned |
| [2026-08-26](2026-08-26-vision-sprint-13-restore-launch-path.md) | Vision Sprint 13 — restore and prove the launch path | ⏹ Stopped — four finite outcomes landed; #1663 and #1670 moved outside the milestone until `resonate-iac` Actions credits renew |
| [2026-08-28](2026-08-28-vision-sprint-14-retained-security-findings.md) | Vision Sprint 14 — close retained application security findings | ✅ Closed 2026-08-30 — all seven validated CodeQL alerts fixed on `main` |
| [2026-08-30](2026-08-30-vision-sprint-15-dependency-risk.md) | Vision Sprint 15 — triage and reduce dependency risk | ✅ Closed 2026-08-30 — reachability-aware baseline and safe dependency triage completed; deferred majors carried forward |
| [2026-08-30](2026-08-30-vision-sprint-16-deferred-dependency-majors.md) | Vision Sprint 16 — deferred dependency majors | ▶ Active — isolate Kernel v4 compatibility while preserving the legacy app/runtime boundary |
