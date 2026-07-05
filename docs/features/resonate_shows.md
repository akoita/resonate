---
title: "Resonate Shows"
status: partial
owner: "@akoita"
---

# Resonate Shows

## Status

`partial`

The fan-funded campaign loop is implemented end to end and validated on
**test/staging** (CI green on `main` across lint, contracts
unit/fuzz/invariant, backend unit + integration, e2e, and build). It is **not
yet in production for real users** — production (real-user) launch is a later
phase, pending the go-live follow-ups below. A fan can discover a campaign, read its
artist-approved immutable terms, pledge on-chain into the campaign-specific
`ShowCampaignEscrow` through their smart account, receive a durable receipt
reconciled from the indexed `Pledged` event, and claim an automatic refund when
a campaign fails or is cancelled. Artists and operators can create, activate,
and manage campaigns, confirm booking and fulfillment, and run the off-chain
dispute workflow. Funded never means released: payout stays gated by artist
authority, booking/fulfillment evidence, and the on-chain dispute-window
time-lock.

Surfaces: home campaign hero, `/shows`, `/shows/create`, `/shows/:slug/edit`,
and the campaign detail page (for example `/shows/sennarin-paris`). The web app
reads the backend Shows API as the source of truth and keeps seeded sample data
only as a local/offline fallback. The campaign trust model and fund-release
policy are defined in
[Show Campaign Trust And Escrow Policy](../rfc/show-campaign-trust-escrow.md);
show attendance credential boundaries are defined in
[Show Attendance Credential Boundaries](../rfc/show-attendance-credential-boundaries.md)
(off-chain, opt-in, event-scoped badges, while city-scene membership and private
attendance history stay off-chain).

**Before production (real-user) go-live (not feature gaps):**

- promote the deployed `ShowCampaignEscrow` address into production config and
  wire each campaign's `contractCampaignId` (a deploy-time step);
