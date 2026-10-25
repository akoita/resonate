---
title: "Immediate-delivery consent for digital purchases"
status: in-progress
owner: "@akoita"
issue: 1776
---

# Immediate-delivery consent for digital purchases

**Status:** `in-progress` (the checkout step, server checkpoint and confirmation
ship together; the consent wording is a **draft for legal review before
production**, and on-chain mints have no checkout yet; credit packs use the
step since #1422, in Stripe test mode).

**Revenue line / phase (ADR-BM-6):** vision-neutral compliance infrastructure.
It changes when a buyer receives content, not what anyone is charged: no fee or
split changes, and ADR-BM-4 is untouched.

## Why

Under Directive 2011/83/EU a consumer can withdraw from a distance purchase
within 14 days. For digital content the right ends only if the consumer gave
prior express consent to delivery starting during the period, acknowledged that
this ends the right, and the trader confirmed that on a durable medium (art.
16(m), art. 8(7)). Until this feature the checkout collected none of the three,
so the refund policy stated that the right survived every digital purchase.

## What it does

- A **delivery step** in the checkout: *Deliver now* (needs an unticked
  acknowledgement box: "I lose my right to withdraw") or *Wait 14 days*.
  Nothing is pre-selected; payment stays disabled until a complete choice is
  made. Where delivery cannot be undone (an on-chain mint), only *Deliver now*
  is offered, with the reason.
- A durable **`PurchaseConsent`** record written *before* the payment starts
  (`POST /purchase-consents`), linked to the payment afterwards.
- A **server checkpoint**: delivery is released only against a matching
  consent or after 14 days from the purchase. No recorded choice means *wait*.
- A **confirmation**: a `purchase` platform notice (always emailed to a
  confirmed contact address; the category cannot be switched off), naming the
  item, the choice, the time and the wording version.
- The buyer sees the held state and its date in the library, can ask for early
  delivery from there (a later consent counts because delivery has not begun),
  and finds the confirmation in their notices.

## Scope (decided by the owner on #1776; flagged for legal review)

In scope: human checkouts for **stem and licence purchases** (on-chain buy,
browser x402 checkout, crate batch buy), **paid collectibles/drops**, and
**credit packs** (#1422, Stripe test mode).

Out of scope: **x402 agent / MCP purchases** (machine-to-machine, not consumer
sales; the agent route `GET /api/stems/:id/x402` has no signed-in buyer and is
not gated) and **Shows pledges** (not digital content). Free collectible claims
(no price) are not a purchase and are not covered.

## Checkout map

| Surface | Where the buyer pays | Where delivery happens (gated) |
| --- | --- | --- |
| Stem / licence, on-chain buy | `BuyModal` → `useBuyStem` (marketplace `buy`), indexed as `StemPurchase` | `POST /encryption/download`; licence activation in `RemixEligibilityService` (remix and commercial tiers); crate export |
| Stem, browser x402 (passkey wallet) | `BuyModal` → `payStemWithX402SmartAccount` | `POST /api/stems/:id/x402/smart-account` (202 `delivery_held` instead of audio, also on replay); then as above for the `StemPurchase` the settlement creates |
| Crate batch buy | `CrateQuotePanel` (one consent per stem) | as the on-chain buy |
| Paid collectible (Punchline) | `payMomentWithX402SmartAccount` | `POST /punchline/moments/:id/collect/smart-account`: the edition is allocated (scarcity) as `pending` and released lazily on read when a consent exists or 14 days have passed; set completion and the set reward wait for the release |
| On-chain collectible mint | none yet | `requireMintConsent` (see below) |
| Credit pack (#1422, Stripe test mode) | Usage & Billing → Credits → Buy → Stripe Checkout | `POST /billing/credits/checkout` records the `credit_topup` consent through `PurchaseConsentService.record` (the standard wording) before creating the Checkout Session, and links it to the session id. Deliver now credits on payment; wait holds the credits 14 days, released lazily on the next balance read or debit, or by Deliver now on the held purchase (a new consent linked to the same session). See [Artist Pro billing](artist_pro_billing.md#credit-packs-1422) |
| Artist Pro subscription (#2407, Stripe test mode) | Usage & Billing → Plan → Stripe Checkout | none held: a service that starts at once. `POST /billing/subscription/checkout` records the `subscription` consent (its own wording, `2026-10-25.subscription-draft-1`: start now, refund of unused time on withdrawal) before creating the Checkout Session; `POST /purchase-consents` refuses this surface. See [Artist Pro billing](artist_pro_billing.md) |

## Design

- **Record** (`PurchaseConsent`, migration `20261025140000_purchase_consent`):
  `userId`, `surface`, `subjectId`, server-resolved `subjectLabel`,
  `licenseType`, `deliveryKind`, `consented`, `acknowledgedWaiver`,
  `textVersion`, optional `transactionHash` / `purchaseRef` (+ `linkedAt`), and
  `deliveryAvailableAt` (indicative at creation, 14 days after the purchase once
  linked). Append-only; the newest consent that matches a purchase decides.
- **Matching** (`purchase_consent_delivery.ts`): a consent linked to a payment
  covers only that payment; an unlinked consent covers a purchase of the same
  item made up to 24 hours after it was recorded, or any time before delivery
  begins. The release date is always computed from the purchase time. A
  consent is bound to the purchase it releases (`linkConsentToPurchase`).
- **Grandfathering.** Purchases before `PURCHASE_CONSENT_EFFECTIVE_AT` (2026-10-25T00:00:00Z) predate the consent step and are delivered as before (decision basis `predates_consent`), so buyers keep the re-downloads and licences they already had.
- **Enforcement point.** An on-chain purchase can happen outside the app and
  cannot be refused by the server, so the enforceable point is **delivery**:
  the download, the licence entitlement, the collectible grant. The web also
  records the choice before it starts the payment, and will not start it
  without one.
- **Mints.** `requireMintConsent` refuses a mint without a fresh (24 hours),
  unused, deliver-now consent, and `POST /purchase-consents` refuses a
  *wait* choice on a mint surface. No consumer mint exists yet (Path B ERC-1155
  collectibles and show collectibles are deferred); the creator-side
  `contracts/mint-authorizations` flow mints the artist's own stem NFT and is
  not a consumer purchase, so it is not gated. Whoever builds a consumer mint
  must call `requireMintConsent` before preparing it.
- **Wording** lives on the server (`purchase_consent.constants.ts`,
  `GET /purchase-consents/wording`), versioned by `textVersion`; the web never
  carries its own copy. `reviewStatus` is `for_legal_review_before_production`.

## API

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/purchase-consents/wording` | public | the current wording and version |
| `POST` | `/purchase-consents` | JWT | record the choice; `400` for a missing acknowledgement, a waiver without consent, a *wait* on a mint, `409 consent_text_outdated` for an old version |
| `POST` | `/purchase-consents/:id/link` | JWT | attach `transactionHash` / `purchaseRef`; `404` for another person's record |
| `GET` | `/purchase-consents` | JWT | the caller's own records (the in-app proof of the choice) |

A held download answers `403 { code: "delivery_held", deliveryAvailableAt }`.

## Personal data

`PurchaseConsent` is exported (keyed by `userId`) and **retained** on erasure
with the purchase records it evidences (`StemPurchase`, `PunchlineCollectible`),
because it is the proof used to answer a withdrawal or refund claim; the user id
rotates with the cascade. It holds no wallet address and no free text. See
[personal data inventory](../engineering/personal-data-inventory.md) and the
manifests in `backend/src/modules/privacy/`.

## Known limits and open items

- No consumer mint checkout exists; it is covered by the record and the helper
  but has nothing to wire yet.
- Purchases by an AI DJ session key have no checkout step, so their downloads
  are held 14 days unless the buyer asks for them earlier.
- A held collectible's `X402Settlement` is recorded at once (the payment is
  final); only the grant waits.
- A held x402 receipt records `contentLength: 0` (the audio is not read).
- The legal wording, the notice-as-durable-medium question and the exclusions
  are listed in the refund policy's *Questions for legal review*.

## Tests

`purchase_consent_delivery.spec.ts`, `purchase_consent.controller.http.spec.ts`,
`purchase_consent.integration.spec.ts` (record, notice, link, download gate,
licence gate, mint), the held case in `punchline-collect-paid.integration.spec.ts`
and `x402.controller.spec.ts`; web: `deliveryConsent.test.ts`,
`DeliveryConsentStep.test.tsx`, `BuyModal.test.tsx`, `x402Pay.test.ts`.
`/help` article `immediate-delivery-and-withdrawal`.
