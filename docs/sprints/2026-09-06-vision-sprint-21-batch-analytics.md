# Vision Sprint 21: Trustworthy batch analytics

**Status:** in progress.
**Milestone:** [23](https://github.com/akoita/resonate/milestone/23).
**Goal:** Normal staging activity reaches BigQuery once and appears accurately
in the artist dashboard, without an always-on Dataflow job.

## Approved scope and order

1. [#1062](https://github.com/akoita/resonate/issues/1062): complete batch
   materialization, repeated-load correctness, and streaming parity.
2. [#932](https://github.com/akoita/resonate/issues/932): prove the deployed
   artist dashboard with normal cloud/testnet activity and matching counts.

Infrastructure foundations `resonate-iac#153` and `resonate-iac#148` are closed.
Current staging has batch landing, a successful scheduled load, and BigQuery
reporting enabled. This proves availability, not complete data correctness.

Capacity is one focused workstream using existing infrastructure; no due date
or fixed capacity commitment was set. There is no Sprint 20 carry-over and no
other issue reassignment. Historical billing issues #1421/#1422 remain outside
this sprint despite their old closed-milestone assignments.

## Exit and boundaries

Shared fixtures must prove raw/clean/fact/view/quarantine parity. Sequential
retries and overlapping windows must preserve unique event counts and refresh
daily totals. Staging acceptance must show `source=bigquery`, useful freshness,
and dashboard totals matching warehouse queries. Retain deployment and live
verification evidence before closing the milestone.

The work benefits artists through trustworthy reports and operators through
clear mode/freshness guidance. It addresses known reliability gaps; no separate
new-feature investigation is included. Discovery marts, credited-artist identity
redesign, production billing, production launch, and always-on Dataflow
activation are excluded. This is vision-neutral analytics quality (`vision:keep`);
ADR-BM-6 revenue flows, fees, prices, and payouts remain unchanged.

Implementation and operational constraints are described in the
[batch runbook](../operations/analytics-batch.md). The opt-in transactional target
and companion IaC changes require deployment before #932 can validate the new
path; the milestone remains open until that evidence exists.

## Implementation verification

The local implementation passes focused backend tests, two Postgres persistence/
locking tests, fifteen Dataflow tests, backend type checking, and staging
Terraform validation. A disposable BigQuery dataset verified sequential retries,
overlapping windows, correct daily totals, and atomic rollback after an injected
failure; the dataset was removed afterward. This synthetic contract test does
not replace #932's deployed artist-dashboard acceptance.
