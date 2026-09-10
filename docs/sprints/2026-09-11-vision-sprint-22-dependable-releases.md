# Vision Sprint 22: Dependable releases and complete artist analytics

**Status:** planned.
**Milestone:** [24](https://github.com/akoita/resonate/milestone/24).
**Goal:** A sprint release reaches staging on the first attempt with an honest
version surface, and the artist dashboard accounts for every event family the
warehouse already stores.

## Approved scope and order

1. [#1747](https://github.com/akoita/resonate/issues/1747): reject a release
   dispatch that selects a service the target environment disables, before any
   image is published.
2. [#1748](https://github.com/akoita/resonate/issues/1748): decide where the
   full end-to-end suite runs against merged `main`, and implement it so a
   release-blocking failure is visible before a publish dispatch.
3. [#1739](https://github.com/akoita/resonate/issues/1739): link About Build to
   the deployed release or tag, with an honest fallback for untagged builds.
4. [#1743](https://github.com/akoita/resonate/issues/1743): attribute punchline,
   shows, remix, and recommendation events to artists in the warehouse.
5. [#1749](https://github.com/akoita/resonate/issues/1749): repair the duplicate
   warehouse rows left by the pre-cutover execution mode.

Prerequisites are satisfied: the batch cutover is deployed and verified
(#1062 and #932 closed in Sprint 21), and the reload race that blocked two
Sprint 21 release attempts is fixed (#1745 by #1746).

`resonate-iac#225` — `DATABASE_URL` held in a plaintext Cloud Run environment
variable — is a companion in the infrastructure repository, not admitted here.

Capacity is one focused workstream with no due date and no fixed capacity
commitment. There is no Sprint 21 carry-over; that milestone closed 2/2.

## Why this shape

Sprint 21 delivered its goal but its release needed four dispatches. Two
published nothing because the release plane was the first full end-to-end run
after merge; a third published images and then failed reconciliation because
the default service selection includes a service staging disables. Both
failures are cheap to prevent and expensive to hit, so the delivery path is
this sprint's largest evidenced weakness.

The analytics items finish what Sprint 21 deliberately left visible rather than
absorbed: activity that is ingested correctly but never reaches the artist it
belongs to, and historical rows that inflate stored daily totals.

## Exit and boundaries

A `Release Deployment` dispatch with default staging inputs completes green end
to end on the first attempt. A release-blocking end-to-end failure would have
been visible before that dispatch. The About dialog identifies the deployed
build on staging. All four named event families carry `artistId` in
`analytics_facts`, verified against live staging. `analytics_facts` and
`analytics_views` contain no duplicate keys.

Staging deploys from a `main` commit rather than a tag, so #1739's expected
staging behaviour is the honest commit fallback; the tagged path is exercised
against the existing `milestone-*` releases. Changing that assumption would
pull in [#1667](https://github.com/akoita/resonate/issues/1667) and is out of
scope here.

Excluded: the `v*` software release plane (#1667), production go-live,
always-on Dataflow activation, discovery marts, the credited-artist identity
redesign (#1492), and historical warehouse deletion reconciliation (#881).

The work benefits artists through complete reporting, release maintainers and
developers through a delivery path that fails before publishing rather than
after, and anyone reading About through an accurate build identity. This is
vision-neutral quality (`vision:keep`); ADR-BM-6 revenue flows, fees, prices,
and payouts remain unchanged.
