---
title: "Scene Scout"
status: in-progress
owner: "@akoita"
issues: [1968, 1969, 1970]
---

# Scene Scout

Scene Scout turns qualified listening and catalog gaps into a suggested next
action in the artist analytics cockpit. Artists review each suggestion before
creating a show campaign or changing their catalog.

## Delivery and revenue line

Milestone [33](https://github.com/akoita/resonate/milestone/33) initial
application slices are merged: city demand (#1968, [PR #2044](https://github.com/akoita/resonate/pull/2044)),
popularity snapshots (#1450, [PR #2045](https://github.com/akoita/resonate/pull/2045)),
unmet crate/session demand (#1969, [PR #2046](https://github.com/akoita/resonate/pull/2046)),
first-listener reception (#1970, [PR #2047](https://github.com/akoita/resonate/pull/2047)),
and UI polish ([PR #2048](https://github.com/akoita/resonate/pull/2048)).
Sprint 31 remains in progress: staging acceptance is tracked in
[resonate-iac#264](https://github.com/akoita/resonate-iac/issues/264), and
warehouse scheduling and live checks in
[resonate-iac#263](https://github.com/akoita/resonate-iac/issues/263).
Canonical follow demand remains unavailable until a follow ledger event exists;
pledge demand requires a consent-qualified city declaration captured at intent
creation and an indexer-confirmed pledge linked to a release. The browser pledge
flow offers an optional, consent-gated city field. See the [sprint plan](../sprints/2026-11-19-vision-sprint-31-scene-scout.md) for status.

ADR-BM-6: **Line 2, Artist Pro, phase 2**, behind a currently free entitlement
seam. Suggestions convert into **Line 1, Shows (6%)** and **Line 3, marketplace
(10%)**. Demand and exposure are never payout inputs; no fees or splits change.
Exposure cannot be purchased.

## City demand

The cockpit's `propose_show_city` card summarizes qualified demand for a release
and city over seven or 28 days. A resonant listener completed at least 90% of a
track and then replayed or saved that same track within seven days, matching the
[Taste Engine resonance](../rfc/taste-engine.md#33-objective-and-metrics) rule. Saves and settled commitment
signals contribute only when their consent basis and coarse geography qualify.

Only user-declared city geography counts toward listening demand. A campaign's
target city does not locate its backers. The service resolves releases and
artist ownership from the catalog, excludes the artist's own activity, and
reads consent-governed ledger records within bounded windows. Follow counts
remain zero until the platform has a canonical follow ledger event. Purchases
count verified x402 settlements for a catalog track only when the envelope
also has a governed user-declared city and a known listener identity. The
existing purchase bridge does not infer location from a payer or campaign.

Shows drafts retain a validated source release. Pledges can contribute when the
intent API receives a user-declared city from the authenticated backer under the
current analytics consent policy. A separate, private context retains only the
city, country, consent version and declaration time. It stops contributing after
28 days; bounded cleanup removes expired rows on demand reads, pledge writes and
retention runs. It is excluded from campaign and pledge responses, included in
the backer’s personal-data export, and deleted on refusal or account erasure.
Renewed consent cannot revive a deleted declaration.

Demand uses the indexer’s matching wallet, amount, transaction and block proof,
current consent, and a ready or published, unwithdrawn release owned by the
selected artist. Refundable, refunded, cancelled or failed contributions are
excluded, as are the artist’s own activity and declarations predating a taste
reset. Seven- and 28-day windows use the confirmation time; distinct people
share the audience count with listening signals. Incomplete bounded reads clear
old snapshots and show thin data. A campaign target city never locates a backer.

Browser city entry now ships in the Shows pledge panel: while product analytics
consent is granted, the panel offers an optional, initially empty city and
country field (never prefilled from the campaign city) and sends it as the
user-declared `geo` on the pledge intent. Without consent, or with the field
left blank, the pledge sends no city. Canonical follows remain tracked in open
#1968. The
analytics consent wording now explicitly covers optional pledge city demand;
older decisions require renewal before optional analytics resumes. Affirmative
grants must include the version bound to the client’s displayed wording
(`consentTextVersion`), so legacy clients cannot merely echo a fetched server
version and silently agree to new processing. Refusal remains available without
that field.

Rows below `DISCOVERY_MIN_AUDIENCE` unique listeners are never written to the
city snapshot table. Cards also require the cockpit's five-signal floor. Thin
data displays **Not enough listening yet**. No listener identifiers, prompts,
raw location or wallet identities appear in snapshots or cards.

The **Draft a show** action opens `/shows/create` with coarse city, country and
release-reference parameters. The editor resolves the release against the
signed-in user's visible catalog, initializes the release context and city,
and keeps the details editable. Saving the draft retains its source release
while the selected artist matches that release. The backend accepts only a
ready or published, unwithdrawn release with canonical credit for the selected
artist. Editing a draft preserves the association; selecting an artist outside
the release credits clears it in the editor. Campaign ownership, payout eligibility and artist authority
remain enforced by the existing Shows workflow.

## Searched but missing demand

Crate gaps become categorical observations only when an otherwise eligible
catalog candidate fails exactly one requested filter. Missing stems and licenses
point to that actual track. BPM, key, energy and other categorical gaps describe
artist or genre supply; they do not claim an unrelated track matches the request.
Short DJ sessions use structured intent and actual returned track counts,
including sessions with no picks. Unresolved catalog attribution is omitted.

Observations require current analytics consent, exclude the artist's own
requests, and retain no prompts or reasoning. They expire after 28 days; bounded
cleanup runs on reads and writes and through the analytics retention procedure.
Current consent and taste-memory controls are checked again when refreshing
aggregates, so withdrawal removes the contribution from the next safe snapshot.
Account erasure explicitly deletes requester-linked observations.

Only seven- and 28-day `DemandSignal` aggregates above `DISCOVERY_MIN_AUDIENCE`
distinct requesters are stored or returned. Cockpit cards also need five requests.
**Publish this stem** and **List this license** open the canonical release and
track's existing listing controls with validated categorical context. The artist
reviews the supply, rights and terms before confirming; the suggestion never
publishes or lists automatically. Other gaps link to the artist catalog. Small
or unavailable samples produce an honest status rather than a sales estimate.

## First listeners and reception

Fresh playable releases enter Home and DJ candidates during their first seven
catalog days. Freshness uses `Release.createdAt`, because the catalog has no
publication timestamp; future-dated, withdrawn, unplayable or fully AI releases
are excluded. A named positive taste signal and verified human artist are
required for priority inside the existing exploration budget. Listener hides,
downranking, artist diversity and the existing discovery explanation remain.
Exposure cannot be purchased and does not affect payouts.

Placement reservations recheck catalog eligibility and verification under a
release lock. Each listener can receive at most one placement per release;
a release can receive at most 1,000. An anonymous release counter survives
listener erasure, so deleting exposure history cannot replenish the budget.
Denied or failed reservations remove fresh placement privilege before ordinary
selection fills the remaining page; they cannot promote another uncapped pick.

Model-driven DJ picks and ordinary catalog candidates pass the same bounded,
authoritative freshness checks. Only the returned fallback replacement reserves
a placement; other considered candidates do not consume the budget. Incomplete
eligibility checks suppress discovery privilege, and policy failures strip
unverified model discovery annotations. Authenticated recommendation routes
require the requested user to match the JWT.

After seven days, reception counts consent-qualified listeners who actually
played the same release after placement and within its first week. Full plays
require at least 90% completion; saves must follow hearing. Current consent,
resets, agent-training opt-out and self-activity exclusions govern the read.
Forged release payloads cannot override the canonical track/release relationship.
Bounded-read overflow suppresses the result. Audience and subcount floors hide
small samples; a card also requires five heard listeners. Suppressed counts say
**not enough data**, never zero. Follows remain unavailable until a canonical
follow event exists. User-linked exposures are scoped in privacy exports and
explicitly deleted during account erasure.

## API, analytics and lifecycle

The existing authenticated `GET /analytics/artist/:id/v1` response carries the
stable cockpit cards, a `sceneScout` city status, an `unmetDemand` status and a
`firstListenerReception` status. Artist analytics authorization
protects the read. Scene Scout adds no public audience endpoint.

Cockpit impressions and clicks use the existing `artist.action_card_impression`
and `artist.action_card_clicked` events with categorical card metadata.
Snapshots are rebuilt from the remaining eligible ledger records on dashboard
reads; current consent and taste-memory controls govern playback eligibility.
An incomplete bounded read suppresses suggestions instead of presenting a
partial audience as a complete picture.

## Verification

When staging has no qualifying city card, use the guarded
[city-card acceptance fixture procedure](../operations/scene_scout_acceptance.md)
to prepare synthetic demand for an explicitly selected artist release. The tool
preserves real consent and catalog records, uses the normal audience thresholds,
and provides scoped cleanup. Synthetic evidence can validate the card-to-draft
flow; it does not prove real listener geography capture or the other Scene Scout
acceptance scenarios.

Run the focused Scene Scout backend unit/integration tests, the artist
analytics card tests and the Shows prefill/form tests. Integration fixtures
prove small audiences are absent from storage and responses, invalid consent
and campaign-target geo are excluded, and withdrawals remove their contribution.
The pledge integration tests cover capture and consent-refusal concurrency,
matching escrow proof, pledge-only demand, cross-signal identity deduplication,
expiry, reset, refunds and shared read-cap suppression. Personal-data tests
prove city-context export isolation and deletion without financial pledge loss.

The source-release integration tests cover persistence, omission, explicit
clearing, artist attribution and invalid catalog references. The Scene Scout
browser test follows a city card through an editable draft and checks the saved
release reference. The User Guide's artist analytics article describes the same
behavior.

External staging verification remains open in
[resonate-iac#264](https://github.com/akoita/resonate-iac/issues/264), and
warehouse scheduling and live checks remain open in
[resonate-iac#263](https://github.com/akoita/resonate-iac/issues/263). This
page makes no claim about their deployed state.

## Related documents

- [Taste Engine RFC](../rfc/taste-engine.md#6-scene-scout-artists)
- [Analytics dashboards](analytics_dashboard.md)
- [Coarse geo analytics](geo_analytics_demand_dimension.md)
- [Change impact checklist](../engineering/change_impact_checklist.md)
