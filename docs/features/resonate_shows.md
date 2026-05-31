---
title: "Resonate Shows"
status: partial
owner: "@akoita"
---

# Resonate Shows

## Status

`partial`

The fan-funded Shows wedge is visible in the web app through the home campaign
hero, `/shows`, and `/shows/sennarin-paris`. The web app reads the backend
Shows API first and keeps seeded campaign data only as a local/offline fallback.
The deployed UI still links to an existing Sepolia `RevenueEscrow` contract as
an honest stand-in until the campaign-specific escrow deployment is wired. The
backend truth layer now includes Prisma models, public reads, demand signals,
draft escrow campaign creation, artist-authority review, activation, pledge
intent/confirmation receipts, and operator lifecycle transitions for
cancellation, booking confirmation, and fulfillment confirmation.

The next step is documented in
[Resonate Shows Production Plan](resonate_shows_production_plan.md): replace the
placeholder wedge with a working fan-funded live campaign loop backed by
backend campaign state, pledge receipts, and a campaign-specific escrow
contract. The campaign trust model and fund-release policy are defined in
[Show Campaign Trust And Escrow Policy](../rfc/show-campaign-trust-escrow.md).

Campaign creators can now attach promotional visuals to draft campaigns:
a full-width hero image for the public campaign page and a preview/card image
for compact campaign listings, home/event modules, and social link previews.
When a compact preview is not supplied, the UI reuses the hero visual with a
safe crop and falls back to the generated concert-card atmosphere.

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

## Current UI Surfaces

| Surface | Status | Notes |
| --- | --- | --- |
| Home campaign hero | implemented | Featured campaign card links into the Shows route. |
| `/shows` | partial | Campaign explorer reads the backend Shows API and falls back to three seeded examples for local/offline demos. Uploaded campaign preview visuals appear on campaign cards when available. |
| `/shows/create` | partial | Authenticated artists, admins, and operators can create draft escrow campaigns with campaign terms, evidence references, pledge tiers, and promotional hero/preview visuals. Active escrow campaign drafts must select a declared catalog artist credit with at least one ready or published release, so the public subject matches the public catalog Artists view instead of the uploader profile. The public campaign title is the fan-facing identity used on cards, heroes, breadcrumbs, and new campaign slugs; for normal artists, platform artist identity and beneficiary wallet are still derived from the artist profile for authority and payout safety. Operators select from catalog artist credits and still need review-gated authority before activation. |
| `/shows/:slug/edit` | partial | Draft campaigns can be edited before activation, including public campaign title/copy, promotional visuals, campaign terms, authority evidence reference, beneficiary wallet, payment token, and pledge tiers. |
| `/shows/sennarin-paris` | partial | Detail page reads the backend Shows API by slug with seeded fallback, shows funding progress, signal tiers, and how-it-works copy, and uses the uploaded hero visual plus campaign image metadata for large social previews when available. |
| Escrow contract | partial | `ShowCampaignEscrow.sol` now exists with threshold, refund, booking, fulfillment, and release-gating unit/fuzz/invariant/formal coverage. Deployment now emits JSON, `.remote.env`, and ABI handoffs; production activation still needs the promoted escrow address plus per-campaign `contractCampaignId` wiring. |
| Pledge flow | partial | Backend pledge intent, transaction confirmation, refund confirmation, and authenticated receipt reads are implemented. The detail page lets connected fans select a tier, create a receipt-ready pledge intent, execute the ERC-20 approval plus escrow pledge through the smart account, attach the mined transaction to the backend receipt, see their latest campaign pledge, and claim refunds when the campaign/pledge is refund-available and linked contract call data exists. |
| Campaign supporter room | partial | Shows detail pages expose a connected supporter-room panel. Confirmed backers can join a campaign-owned `show_campaign_supporter` room, artists/operators can post `campaign_update` messages, supporters can post room messages, and compact `community.campaign_room_joined` / `community.message_created` analytics connect community activity to campaign state. City demand groups, supporter badges/roles, and lifecycle revocation remain #1000 follow-up slices. |
| Campaign backend | partial | Prisma models exist for campaign, tier, pledge, trust, authority, release, lifecycle-event, and promotional visual state. Public read routes, visual reads, signal creation, draft escrow campaign creation/update, draft visual upload, authority request/approval/rejection/revocation/expiry, activation, pledge intent, pledge confirmation, "my pledges", cancellation, booking confirmation, and fulfillment confirmation APIs are implemented. |
| Operator controls | partial | Admin/operator users can manage campaign lifecycle from the campaign detail page: approve artist authority, bind beneficiary data, activate with escrow contract IDs, cancel to refunds, confirm booking, and confirm fulfillment. Artist-owned campaign management remains a follow-up UI. |

## Production Beta Requirements

The placeholder copy should be removed once these production surfaces are live:

- campaign data loads from backend APIs rather than seeded client data;
- fan-proposed demand signals can be created through the backend API without
  implying artist approval;
- draft escrow campaigns and pledge tiers can be created and edited from the
  web app before activation, active escrow campaign subjects must be declared
  catalog artist credits with ready/published catalog content, artist-owned
  drafts derive identity and payout fields from the platform artist profile,
  promotional visuals can be uploaded for campaign pages and compact previews,
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
  campaign visual upload/read path, cancellation, booking confirmation,
  fulfillment confirmation, and listing API service behavior against
  Testcontainer Postgres.
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
target geo, and `visualSlots` only. Raw image bytes, storage paths, and public
image URLs are intentionally excluded from product analytics payloads and
warehouse facts. Future campaign dimension exports may include boolean visual
availability flags or sanitized public image URL fields if reporting needs
them, but pledge/demand facts should continue to key on campaign, artist,
geo, tier, amount, and lifecycle state rather than visual assets.
