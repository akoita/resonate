---
title: "Resonate Shows Production Plan"
status: planned
owner: "@akoita"
related:
  - "../rfc/show-campaign-trust-escrow.md"
---

# Resonate Shows Production Plan

## Goal

Turn the current Shows web wedge into a production beta for fan-funded live
campaigns. The beta must remove placeholder language and prove the core loop:

> Fans pledge to bring an artist to a city. If the campaign clears, the pledge
> becomes ticket credit or priority access. If it misses, the pledge is
> refunded.

This is not a ticketing clone. It is demand formation before a show exists.

## Market Signal

On May 21, 2026, Spotify announced Reserved, a ticket access feature that uses
Premium membership plus fan signals such as listening history, sharing, and
location to reserve limited tickets for eligible fans. Public coverage framed
this as reserved concert access for "super fans."

This validates the live fandom wedge, but it does not solve the earlier booking
problem. Spotify helps allocate scarce access after artists, venues, and
promoters have already decided to stage a show. Resonate Shows should own the
step before that: converting distributed fan intent into a transparent,
refund-first, money-backed booking signal.

Strategic positioning:

> Spotify rewards super-fans with access to existing tours. Resonate lets fans
> create the demand signal that gets the show booked.

Reference links:

- Spotify Newsroom:
  <https://newsroom.spotify.com/2026-05-21/investor-day-reserved-launch/>
- La Presse:
  <https://www.lapresse.ca/arts/musique/2026-05-21/spectacles/spotify-mettra-de-cote-des-places-pour-les-super-fans.php>
- KultureGeek:
  <https://kulturegeek.fr/news-352562/spotify-reserver-places-concerts-fans>

## Product Principles

- Demand formation first, ticketing second.
- Refund-first escrow instead of vague donations.
- Demand can be permissionless, but payout authority cannot be.
- Public campaign rules: goal, threshold, deadline, pledge tiers, and contract
  state must be visible.
- Fan action should create durable status: receipt, pledge state, future ticket
  priority, and campaign participation history.
- Artist and promoter value should be explicit: committed demand by city, not
  likes, comments, or opaque listening scores.
- Eligibility should not depend on a closed subscription gate. Wallet, account,
  and anti-abuse checks can protect the campaign without turning fandom into a
  platform-controlled black box.

The trust and release policy is defined in
[Show Campaign Trust And Escrow Policy](../rfc/show-campaign-trust-escrow.md).
The key product decision is that anyone may create demand signals, while full
escrow activation requires certified artist authority and an immutable
beneficiary.

## Fan Incentives

The production version should avoid donation-only language. Fans need a clear
reason to pledge early.

| Tier | Fan value | Business value |
| --- | --- | --- |
| Fan Signal | Low-friction refundable pledge, campaign receipt, public proof of support | Measures broad demand and backer count |
| Ticket Intent | Refundable pledge that becomes ticket credit or priority allocation if booked | Measures realistic ticket demand |
| Patron Circle | Higher pledge with premium allocation, merch, meet-and-greet, or city-specific perks when confirmed | Measures sponsor/patron depth and reduces production risk |

Until venue and ticketing integrations are live, use "ticket credit" and
"priority allocation" rather than absolute guaranteed-ticket copy.

## Production Scope

The beta is production-ready when these surfaces are live:

- `/shows` reads campaigns from the backend, not seeded client data.
- `/shows/:slug` shows live campaign, tier, pledge, and contract state.
- public demand signals can exist without implying artist approval.
- full escrow campaigns require an artist-authorized beneficiary credential.
- Connected fans can choose a tier, submit an on-chain pledge, and receive a
  backend receipt after transaction confirmation.
- The campaign progress bar, amount raised, backer count, deadline, and
  threshold are backed by persisted pledge records reconciled to on-chain events.
- Fans can see their pledge status: pending, confirmed, refunded, released, or
  failed.
- Failed campaigns expose a refund path.
- Funded campaigns do not release automatically; booking confirmation and
  campaign release rules control payout.
- Cleared and booking-confirmed campaigns expose staged release or final release
  state.
- Artists, admins, or approved operators can create and manage campaigns.
- Admin/operator lifecycle controls are available from campaign details for
  authority approval, activation, cancellation, booking confirmation, and
  fulfillment confirmation.
- Authenticated artists, admins, and operators can create draft escrow
  campaigns with pledge tiers from `/shows/create`.
- Draft campaigns can be edited before activation from `/shows/:slug/edit`,
  including pledge tier replacement.
- Feature docs describe current behavior rather than future placeholders.

## Technical Architecture

### Backend

Add a first-class NestJS `ShowsModule` with Prisma-backed state.

Recommended models:

- `ShowCampaign`
- `ShowCampaignTier`
- `ShowPledge`
- `ShowCampaignEvent`

Recommended campaign fields:

