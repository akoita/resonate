# Vision Sprint 17 — Platform Compatibility And Delivery Confidence

> **Status:** Active from 2026-08-30. This sprint contains three ordered
> compatibility and delivery outcomes: #1660, #1557, and #1525.

- **Milestone:** [19 — Vision Sprint 17](https://github.com/akoita/resonate/milestone/19)
- **Revenue line / phase:** vision-neutral infrastructure, security, and
  delivery quality. The sprint changes no ADR-BM-6 value flow, fee, payout,
  price, license, collectible, or production authority.
- **Window:** no due date. Exit is evidence-driven.
- **Capacity:** three bounded issues across contract compatibility, frontend
  framework compatibility, and repository delivery automation.

## Milestone Goal

Prove Resonate remains compatible with upcoming Ethereum gas repricing and the
current Next.js 16.3 release while restoring trustworthy automatic merge-queue
behavior.

## Dependency Order

| Order | Issue | Dependency or gate | Observable exit |
| ---: | --- | --- | --- |
| 1 | [#1660](https://github.com/akoita/resonate/issues/1660) Glamsterdam repricing | None. Begin immediately. | Static review, reproducible gas evidence, target-schedule classification, and every regression fixed or durably tracked. |
| 2 | [#1557](https://github.com/akoita/resonate/issues/1557) Next.js 16.3 | Next.js 16.3.3 clears the repository's seven-day release-age gate after 2026-09-01 17:32 CEST. | Lint, unit, build, and E2E validation pass; the bundler choice is documented. |
| 3 | [#1525](https://github.com/akoita/resonate/issues/1525) Mergify auto-queue | Validate on an operator-approved PR from #1660 or #1557. | The approved `ready-to-merge` gesture queues and merges a qualifying PR reproducibly. |

The order prevents an automation-only test PR and avoids bypassing the package
intake policy. A failed prerequisite remains visible as a sprint blocker rather
than silently shrinking the milestone to one issue.

## Priorities

| Tier | Outcome | Evidence |
| --- | --- | --- |
| P0 | Establish Resonate's EIP-8037/8038 compatibility posture. | Checked-in impact matrix, local baseline, target-schedule evidence, ERC-4337 disposition, and chain-specific retest triggers. |
| P0 | Validate the current eligible Next.js 16.3 patch without weakening dependency policy. | Focused frontend validation and explicit build/bundler decision. |
| P1 | Restore confidence in the automatic merge queue. | A real approved milestone PR exercises the documented label-to-queue path. |

## Exit Criteria

- #1660 closes with every required flow classified and every regression fixed
  or linked to an owned follow-up issue;
- #1557 closes with repository-policy-compliant dependency provenance and the
  required frontend validation;
- #1525 closes with evidence from an operator-approved milestone PR;
- all three issues link their durable evidence and the milestone has no open
  scope;
- no production deployment, account migration, or release publication is
  inferred from compatibility test results.

## Explicit Non-Goals

- Production deployment or live-account migration.
- Software release publication.
- Prisma migration or WebMCP implementation.
- `resonate-iac` execution.
- Product-economics changes.

## Mix Check

The sprint deliberately combines an upcoming protocol risk, a known framework
compatibility obligation, and maintainer delivery usability. Its beneficiaries
are users whose contract-backed actions must remain executable, frontend users
who need a supported framework, and maintainers who need a dependable approval
and merge path.
