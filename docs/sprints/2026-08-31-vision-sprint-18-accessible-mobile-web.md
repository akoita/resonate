# Vision Sprint 18 — Accessible, Mobile-Ready Web Experience

> **Status:** Active from 2026-08-31. The owner started #1440 while Vision
> Sprint 17 remains open and #1557 waits for its dependency release-age gate.

- **Milestone:** [20 — Vision Sprint 18](https://github.com/akoita/resonate/milestone/20)
- **Revenue line / phase:** vision-neutral web quality and discoverability.
  The sprint changes no ADR-BM-6 value flow, fee, payout, price, license,
  collectible, or production authority.
- **Window:** no due date. Exit is evidence-driven.
- **Capacity:** four issues. #428 is a small remaining documentation slice;
  #1440, #837, and #1101 are the substantive work. This is the upper end of
  recent sprint issue counts, so no stretch scope is included.
- **Carry-over:** none. #428 is existing in-progress work that has not belonged
  to an earlier milestone.

## Milestone Goal

Make Resonate's key public and signed-in web journeys usable on phones,
accessible to WCAG 2.2 AA expectations, discoverable through correct metadata,
and accurately documented.

## Dependency Order

| Order | Issue | Prerequisite or sequencing decision | State | Observable exit |
| ---: | --- | --- | --- | --- |
| 1 | [#1440](https://github.com/akoita/resonate/issues/1440) Mobile responsiveness | Prior focused fixes #1427, #1428, and #1439 are merged. | `closed/satisfied` | Every named route is audited at 400 px or narrower with DOM measurements; overflow, clipping, overlapping targets, and unusable density are fixed or durably tracked. |
| 2 | [#837](https://github.com/akoita/resonate/issues/837) Accessibility baseline | #1440 implementation foundation incorporated on the feature branch; #1557 remains a pre-merge foundation gate. | `in-progress` from 2026-08-31 | WCAG 2.2 AA is documented, critical routes have automated and manual evidence, shared primitives meet the stated bar, gaps are triaged, and the speech-input spike ends in a ship/defer/reject recommendation. |
| 3 | [#1101](https://github.com/akoita/resonate/issues/1101) SEO metadata | No declared prerequisite. Begin after Sprint 17 establishes the final Next.js 16.3 foundation. | Unblocked after sprint-start gate | Key public routes have tested canonical, title, description, Open Graph, and Twitter metadata; private routes have deliberate `noindex` behavior without private-data leakage. |
| 4 | [#428](https://github.com/akoita/resonate/issues/428) User Guide completion | PRs #1231, #1232, and #1233 are merged. Local seeded E2E infrastructure exists for the remaining owner views. Execute last so screenshots reflect the completed UI. | `closed/satisfied` foundation; remaining slice unblocked | Seeded Artist Analytics, Managed Catalog, and Community owner-view screenshots are captured, referenced accurately, and protected by the guide integrity test. |

There are no declared open prerequisites or cycles among the four admitted
issues. #1440 may proceed independently while #1557 waits. Before a Sprint 18
frontend branch merges, it must incorporate the completed #1557 foundation and
rerun its focused validation when #1557 changed a relevant build or runtime
boundary.

## Rescope Log

- **2026-08-31 — early start approved:** the owner explicitly started Sprint
  18 before Sprint 17 closed so repository-local web quality work could proceed
  while #1557 remained time-gated. Scope, capacity, issue order, exit criteria,
  and exclusions are unchanged. #1440 starts first; #1101 still waits for the
  final Next.js 16.3 foundation.
- **2026-08-31 — #837 started:** after #1440 implementation completed, the
  owner approved the accessibility baseline plan. Its branch incorporates the
  #1440 foundation; #1557 remains required before either frontend branch can
  merge.

## Admitted Work

| Order | Axis | Issue | Beneficiary | Why now | Observable exit |
| ---: | --- | --- | --- | --- | --- |
| 1 | Usability | #1440 | Listeners, artists, and operators using phones | Reactive mobile fixes have repeatedly exposed unaudited surfaces. | The named routes have measured mobile evidence and no unresolved critical usability defect. |
| 2 | New needs | #837 | Keyboard, screen-reader, low-vision, reduced-motion, and alternative-input users | Shared accessibility rules and regression coverage are still absent. | The baseline, reusable component fixes, critical-route coverage, manual checklist, remediation backlog, and speech recommendation are durable. |
| 3 | Business value | #1101 | Artists and campaign owners whose public work must be discoverable and shareable | Public pages currently use inconsistent generic metadata while private surfaces lack a uniform indexing policy. | Public metadata is useful and shareable; private surfaces are explicitly protected from indexing. |
| 4 | Known issue | #428 | Every persona relying on in-app self-service help | The guide is implemented, but three seeded owner views remain unillustrated. | The final screenshots land and all guide integrity checks pass. |

## Blocked Or Deferred Candidates

| Issue | Dependency state | Reason deferred | Clearing action |
| --- | --- | --- | --- |
| [#283](https://github.com/akoita/resonate/issues/283) Quick Remix | Scope and contract dependencies require fresh analysis. | It combines frontend capture, metadata, eligibility, and on-chain minting and does not fit a web-quality sprint. | Plan the listen-to-create product slice with its contract and licensing prerequisites. |
| [#355](https://github.com/akoita/resonate/issues/355) Session keys and passkey deduplication | Security- and authority-sensitive design remains unresolved. | Session-key permissions, persistence, expiry, and SDK behavior need a dedicated security-reviewed slice. | Re-evaluate against the corrected local AA boundary and produce a scoped implementation plan. |
| [#1492](https://github.com/akoita/resonate/issues/1492) Credited-artist identity Phase B | Strategic data migration and aggregation work remains. | Stable claimable identities, backfill, claim flow, and mart re-keying exceed this sprint's capacity. | Resolve the #1450 aggregation relationship and plan the migration independently. |
| #1663, #1667, #1670, and #1551 | External operational or `resonate-iac` gates. | GitHub Actions capacity and release/migration authority are unavailable before 2026-09-01. | Re-plan the release-path sprint after the external gates are verified. |

## Exit Criteria

- All four admitted issues close with linked implementation and validation
  evidence.
- Named signed-in routes have no measured horizontal overflow, clipped controls,
  overlapping targets, or unusable mobile density.
- Critical routes and shared primitives meet the documented accessibility bar;
  remaining non-critical gaps have severity, ownership, and affected surfaces.
- Public and private route metadata behavior is centralized, deliberate, and
  covered by focused tests or static checks.
- The three remaining seeded owner-view screenshots are present and the User
  Guide content-integrity test passes.
- Documentation and the in-app guide remain synchronized with visible behavior.

## Explicit Non-Goals

- `resonate-iac` implementation or workflow execution.
- Production deployment, migration, release publication, or go-live.
- Payment, fee, payout, licensing, collectible, or contract behavior changes.
- Session-key authority, credited-artist data migration, Quick Remix, or WebMCP.
- Unrelated frontend redesign or new product scope discovered during audits.

## Mix Check

The sprint deliberately covers business value through public discoverability,
user experience through systematic mobile work, a known documentation gap, and
a new accessibility baseline with a bounded speech-input decision. All scope is
inside `resonate`; no admitted outcome depends on `resonate-iac`.
