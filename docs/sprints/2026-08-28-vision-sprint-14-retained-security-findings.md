# Vision Sprint 14 — Close Retained Application Security Findings

> **Status:** Active from 2026-08-28. This milestone is deliberately small and
> excludes the `resonate-iac` work paused for Actions credit renewal.

- **Milestone:** [16 — Vision Sprint 14](https://github.com/akoita/resonate/milestone/16)
- **Revenue line / phase:** vision-neutral security and reliability work. It
  protects every Business Model v2 revenue line without changing fees, splits,
  payouts, pricing, licensing, collectibles, or production authority.
- **Window:** no due date. The milestone is exit-criteria driven and closes
  when the retained CodeQL findings are fixed on `main` with reviewed evidence.
- **Capacity:** one nearly complete evidence closure plus three bounded backend
  remediations. This is a conservative set relative to the four finite issues
  completed in Vision Sprint 13.
- **Carry-over from Vision Sprint 13:** none. Existing unmilestoned issue #1676
  is admitted first because its source fix is merged and its three alerts are
  already fixed.

## Milestone Goal

Eliminate all seven validated findings retained from the initial CodeQL
baseline and prove the fixes on `main`.

## Dependency Order

| Order | Issue | Prerequisite(s) | State | Evidence / action |
| ---: | --- | --- | --- | --- |
| 1 | [#1676](https://github.com/akoita/resonate/issues/1676) | #1625 and #1539 | `closed/satisfied` | PR #1683 is merged and CodeQL alerts 9–11 are fixed on `main`; update the private evidence and close the issue. |
| 2 | [#1675](https://github.com/akoita/resonate/issues/1675) | #1625 and #1539 | `closed/satisfied` | Implement the retained High finding and prove alerts 1 and 6 fixed. |
| 3 | [#1677](https://github.com/akoita/resonate/issues/1677) | #1625 and #1539 | `closed/satisfied` | Implement the retained Medium finding and prove alert 13 fixed. |
| 4 | [#1678](https://github.com/akoita/resonate/issues/1678) | #1625 and #1539 | `closed/satisfied` | Implement the retained Medium finding and prove alert 16 fixed. |

There are no open prerequisites, inferred dependencies, or cycles among the
admitted issues.

## Admitted Work

| Order | Axis | Issue | Beneficiary | Why now | Observable exit |
| ---: | --- | --- | --- | --- | --- |
| 1 | Known issue | #1676 storage-fetch restrictions | Users and security operators | The source fix is already merged; leaving evidence stale would obscure the actual risk state. | Alerts 9–11 remain fixed, private evidence is updated, and the issue closes. |
| 2 | Known issue | #1675 bounded signal sanitization | Users and maintainers | This is the remaining retained High finding and bounds attacker-controlled processing cost. | Alerts 1 and 6 are fixed by source changes with maximum-length and adversarial-input tests. |
| 3 | Usability and security | #1677 structured encryption errors | API clients and operators | Deterministic safe errors improve the client contract while removing exception reflection. | Alert 13 is fixed; responses are structured and non-HTML while logs retain safe context. |
| 4 | Business value and security | #1678 realtime-session ownership | Creators using realtime generation | Cross-user session control would undermine trust in a revenue-supporting creation surface. | Alert 16 is fixed; every session operation enforces server-derived ownership with two-client tests. |

### #1677 encryption failure contract

The decrypt endpoint returns HTTP 500 with `{ "error": "decryption_failed", "message":
"Decryption failed." }`. The download endpoint returns HTTP 500 with `{ "error":
"download_failed", "message": "Download failed." }`. Diagnostic exception details
stay server-side; successful audio responses and headers are unchanged.

## Blocked Or Deferred Candidates

| Issue | Dependency state | Reason deferred | Clearing action |
| --- | --- | --- | --- |
| #1663 and #1670 | `open-outside` | Require `resonate-iac` Actions execution; retrying before renewal would create zero-step runs. | Wait for normal monthly credit renewal, then resume exact retained evidence. |
| #1667 | `open-outside` | Requires owner-approved release window and separately controlled identities. | Schedule and authorize the first protected release independently. |
| #1626 | `open-outside` | The 270-alert Dependabot baseline is broader than this focused milestone. | Plan a separate reachability and remediation milestone. |
| #1551 | `open-outside` | Broad supply-chain completion would exceed the selected capacity. | Re-plan after the retained application findings close. |
| #1660 | `open-outside` | Glamsterdam evaluation is independent contract research, not a prerequisite for these fixes. | Schedule against the relevant network activation window. |
| #1684 | `open-outside` | WebMCP is Phase-4 research and not an active revenue prerequisite. | Revisit after higher-priority production trust work. |

## Exit Criteria

- CodeQL alerts 1, 6, 9–11, 13, and 16 are fixed on `main` by source changes;
- focused unit, controller, gateway, and integration tests for the affected
  boundaries pass;
- private remediation evidence is updated without publishing sensitive attack
  details;
- no unresolved validated High or Medium finding remains from #1625;
- #1675, #1676, #1677, and #1678 are closed with visible acceptance evidence.

## Not In This Milestone

Production migration, deployment, release publication, DNS changes,
production-go authorization, broad dependency remediation, supply-chain
expansion, contract-fork research, and unrelated product work are excluded.

## Mix Check

Known issues, user/API usability, and production trust are covered. The
new-needs axis is intentionally empty: the roadmap and validated security
baseline make closing known findings more urgent than admitting unrelated
research merely to balance the mix.