- expand formal (Halmos/Certora) and mutation (Gambit) coverage — currently
  outside the CI gate (`forge test --no-match-path "test/formal/*"`), tracked in
  [#943](https://github.com/akoita/resonate/issues/943) and
  [#944](https://github.com/akoita/resonate/issues/944);
- optionally gate or remove the seeded `CAMPAIGNS[]` web fallback for production
  builds.

Campaign creators can now attach a promotional visual set to draft campaigns:
a full-width hero image for the public campaign page, a preview/card image for
compact campaign listings, and additional gallery visuals that form the
campaign's visual story on the detail page. The draft editor lets campaign
teams add, replace, delete, and reorder gallery visuals before activation. When
a compact preview is not supplied, the UI reuses the hero or gallery visual
with a safe crop and falls back to the generated concert-card atmosphere only
as a last resort.

Campaign detail pages use a conversion-first layout (#1365, #1373): the
above-the-fold hero pairs the campaign copy (title, date/venue, tagline,
funding progress, escrow trust line with explorer link) with the **live pledge
module** — the real tier picker, wallet pledge button, and success-only fee
notice render inside the hero as a glass card, so a fan can pledge without
scrolling at all. Below the hero, a full-width signal strip shows funded %,
backers needed, deadline, and show target. Campaign story, artist context
(portrait beside full-width flowing text), gallery, why-this-matters,
how-it-works, and community content fill the main column while locked terms
and trust state stay in a sticky right rail; the detail page and the `/shows`
explorer share the same page width. On mobile, a bottom pledge bar keeps
funding progress and a shortcut to the hero pledge card available while
scrolling. Long `Title: Subtitle` campaign names render as a two-part
headline, unusually long venue targets are clamped with the full text
preserved in browser hover text, and long campaign pitches are expanded into a
dedicated pitch section below the signal strip. Operator controls remain
admin/operator-only and sit at the bottom of the detail page in a collapsed
lifecycle panel.

The repository also ships four media-rich, repeatable sample concepts:
SennaRin in Paris, Felicia Farerre in Dublin, Leona Lewis in Lagos, and Aya
Nakamura in Montréal. Each combines a source-grounded artist biography with
fictional campaign copy, modest original campaign artwork, and locally stored
openly licensed media. Real artist photography is included only when its reuse
license is documented. The UI labels these records as samples and does not
claim artist endorsement, a venue hold, or a live escrow deployment.

## Who It Is For

- Listeners who want to bring an artist to their city.
- Artists and teams who need credible demand before committing tour budget.
- Promoters, venues, and agents who need more than likes or comments before
  holding a date.

## Value

Resonate Shows is one early expression of Resonate's broader thesis: AI,
agent-native interfaces, and blockchain rails should unlock better music
experiences, not just add crypto checkout to a streaming app. In this case, the
new experience is fan coordination with programmable escrow. Other expressions
already include agentic commerce, MCP catalog access, x402 checkout, and
machine-readable receipts. Shows turns soft fandom into an economic booking
signal:

> **Fans bring the show. Artists get a booking signal backed by money, not likes.**

Fans coordinate around an artist, city, deadline, and threshold. Funds are
intended to sit in smart-contract escrow until the campaign clears or fails.
Funding success is not payout success: a funded campaign proves demand, then
release depends on artist authority, booking confirmation, fulfillment evidence,
and the campaign's published release policy. If it misses, the refund-first
design protects fans from vague donation risk.

## External Market Evidence

On May 17, 2026,
[NANO-ナノ-OFFICIAL](https://x.com/nanonano_me/status/2055828277185687878)
published a public English-language post to international Japanese music fans
describing why more Japanese artists do not do overseas shows: the cost and risk
of selling enough tickets abroad, especially without major label or agency
support. Public X metadata observed at review time identified the account as a
Tokyo-based musician account with roughly 172k followers, so this is a
directional market signal from a meaningful artist account rather than an
abstract product assumption.

The post maps directly to Shows:

- artists may want to tour but cannot justify losing money;
- overseas fans exist but are hard to aggregate into credible demand;
- follows, comments, streams, and shares help but remain soft signals;
- fans need a concrete action that proves intent before a show is booked.

Treat the follower count as time-sensitive and refresh it before investor, press,
or launch material. The durable insight is the demand-risk problem, not the exact
count.

On May 21, 2026, Spotify announced Reserved, a Premium fan ticket-access feature
that uses signals such as listening history, sharing, and location to reserve
limited concert tickets for eligible fans. That announcement validates the
broader live-fandom opportunity, but it targets access after a show already
exists. Shows should differentiate upstream: fans help create the booking signal
before the artist, venue, or promoter takes production risk.

Positioning:

> Spotify rewards super-fans with access to existing tours. Resonate lets fans
> create the demand signal that gets the show booked.

## How It Works

1. A campaign defines an artist, city, venue target, deadline, funding goal, and
   minimum fan threshold.
2. Public demand signals can be fan-proposed, but full escrow activation
   requires a certified artist-authorized beneficiary.
3. Fans join active escrow campaigns through pledge tiers that represent intent.
4. Campaign progress is public: amount raised, percentage funded, backer count,
   days left, and threshold.
5. When the threshold clears, the artist receives a credible booking signal.
6. When booking and fulfillment rules are satisfied, funds can be released under
   the campaign's published policy.
7. When the threshold misses, the intended production flow refunds pledges
   automatically.

## Artist Authority & Immutable Terms (MVP)

Resonate Shows is deliberately two-sided: **demand is open, money is gated.**
Anyone authenticated can propose a public demand signal and explore interest
with almost no friction — that openness is the point, and a signal is never
represented as an escrow campaign or a promise of payout. But before a campaign
can hold real pledges, it has to clear an **artist authority** gate so funds
can't be routed to an impersonator. The authority model encodes the inclusion
vs. scam-prevention tradeoff: low-friction for demand, deliberately strict for
custody.

**Campaign levels** (`ShowCampaignLevel`): `signal` → `provisional_campaign` →
`active_escrow_campaign`. Only an `active_escrow_campaign` with approved
authority and a bound beneficiary can be activated.

**Authority is an operator decision.** Authority status
(`ShowArtistAuthorityStatus`) moves `none` → `artist_acknowledged` (the artist
signs the terms and binds a beneficiary via `request-authority`) →
`artist_authorized` / `trusted_source_authorized` (granted by an operator after
review). The API enforces this on **every** write path: neither
`request-authority` nor campaign **create** will accept a self-issued authorized
status from a non-operator. Without that guard a self-serve artist could create
a campaign already marked `artist_authorized` against their own payout wallet and
self-activate it, bypassing review entirely — so create rejects it the same way
the request endpoint does. Activation additionally requires an approved status
plus a bound `beneficiaryAddress`/`beneficiaryType`.

**Approved terms are immutable.** The moment authority is approved (or an
operator stands a campaign up already authorized), the campaign's fan-risk terms
are snapshotted into a tamper-evident hash (`ShowCampaign.approvedTermsHash`,
with the full snapshot in `metadata.approvedTerms`). The locked terms are: goal
amount, deadline, booking deadline, minimum backers, currency, payment
asset/network, beneficiary address/type, deposit-release bps, release policy,
dispute window, and each tier's financial terms. While the lock is set:

- `updateDraftCampaign` refuses any edit that would change a locked term — the
  update endpoint is a full replace, so an unchanged save re-sends identical
  terms and is allowed (you can still edit pitch copy, visuals, and other
  non-risk fields); changing goal, deadline, beneficiary, or release terms is
  rejected.
- `activateCampaign` re-verifies the live terms still hash to the approved
  value, as defense in depth against any out-of-band write that bypasses the
  update path.

**Amendment / emergency path.** To change approved terms an operator **revokes**
authority (`revoke-authority`, also the emergency stop), which clears the
snapshot and reopens editing; the campaign then goes back through
request → re-approve, which re-snapshots the new terms. `reject` and `expire`
clear the snapshot the same way. Every transition — requested, approved,
rejected, revoked, expired, and the beneficiary it bound — writes a
`ShowCampaignEvent`, and the approval event records the `approvedTermsHash`, so
"what exactly did the artist approve" is auditable after the fact.

## Evidence, Disputes & Release Authority (MVP)

Booking and fulfillment confirmation are evidence-gated: an operator/admin must
attach a booking evidence bundle to confirm booking, and a fulfillment evidence
bundle to confirm fulfillment (#950). Final release is gated by the `ShowCampaignEscrow` contract, which time-locks
`releaseFunds` until `fulfilledAt + disputeWindowSeconds`. The backend
complements this by blocking **fulfillment progress** while a dispute is open
(an open dispute can't advance a campaign to `fulfilled`). It does **not** block
the on-chain release itself — release is operator-triggered and time-locked — so
if `FundsReleased` is observed while an off-chain dispute is still open, the
#948 indexer records the release (chain is authoritative) and emits a
`shows.campaign_reconciliation_mismatch` ops alert. Enforcing release-blocking
on-chain (an actual on-chain dispute state) is a tracked follow-up.

**MVP authority model.** Disputes are off-chain and operator-driven: an
operator/admin can open a dispute (between booking confirmation and the close of
the post-fulfillment dispute window) and resolve it with an audited outcome
(`upheld` / `rejected` / `inconclusive`). Every dispute action writes a
`ShowCampaignEvent`. Fans see a redacted `disputeStatus` and the dispute-window
close time, but never operator notes, dispute reasons, or initiator identity.
Pause/cancel/reject/release remain operator/admin actions; the contract owner /
configured confirmer is the on-chain release authority.

**Future path.** Fan-initiated disputes (with backer-stake rules), evidence
submission by both parties, and decentralized resolution (a jury/DAO or an
oracle attestation feeding an on-chain dispute state) are deliberately deferred;
the current contract exposes only a time-based window, so richer dispute
settlement is a later protocol slice rather than MVP scope.

## Current UI Surfaces

| Surface | Status | Notes |
| --- | --- | --- |
| Home campaign hero | implemented | Featured campaign card links into the Shows route. |
| `/shows` | implemented | Campaign explorer reads the backend Shows API and falls back to four researched sample concepts for local/offline demos. The public default list hides refund/terminal campaigns, while admin/operator users get a status filter for Default, All, Active, Funded, Cancelled, Refunds, and Released views. Uploaded campaign preview visuals appear on campaign cards when available, with non-actionable status badges when terminal/refund campaigns are shown. |
| `/shows/create` | implemented | Authenticated artists, admins, and operators can create draft escrow campaigns with campaign terms, evidence references, pledge tiers, a hero visual, a compact preview visual, and an ordered gallery visual set. Active escrow campaign drafts must select a declared catalog artist credit with at least one ready or published release, so the public subject matches the public catalog Artists view instead of the uploader profile. The public campaign title is the fan-facing identity used on cards, heroes, breadcrumbs, and new campaign slugs; for normal artists, platform artist identity and beneficiary wallet are still derived from the artist profile for authority and payout safety. Operators select from catalog artist credits and still need review-gated authority before activation. Creating a campaign already marked `artist_authorized`/`trusted_source_authorized` is operator-only (#946) — a non-operator self-issuing an authorized status is rejected the same way `request-authority` rejects it. |
| `/shows/:slug/edit` | implemented | Draft campaigns can be edited before activation, including public campaign title/copy, hero/preview visuals, gallery add/replace/delete/reorder controls, campaign terms, authority evidence reference, beneficiary wallet, payment token, and pledge tiers. Once artist authority is approved, the critical fan-risk terms are locked (#946): edits that change goal, deadline, beneficiary, deposit-release %, release policy, dispute window, booking deadline, or tier financials are refused until an operator revokes authority; non-risk fields (copy, visuals) stay editable. |
| `/shows/sennarin-paris` | implemented | Detail page reads the backend Shows API by slug with seeded fallback, shows funding progress, signal tiers, and how-it-works copy, and uses the uploaded hero visual, gallery mosaic, expanded campaign pitch, dense-title treatment, and campaign image metadata for large social previews when available. A trust/terms panel (#949) shows the campaign trust state (demand signal / provisional / artist-authorized escrow / authority-revoked / refund-available / cancelled), an artist-authority + masked-beneficiary summary (no sensitive evidence ids), and the immutable terms a fan reads before signing (goal, deadline, minimum backers, payment asset/network, deposit-release %, dispute window, booking deadline, refund policy), with honest copy that funding never guarantees a ticket. The pledge panel renders the full pledge lifecycle state (`pledgeStateLabel`), and gates the pledge form on `campaignPledgeAvailability` (#949): when the campaign isn't open for pledging it shows an honest empty state instead of a live form — awaiting artist authority, not authorized (revoked/rejected/expired), open demand signal (no escrow), or terminal/refund — while still surfacing the refund action for existing backers. Before the wallet signature, a pre-sign confirmation dialog (#1240, `pledgeConfirmSummary` + the shared `ConfirmDialog`) recaps the selected tier amount and the fan-risk terms (payment asset/network, deposit-on-booking %, refund policy, dispute window) with honest no-guaranteed-ticket copy; cancelling aborts before any intent is created. |
| Escrow contract | implemented | `ShowCampaignEscrow.sol` now exists with threshold, refund, booking, fulfillment, and release-gating unit/fuzz/invariant/formal coverage. Deployment now emits JSON, `.remote.env`, and ABI handoffs; production activation still needs the promoted escrow address plus per-campaign `contractCampaignId` wiring. |
| Escrow event indexer | implemented | `ShowsEscrowIndexerService` (#948) polls `ShowCampaignEscrow` logs (gated by `ENABLE_SHOWS_ESCROW_INDEXER`), records them idempotently in `ShowCampaignEscrowEvent` (unique `(txHash, logIndex)`), advances a per-chain `ShowEscrowIndexerState` cursor with reorg jump-back, and reconciles campaign status/accounting (`onChainStatus`, `raisedAmountUnits`, `uniqueBackerCount`, `totalRefundedUnits`, `totalReleasedUnits`) plus pledge status from on-chain truth. Activation/link also hydrates the linked campaign directly from `campaigns`, `campaignFees`, and `campaignStatus`, and operators can retry that snapshot through `POST /shows/campaigns/:id/resync-chain` if an event-order gap or RPC outage leaves a campaign stale. Drift (no bound campaign, or an on-chain pledge with no backend intent) emits `shows.campaign_reconciliation_mismatch`. |
| Pledge flow | implemented | Backend pledge intent, transaction submission, refund confirmation, and authenticated receipt reads are implemented. The detail page lets connected fans select a tier, create a receipt-ready pledge intent, execute the ERC-20 approval plus escrow pledge through the smart account, and attach the mined transaction to the backend receipt. A pledge intent's `walletAddress` must match the caller's own registered wallet (#1221), so a backer's on-chain pledge cannot be attributed to another account. **A wallet user's pledge reaches `confirmed` only from the indexed on-chain `Pledged` event (#948), never from a client-submitted claim; operators retain a manual confirm/fail override.** Fans see their latest campaign pledge and claim refunds when the campaign/pledge is refund-available and linked contract call data exists. |
| Campaign community | implemented | Shows detail pages expose a connected campaign-community panel. Any authenticated fan can join the open campaign-owned `show_city_demand` room to signal coarse city interest without pledging. Confirmed backers can join the private `show_campaign_supporter` room, artists/operators can post `campaign_update` messages, supporters can post room messages, and confirmed or released pledge support derives private supporter badges/roles. Public profiles can show campaign support only through listener `showCampaignSupport` opt-in. Refund-only, refunded, failed, and cancelled support no longer grants private supporter room access or public campaign-support display. Compact `community.show_city_interest_joined`, `community.campaign_room_joined`, `community.campaign_update_viewed`, `community.badge_granted`, `community.role_granted`, and `community.message_created` analytics connect community activity to campaign state without message bodies, raw location, or wallet holdings. |
| Attendance credentials | planned | [#1098](https://github.com/akoita/resonate/issues/1098) defines the boundary before implementation: no NFT-backed attendance credential yet; start with off-chain opt-in attendance badges backed by confirmed attendance, fulfilled ticket/pledge state, guest-list confirmation, or operator grant. Public display and partner verification must not expose raw location source, ticket price, pledge amount, wallet address, private room membership, city-scene cohort membership, refund/dispute/moderation state, or raw eligibility rules. |
| Campaign backend | implemented | Prisma models exist for campaign, tier, pledge, trust, authority, release, lifecycle-event, and promotional visual state. Public read routes, visual reads, signal creation, draft escrow campaign creation/update, draft visual upload, draft visual replacement/deletion/reordering, authority request/approval/rejection/revocation/expiry, activation, pledge intent, pledge confirmation, "my pledges", cancellation, booking confirmation, fulfillment confirmation, and operator chain re-sync APIs are implemented. Escrow authorization is operator-gated and the artist-approved terms are immutable (#946): authorized authority statuses are rejected from non-operator create/request paths, and on approval the fan-risk terms are snapshotted into `approvedTermsHash` (full snapshot in `metadata.approvedTerms`) so `updateDraftCampaign` refuses silent term changes and `activateCampaign` re-verifies the live terms before activating; revoke/reject/expire clear the snapshot to reopen editing. Public campaign reads (`GET /shows/campaigns`, `GET /shows/campaigns/:slug`) go through a whitelist DTO (#949) that exposes trust state, immutable terms (goal, deadline, min backers, payment asset/network, release policy, deposit-release bps, dispute window, booking deadline), beneficiary summary, and on-chain reconciliation totals, while withholding sensitive authority evidence/credential references, internal storage URIs, ops notes, indexer cursors, and the raw lifecycle-event log. `GET /shows/campaigns` defaults to actionable discovery states, accepts a single validated `status`, and accepts validated `scope=all` for operator overview links that need every lifecycle state. An authenticated operator/admin or the owning artist can additionally read the operator-scoped managed view (`GET /shows/campaigns/:id/manage`, #949), which returns the public fields plus the withheld authority credential/evidence ids and the full dispute list so the operator panel can prefill inputs and act on disputes. Booking and fulfillment confirmation now require an evidence bundle reference (#950), and an off-chain dispute workflow (`POST /shows/campaigns/:id/dispute`, `PATCH .../dispute/:disputeId/resolve`) records `ShowCampaignDispute` rows; an open dispute blocks fulfillment progress toward final release, and the public DTO surfaces a fan-visible `disputeStatus` + `disputeWindowClosesAt` without leaking operator notes, dispute reasons, or initiator identity. |
| Operator controls | implemented | Admin/operator users can manage campaign lifecycle from the campaign detail page: approve artist authority, bind beneficiary data, activate with escrow contract IDs, re-sync a linked campaign directly from chain, cancel to refunds, confirm booking, and confirm fulfillment. The panel reads the operator-scoped managed view (#949, `GET /shows/campaigns/:id/manage`) so it can prefill the authority credential/evidence references the public DTO withholds and load the campaign's dispute history. Operators can also raise an off-chain dispute in the booking → release window and resolve it with an audited outcome (#950); resolution is recorded but never itself moves funds (release stays gated by the on-chain time-lock). Amending approved terms is a deliberate revoke → edit → re-approve flow (revocation is also the documented emergency stop), since approved terms are locked (#946). Artist-owned campaign management remains a follow-up UI. |

## Sample Data Workflow

The sample package lives under `backend/fixtures/show-campaigns/`, with typed
content and creation logic in `backend/src/fixtures/show_campaigns.ts`. Asset
provenance, licenses, source links, and the non-sensual visual standard are
recorded beside the media and must be preserved when assets change.

```bash
cd backend
npm run fixtures:shows -- --dry-run
npm run fixtures:shows
```

On a **deployed** environment the seeded hero/gallery images are served from
storage and only refresh when the seed re-runs — deploying backend code alone
does not update them. Re-run the seed after any backend deploy that changes Show
fixtures: see [seeding the sample Show campaigns](../deployment/seed-sample-shows.md)
(`make seed-shows`, or `make seed-shows-remote` for a one-off Cloud Run Job).

The command validates every asset, uploads through the configured
`STORAGE_PROVIDER`, and upserts stable artists, campaigns, tiers, and visuals.
Re-running it refreshes future dates and replaces only fixture-owned children.
Shared environments require `ALLOW_SAMPLE_SHOW_FIXTURES=true` explicitly.

## Production Beta Requirements

These production surfaces are built and validated on test/staging (see
[Status](#status) for the remaining deploy-time operational follow-ups before
production go-live):

- campaign data loads from backend APIs rather than seeded client data;
- fan-proposed demand signals can be created through the backend API without
  implying artist approval;
- draft escrow campaigns and pledge tiers can be created and edited from the
  web app before activation, active escrow campaign subjects must be declared
  catalog artist credits with ready/published catalog content, artist-owned
  drafts derive identity and payout fields from the platform artist profile,
  promotional visual sets can be uploaded and managed for campaign pages,
  compact previews, and campaign detail galleries,
  authority evidence can be reviewed, rejected, revoked, expired, or approved,
  and only artist-authorized campaigns can activate;
- fans can select a tier, create a pledge intent, submit an on-chain ERC-20
  approval plus escrow pledge through the smart account, confirm the mined
  transaction, and receive a durable backend receipt;
- campaign progress is backed by persisted pledge records reconciled to on-chain
  events rather than client-submitted progress data;
- failed or cancelled campaigns expose refunds and record refund receipts after
  the connected wallet claims from escrow;
- funded campaigns do not release automatically;
- cleared and booking-confirmed campaigns expose booking, fulfillment, dispute,
  and release state;
- admins/operators can advance the campaign lifecycle from the detail page;
- artists, admins, and operators can create draft campaigns; full artist-owned
  editing remains a follow-up.

The core fan incentive should be ticket credit or priority allocation, not a
donation. The fan-facing promise is:

> Pledge now. If the campaign clears, your pledge becomes ticket credit or
> priority access. If it misses, you are refunded.

## Verification

- `web/tests/shows.spec.ts` covers the home hero, sidebar Shows nav, `/shows`
  explorer, and `/shows/sennarin-paris` detail page.
- `web/src/lib/shows.ts` defines the current seeded campaign model and the
  planned async shape for a future backend API.
- `web/src/styles/shows.css` scopes the Shows presentation layer.
- `backend/src/tests/shows_campaign_models.integration.spec.ts` verifies the
  campaign, tier, pledge, and lifecycle-event data model against Testcontainer
  Postgres.
- `backend/src/tests/shows.service.integration.spec.ts` verifies the public
  signal, draft campaign, artist-authority, activation, pledge receipt,
  campaign visual set upload/read path, cancellation, booking confirmation,
  fulfillment confirmation, and listing API service behavior against
  Testcontainer Postgres.
- `backend/src/tests/show_campaign_fixtures.spec.ts` verifies fixture identity,
  source coverage, and committed media completeness.
- `backend/src/tests/show_campaign_fixtures.integration.spec.ts` verifies
  repeatable fixture creation and isolation from unrelated campaigns.
- `contracts/test/unit/ShowCampaignEscrow.t.sol` verifies campaign creation,
  pledging, funded-without-release behavior, missed-deadline refunds, missed
  booking refunds, booking/fulfillment confirmation, optional deposit release,
  final release, and pause behavior.
- `contracts/scripts/write-show-campaign-escrow-handoff.sh` converts the
  Foundry deployment broadcast into reviewed app/deploy handoff files for the
  Shows escrow address and ABI.

## Product Notes

Shows should stay focused on demand formation rather than ticketing alone. The
same escrow-backed campaign primitive can later validate:

- tour stops;
- listening parties;
- merch or vinyl drops;
- fan-funded live sessions;
- remix contests;
- city-specific collector rewards.

The strategic wedge is international niche demand: passionate, distributed fan
bases that are visible in social feeds but hard for artists to convert into
production-safe booking decisions.

For the production implementation plan, including API shape, contract scope,
delivery slices, issue breakdown, and verification, see
[Resonate Shows Production Plan](resonate_shows_production_plan.md).

## Analytics And Warehouse Notes

Visual uploads are campaign-presentation metadata, not demand signals. The
Shows service records `shows.campaign_visuals_updated` with campaign identity,
target geo, `visualAction`, `visualSlots`, and gallery count only. Raw image
bytes, storage paths, captions, credits, and public image URLs are intentionally
excluded from product analytics payloads and warehouse facts. Future campaign
dimension exports may include boolean visual availability flags, sanitized
public image URL fields, or visual-count fields if reporting needs them, but
pledge/demand facts should continue to key on campaign, artist, geo, tier,
amount, and lifecycle state rather than visual assets.