- artist reference or artist display fields
- city, country, venue target, target date, deadline
- goal amount, minimum backers, currency, payment asset, chain ID
- contract address and contract campaign ID
- campaign level: `signal`, `provisional_campaign`, or
  `active_escrow_campaign`
- artist authority status: `none`, `human_verified`, `artist_acknowledged`,
  `artist_authorized`, `trusted_source_authorized`, `rejected`, `revoked`, or
  `expired`
- artist authority credential/evidence references and immutable beneficiary
  wallet or split contract
- booking deadline, release policy, optional deposit release basis points, and
  dispute window
- status: `draft`, `active`, `funded`, `booking_confirmed`,
  `deposit_released`, `fulfilled`, `released`, `cancelled`,
  `refund_available`, `refunded`
- raised amount, confirmed pledge count, unique backer count
- booking terms and fan-facing fulfillment notes

Recommended pledge fields:

- campaign ID, tier ID, user ID if authenticated, wallet address
- amount, payment asset, chain ID
- transaction hash, block number, confirmation status
- status: `intent_created`, `submitted`, `confirmed`, `refund_available`,
  `refunded`, `released`, `failed`
- receipt metadata for UI and future agent/API consumption

Initial API:

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /shows/campaigns` | public | List active and recently resolved campaigns |
| `GET /shows/campaigns/:slug` | public | Read campaign detail, tiers, progress, and public pledge stats |
| `POST /shows/signals` | wallet/user | Create a fan-proposed demand signal without payout authority |
| `POST /shows/campaigns` | artist/admin | Create a draft escrow campaign |
| `PATCH /shows/campaigns/:id` | artist/admin | Update draft campaign terms before activation |
| `POST /shows/campaigns/:id/request-authority` | artist/admin | Attach artist-authority evidence for review |
| `PATCH /shows/campaigns/:id/authority` | admin/operator | Approve artist authority and bind beneficiary details |
| `POST /shows/campaigns/:id/reject-authority` | admin/operator | Reject insufficient or suspicious authority evidence |
| `POST /shows/campaigns/:id/revoke-authority` | admin/operator | Revoke authority before activation or through the emergency policy |
| `POST /shows/campaigns/:id/expire-authority` | admin/operator | Mark stale authority evidence as expired |
| `POST /shows/campaigns/:id/activate` | artist/admin/operator | Lock terms and activate escrow after authority approval |
| `POST /shows/campaigns/:id/pledges/intent` | wallet/user | Create a pledge intent and return contract call data |
| `POST /shows/pledges/:id/confirm` | wallet/user or indexer | Confirm a submitted pledge transaction |
| `POST /shows/pledges/:id/refund/confirm` | wallet/user or indexer | Confirm a claimed refund transaction without overwriting the original pledge transaction |
| `GET /shows/me/pledges` | authenticated | List the connected user's pledge receipts |
| `POST /shows/campaigns/:id/cancel` | admin/operator | Cancel and move pledges toward refund |
| `POST /shows/campaigns/:id/confirm-booking` | artist/admin/operator | Mark a funded campaign as booking-confirmed after evidence review |
| `POST /shows/campaigns/:id/confirm-fulfillment` | operator | Mark fulfillment evidence accepted and start release/dispute window |

Use the existing centralized frontend `API_BASE` from `web/src/lib/api.ts`.
Do not introduce per-file API base constants.

### Contract

Add a purpose-built `ShowCampaignEscrow` contract rather than reusing
`RevenueEscrow`. Revenue escrow is optimized for post-sale creator earnings;
Shows needs campaign thresholds, backer pledges, refunds, and booking release.

Minimum contract behavior:

- create campaign with immutable goal, deadline, booking deadline, payment
  asset, beneficiary, release policy, and optional minimum backers
- bind the beneficiary to an artist authority credential or evidence hash
- pledge to a campaign and tier
- expose campaign state for frontend/indexer reads
- allow refunds when a campaign fails or is cancelled
- allow refunds when booking is not confirmed by the booking deadline
- allow release only when funding, booking confirmation, fulfillment, and
  dispute-window rules are satisfied
- support optional capped deposit release after booking confirmation, disabled
  by default for the first beta
- emit events for all lifecycle transitions
- support pause/cancel controls for operational safety

Minimum events:

- `CampaignCreated`
- `CampaignActivated`
- `Pledged`
- `CampaignFunded`
- `CampaignFailed`
- `CampaignCancelled`
- `BookingConfirmed`
- `RefundAvailable`
- `RefundClaimed`
- `DepositReleased`
- `FulfillmentConfirmed`
- `FundsReleased`

Prefer a stablecoin payment asset for the production beta because ticket credit,
venue costs, and fan communication are easier to reason about in fiat terms.
Native ETH support can remain a follow-up path.

### Frontend

Replace placeholder UI states with working flows:

- tier selection instead of "Preview"
- pledge modal with wallet state, amount, network, and refund terms
- transaction pending/success/failure states
- "My pledge" panel for connected wallets
- refund CTA when refund is available
- public contract and transaction links
- operator-visible campaign status and booking confirmation state

The current visual design can remain. The important change is replacing seeded
data and future-tense copy with live state and actions.

## Delivery Slices

### Slice 1: Backend Truth

- Add Prisma models and migration. Initial campaign/pledge models are shipped;
  trust, artist-authority, release-policy, booking, refund, and fulfillment
  fields are now modeled.
- Add `ShowsModule`, service, controller, DTO validation, and integration tests.
  Public reads, signal creation, draft escrow creation, authority
  request/approval/rejection/revocation/expiry, activation, pledge intent,
  pledge confirmation, authenticated pledge receipt, cancellation, booking
  confirmation, and fulfillment confirmation APIs are implemented.
- Seed one production-beta campaign through a controlled seed/admin path.
- Keep frontend using seeded data until the API is stable.

### Slice 2: Escrow Contract

- Add `ShowCampaignEscrow.sol`. Contract and targeted unit tests are now
  implemented; deployment script/address wiring and frontend ABI integration
  remain follow-up work.
- Add unit tests for create, authority binding, pledge, funded threshold,
  cancel, failed deadline, missed booking deadline, refund, booking
  confirmation, optional deposit release, fulfillment confirmation, and final
  release.
- Add deployment script and deployment metadata updates.

### Slice 3: Frontend Live Read

- Replace `web/src/lib/shows.ts` seeded data with API-backed reads. `/shows`
  and `/shows/:slug` now read the backend first with seeded fallback.
- Move local-dev fallback data into test fixtures instead of production UI paths.
- Update the home campaign hero to use backend data.

### Slice 4: Pledge Flow

- Add wallet call execution on top of the implemented pledge intent API and
  detail-page intent UI. The detail page now builds the ERC-20 approval plus
  `ShowCampaignEscrow.pledge` smart-account operation when contract call data
  is available.
- Persist pledge receipts. Backend receipt persistence is implemented.
- Reconcile confirmations from contract events. Transaction-hash confirmation
  after wallet execution is implemented, but campaign progress remains
  indexer-owned.
- Add "My pledge" and refund states. The detail page now reads the connected
  wallet's latest pledge receipt for the current campaign and can claim escrow
  refunds when the campaign/pledge is refund-available.

### Slice 5: Operator Flow

- Add campaign creation and lifecycle management for approved artists/admins.
  Draft campaign creation with pledge tiers is implemented at `/shows/create`.
  Draft campaign editing with tier replacement is implemented at
  `/shows/:slug/edit`.
- Artist-authority review, booking confirmation, fulfillment confirmation, and
  cancellation APIs are implemented in the backend service/controller.
- Audit/event records for those campaign status changes are implemented.
- Admin/operator campaign detail controls are implemented for artist-authority
  approval, beneficiary binding, escrow activation, cancellation-to-refunds,
  booking confirmation, and fulfillment confirmation.
- Artist-owned campaign creation/editing UI remains follow-up work.

### Slice 6: Trust And Dispute Hardening

- Add public verification badges for fan-proposed, provisional, and
  artist-authorized campaigns.
- Add typed evidence bundles for artist authority, booking confirmation, and
  fulfillment confirmation.
- Route obvious impersonation to emergency pause/admin review.
- Route ambiguous disputes to the existing evidence/jury flow.

## GitHub Issues

These implementation slices are tracked as GitHub issues:

1. [#898 feat(shows): add campaign and pledge Prisma models](https://github.com/akoita/resonate/issues/898)
2. [#899 feat(shows): add public campaign API and integration tests](https://github.com/akoita/resonate/issues/899)
3. [#900 feat(contracts): add ShowCampaignEscrow contract](https://github.com/akoita/resonate/issues/900)
4. [#902 feat(shows): replace seeded Shows data with backend API reads](https://github.com/akoita/resonate/issues/902)
5. [#903 feat(shows): implement wallet pledge flow and receipts](https://github.com/akoita/resonate/issues/903)
6. [#904 feat(shows): implement refund and release lifecycle](https://github.com/akoita/resonate/issues/904)
7. [#905 feat(shows): add artist/admin campaign management](https://github.com/akoita/resonate/issues/905)
8. [#906 docs(shows): update feature catalog after production beta launch](https://github.com/akoita/resonate/issues/906)

## Verification

Backend:

- `cd backend && npm run test`
- `cd backend && npm run test:integration`
- targeted Shows integration tests for campaign lifecycle and pledge receipts

Contracts:

- `cd contracts && forge test`
- targeted escrow unit tests for pledge, refund, cancel, booking confirmation,
  and release

Frontend:

- `cd web && npm run lint`
- `cd web && npx playwright test web/tests/shows.spec.ts`
- add pledge-flow tests once wallet transaction mocking exists

Docs:

- Update `docs/features/README.md`.
- Update `docs/features/resonate_shows.md`.
- Keep this production plan accurate until all issue slices are complete, then
  collapse durable behavior back into the main feature page.
