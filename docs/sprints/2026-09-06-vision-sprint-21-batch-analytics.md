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

## Staging execution evidence (2026-09-10)

The cutover deployed on 2026-09-06 left the Cloud Scheduler warehouse load job
paused from the "switch safely" step 2, so the warehouse stopped advancing at
`2026-09-06 01:56:55Z` while the Pub/Sub landing table kept receiving normal
staging traffic. No Dataflow job or other `insertAll` writer was active.

Three bounded loads closed the gap with execution-level window overrides only:

| Run | Window (UTC) | eventsRead | insertedRows | updatedRows | quarantined |
| --- | --- | --- | --- | --- | --- |
| A | 09-06T00:00 to 09-08T00:00 | 353 | 1058 | 81 | 0 |
| A' | identical rerun | 353 | 0 | 0 | 0 |
| B | 09-07T00:00 to 09-10T19:59 | 474 | 633 | 0 | 0 |

The identical rerun changed no layer count. The overlapping window added
exactly 196 rows and 196 unique keys across raw, clean, and fact layers, and
rebuilt the affected daily views instead of appending to them. Cross-checked
against the independent Pub/Sub landing path over the same period: 549 unique
events on both sides, none landed-but-unwarehoused, none warehoused-but-unlanded.

The schedule is resumed and enabled (`15 */8 * * *` UTC). Two items are carried
forward rather than silently absorbed: pre-cutover duplicate rows from the
`bigquery_insert_all` era still inflate historical daily views, and artist
attribution is missing on the punchline, shows, remix, and recommendation
families ([#1743](https://github.com/akoita/resonate/issues/1743)).

## Staging acceptance (2026-09-10)

The deployed dashboard was verified while signed in as a real user. During that
page load the backend runtime service account executed both artist-dashboard
reads — the parameterized `analytics_facts` and `analytics_views` queries —
against the warehouse and both completed. The local-ledger fallback issues no
BigQuery job, so those reads are positive proof the page was served from
BigQuery rather than a label read off the screen.

Displayed values matched the warehouse for the checked artist: 58 plays over the
30-day window, 12 plays on the top track, zero payout with no settlement facts
present, and real catalog titles with no `Unknown Track` rows. The events came
from normal staging activity through Pub/Sub and the `bigquery_batch` loader,
not from seed rows.

[#932](https://github.com/akoita/resonate/issues/932) is satisfied. Two tracked
items remain outside the exit criteria: pre-cutover duplicate rows still inflate
historical daily views, and artist attribution for the punchline, shows, remix,
and recommendation families is [#1743](https://github.com/akoita/resonate/issues/1743).

## Implementation verification

The local implementation passes focused backend tests, two Postgres persistence/
locking tests, fifteen Dataflow tests, backend type checking, and staging
Terraform validation. A disposable BigQuery dataset verified sequential retries,
overlapping windows, correct daily totals, and atomic rollback after an injected
failure; the dataset was removed afterward. This synthetic contract test does
not replace #932's deployed artist-dashboard acceptance.
