# Vision Sprint 15 — Triage And Reduce Dependency Risk

> **Status:** Active from 2026-08-30. This milestone admits only #1626 and is
> exit-criteria driven.

- **Milestone:** [17 — Vision Sprint 15](https://github.com/akoita/resonate/milestone/17)
- **Revenue line / phase:** vision-neutral infrastructure and security quality.
  It changes no fees, payouts, prices, licensing rules, collectibles, or
  production authority.
- **Window:** no due date. Close after the reviewed default branch has no
  unresolved Critical/High npm dependency path and every remaining path has a
  durable disposition.
- **Capacity:** one baseline issue, split into removal, compatible remediation,
  test-tool alignment, and evidence updates.
- **Carry-over:** none. Blocked release and migration issues remain outside.

## Milestone Goal

Replace the initial 270-alert snapshot with a current, reachability-aware npm
dependency baseline and eliminate every safely remediable Critical/High path.

## Dependency Order

| Order | Issue | Prerequisite(s) | State | Evidence / action |
| ---: | --- | --- | --- | --- |
| 1 | [#1626](https://github.com/akoita/resonate/issues/1626) | #1539 | `closed/satisfied` | Native alerts and security updates are enabled; rebaseline all first-party npm locks, remove unused paths, apply compatible fixes, and retain reviewed exceptions. |

There are no open prerequisites, inferred dependencies, or cycles in the
admitted work.

## Admitted Work

| Order | Axis | Issue | Beneficiary | Why now | Observable exit |
| ---: | --- | --- | --- | --- | --- |
| 1 | Known issue and maintainer usability | #1626 Dependabot baseline | Users, operators, and maintainers | Production readiness cannot rely on an untriaged alert count, and recent dependency merges make a fresh baseline materially smaller. | No Critical/High npm path remains; Moderate paths have evidence, owner, controls, and a review date; the T4 profile and #1595 are reconciled. |

## Deferred Candidates

| Issue | Dependency state | Reason deferred | Clearing action |
| --- | --- | --- | --- |
| #1655 | `open-outside` | Kernel v4 is a contract/tooling migration, not npm advisory triage. | Plan a dedicated contract migration after this baseline. |
| #1551 | `open-outside` | Live WIF, release, GPU-build, and deployment evidence crosses repositories and environments. | Complete during an authorized release/evidence window. |
| #1663 and #1670 | `open-outside` | Require private IaC execution and available Actions credits. | Resume after normal credit renewal. |
| #1667 and #1583 | `open-outside` | Require explicit owner release/go-live authorization. | Schedule separately with the required identities and decision package. |

## Exit Criteria

- the current root, backend, web, and desktop npm locks are inventoried;
- direct/transitive and runtime/build/test reachability is recorded by family;
- every safely remediable Critical/High path is removed or upgraded in small
  reviewed batches;
- remaining paths have an owner, compensating boundary, and review date;
- lock-source, lifecycle, package tests, builds, and focused security checks
  pass;
- the T4 profile, #1595, and #1626 link the retained evidence;
- default-branch Dependabot processing confirms the post-merge state.

## Not In This Milestone

Production deployment, migration, release publication, contract modernization,
dependency auto-merge, forced major upgrades, and unrelated product research
are excluded.

## Mix Check

Known issues, production trust, and maintainer usability are covered. Business
value comes from protecting every revenue surface without changing product
economics. New product needs are intentionally absent because this is a
prerequisite-clearing security milestone.
