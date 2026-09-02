# Vision Sprint 18 — Accessible, Mobile-Ready Web Experience

> **Status:** Closed 2026-09-02. All 10 milestone outcomes (including the
> platform compatibility scope merged from Sprint 17 and the deferred
> staging operations) are complete on `main`, and GitHub Milestone 20 is closed.

- **Milestone:** [20 — Vision Sprint 17–18: Platform, web, and staging confidence](https://github.com/akoita/resonate/milestone/20)
- **Revenue line / phase:** vision-neutral web quality, platform compatibility,
  and staging confidence. The sprint changes no ADR-BM-6 value flow, fee,
  payout, price, license, collectible, or production authority.
- **Window:** no due date. Exit is evidence-driven.
- **Capacity:** 10 issues across web quality (#1440, #837, #1101, #428),
  platform compatibility (#1660, #1694, #1557, #1525), and staging confidence
  (#1666, #1670).
- **Carry-over:** #1666 and #1670 carried from Vision Sprint 13 following
  Actions capacity renewal; Milestone 19 merged in full on 2026-09-01.

## Milestone Goal

Make Resonate's key public and signed-in web journeys usable on phones,
accessible to WCAG 2.2 AA expectations, discoverable through correct metadata,
and accurately documented, while proving platform compatibility and clearing
deferred staging operations.

## Dependency Order

| Order | Issue | Prerequisite or sequencing decision | State | Observable exit |
| ---: | --- | --- | --- | --- |
| 1 | [#1440](https://github.com/akoita/resonate/issues/1440) Mobile responsiveness | Prior focused fixes #1427, #1428, and #1439 are merged. | `closed/satisfied` | Every named route is audited at 400 px or narrower with DOM measurements; overflow, clipping, overlapping targets, and unusable density are fixed or durably tracked. |
| 2 | [#837](https://github.com/akoita/resonate/issues/837) Accessibility baseline | #1440 implementation foundation incorporated on the feature branch; #1557 remains a pre-merge foundation gate. | `closed/satisfied` | WCAG 2.2 AA is documented, critical routes have automated and manual evidence, shared primitives meet the stated bar, gaps are triaged, and the speech-input spike ends in a ship/defer/reject recommendation. |
| 3 | [#1101](https://github.com/akoita/resonate/issues/1101) SEO metadata | No declared prerequisite. Begin after Sprint 17 establishes the final Next.js 16.3 foundation. | `closed/satisfied` | Key public routes have tested canonical, title, description, Open Graph, and Twitter metadata; private routes have deliberate `noindex` behavior without private-data leakage. |
| 4 | [#428](https://github.com/akoita/resonate/issues/428) User Guide completion | PRs #1231, #1232, and #1233 are merged. Local seeded E2E infrastructure exists for the remaining owner views. Execute last so screenshots reflect the completed UI. | `closed/satisfied` | Seeded Artist Analytics, Managed Catalog, and Community owner-view screenshots are captured, referenced accurately, and protected by the guide integrity test. |

There are no declared open prerequisites or cycles among the admitted issues.

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
- **2026-09-01 — Milestone 19 merged into Milestone 20:** Platform
  compatibility outcomes (#1660, #1694, #1557, #1525) and deferred staging
  operations (#1666, #1670) were consolidated with Sprint 18 scope into
  unified Milestone 20 ("Vision Sprint 17–18: Platform, web, and staging
  confidence").
- **2026-09-02 — Milestone 20 completed and closed:** All 10 assigned issues
  landed on `main` with durable evidence, and GitHub Milestone 20 was closed.

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
| #1663, #1667, and #1551 | External operational or `resonate-iac` gates. | Release/migration authority and production cutover require dedicated maintenance windows. | Re-plan the release-path sprint after the external gates are verified. |

## Exit Criteria

- All four web quality issues (#1440, #837, #1101, #428) close with linked
  implementation and validation evidence;
- Named signed-in routes have no measured horizontal overflow, clipped controls,
  overlapping targets, or unusable mobile density;
- Critical routes and shared primitives meet the documented accessibility bar;
  remaining non-critical gaps have severity, ownership, and affected surfaces;
- Public and private route metadata behavior is centralized, deliberate, and
  covered by focused tests or static checks;
- The three remaining seeded owner-view screenshots are present and the User
  Guide content-integrity test passes;
- Documentation and the in-app guide remain synchronized with visible behavior;
- All merged platform compatibility and staging confidence issues are closed.

## Explicit Non-Goals

- `resonate-iac` production workflow execution.
- Production deployment, migration, release publication, or go-live.
- Payment, fee, payout, licensing, collectible, or contract behavior changes.
- Session-key authority, credited-artist data migration, Quick Remix, or WebMCP.
- Unrelated frontend redesign or new product scope discovered during audits.

## Mix Check

The sprint deliberately covers business value through public discoverability,
user experience through systematic mobile work, a known documentation gap, and
a new accessibility baseline with a bounded speech-input decision, combined with
platform compatibility and staging operations. All scope is inside `resonate` or
supported by documented staging runs.

## Outcome

All 10 milestone issues are closed. Milestone 20 combined Vision Sprint 17's
platform compatibility scope, Vision Sprint 18's web quality foundation, and
the deferred staging confidence operations into a single evidence-driven
milestone.

| Issue | Observable outcome | Shipped PR |
| --- | --- | --- |
| [#1440](https://github.com/akoita/resonate/issues/1440) | Systematic mobile responsiveness audit across all named routes at 400 px or narrower; overflow, clipping, overlapping targets, and density defects resolved. | [#1698](https://github.com/akoita/resonate/pull/1698) |
| [#837](https://github.com/akoita/resonate/issues/837) | WCAG 2.2 AA engineering baseline established with Playwright/axe regression suite, shared UI primitive fixes, assistive tech checklist, triaged backlog, and a documented decision deferring production speech input. | [#1699](https://github.com/akoita/resonate/pull/1699) |
| [#1101](https://github.com/akoita/resonate/issues/1101) | Centralized SEO metadata management with Open Graph and Twitter cards for public surfaces, and deliberate `noindex` policy protecting private routes. | [#1700](https://github.com/akoita/resonate/pull/1700) |
| [#428](https://github.com/akoita/resonate/issues/428) | Seeded owner-view screenshots captured for Artist Analytics, Managed Catalog, and Community; User Guide content-integrity test passing. | [#1701](https://github.com/akoita/resonate/pull/1701) |
| [#1660](https://github.com/akoita/resonate/issues/1660) | Static review, gas impact matrix, target-schedule classification, and ERC-4337 compatibility baseline documented for Glamsterdam EIP-8037/8038. | [#1695](https://github.com/akoita/resonate/pull/1695) |
| [#1694](https://github.com/akoita/resonate/issues/1694) | Aligned local AA Kernel deployment and ZeroDev SDK boundary. | [#1696](https://github.com/akoita/resonate/pull/1696) |
| [#1557](https://github.com/akoita/resonate/issues/1557) | Upgraded Next.js to 16.3.4 with verified repository dependency provenance, passing lint, unit, build, and E2E gates. | [#1719](https://github.com/akoita/resonate/pull/1719) |
| [#1525](https://github.com/akoita/resonate/issues/1525) | Restored and validated the automatic Mergify merge queue end-to-end using the `ready-to-merge` label gesture. | [#1696](https://github.com/akoita/resonate/pull/1696) |
| [#1666](https://github.com/akoita/resonate/issues/1666) | Staging artwork-cache 300s TTL trial executed; rejected on zero cache hit reuse gate; safe rollback to TTL 0 executed and verified with HTTP 200 and live header inspection. | [#1715](https://github.com/akoita/resonate/pull/1715), [#1716](https://github.com/akoita/resonate/pull/1716), [#1718](https://github.com/akoita/resonate/pull/1718) |
| [#1670](https://github.com/akoita/resonate/issues/1670) | Staging Actions capacity restored; exact manifest dispatched through `resonate-iac` run 33453738633 with verified digest reconciliation and green staging smoke. | Run 33453738633 |

## Shipped Pull Requests

- Glamsterdam repricing evaluation: [#1695](https://github.com/akoita/resonate/pull/1695)
- Local AA Kernel SDK alignment & Mergify auto-queue: [#1696](https://github.com/akoita/resonate/pull/1696)
- Mobile responsiveness audit & polish: [#1698](https://github.com/akoita/resonate/pull/1698)
- Accessibility baseline & speech input evaluation: [#1699](https://github.com/akoita/resonate/pull/1699)
- Application-wide SEO metadata: [#1700](https://github.com/akoita/resonate/pull/1700)
- Seeded owner guide screenshots & guide integrity: [#1701](https://github.com/akoita/resonate/pull/1701)
- Staging artwork cache staging validation & final TTL decision: [#1715](https://github.com/akoita/resonate/pull/1715), [#1716](https://github.com/akoita/resonate/pull/1716), [#1718](https://github.com/akoita/resonate/pull/1718)
- Next.js 16.3.4 framework upgrade: [#1719](https://github.com/akoita/resonate/pull/1719)

## Verification

Every shipped PR passed its required repository checks, focused test suites,
and lint gates before merging to `main`. Staging deployment and artwork cache
trials were verified with live HTTP headers and Cloud Run revision
reconciliation without targeting production.

## Explicitly Not Shipped

- No production deployment, migration execution, DNS cutover, or production-go
  authorization;
- No SemVer `v*` software release or deployable release artifact;
- No non-zero image optimizer cache TTL on staging or production (application
  default TTL 0 safely maintained);
- No claim that evergreen production readiness ledger #1595 is complete;
- ADR-BM-6 value flows, fees, splits, and pricing remain unchanged.
