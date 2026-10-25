---
title: "Artist Pro billing (Stripe subscriptions)"
status: in-progress
owner: "@akoita"
---

# Artist Pro billing (Stripe subscriptions)

## Status

`in-progress`: slice 2 of Artist Pro (`docs/rfc/artist-pro.md` §6 and §10,
item 2; [#2407](https://github.com/akoita/resonate/issues/2407)), in **Stripe
test mode only**. A person can subscribe to Artist Pro monthly or yearly
through Stripe Checkout, manage it in the Stripe Customer Portal, and their
plan becomes `pro` with the source `stripe_subscription`. The entitlement
policy is still `entitlements/v1` (`everyone`), so **subscribing changes
nothing a person can do yet**.

What remains:

| Item | Where |
| --- | --- |
| Live charging (`BILLING_LIVE_MODE=true`) | Blocked on the RFC §8 gates: price sign-off (#1421), legal review of the consent wording and terms, tax and accounting set-up |
| The Stripe account, prices, Stripe Tax, webhook endpoint and secrets | The deployment half, in the private infrastructure repository |
| The monthly allowance granted on `invoice.paid` | [#2408](https://github.com/akoita/resonate/issues/2408) (the hook is marked in `stripe_webhook.service.ts`) |
| Pro gates on | [#2409](https://github.com/akoita/resonate/issues/2409) |
| Cancelling a live Stripe subscription when an account is closed or erased | Follow-up: erasure keeps the billing record but does not cancel at Stripe |

**Revenue line (ADR-BM-6):** line 2, Artist Pro, Phase 2. Price: $14.99 a
month, with an annual option at 2 months free (`docs/rfc/business-model.md`,
Layer 2b). The price itself lives in Stripe (price ids are configuration). No
fee or split changes; ADR-BM-4 is unaffected: Pro sells tools, never a share of
fans' money and never exposure.

## Audience

- **Artists, producers and DJs:** Settings › Usage & Billing › Plan.
- **Operators:** the configuration below; the deployment wiring is in the
  infrastructure repository.
- **Backend developers:** `backend/src/modules/billing/`.

## How it works

### Configuration

`BillingConfig` (`billing_config.ts`) reads `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ARTIST_PRO_MONTHLY`,
`STRIPE_PRICE_ARTIST_PRO_ANNUAL`, `BILLING_LIVE_MODE`, `STRIPE_AUTOMATIC_TAX`
and the first `FRONTEND_URL` entry (see `docs/deployment/environment.md`).
Billing is available only with all four Stripe variables set and a web
address known. A live key (`sk_live_…`, `rk_live_…`) is **refused** unless
`BILLING_LIVE_MODE=true`. When billing is not available, checkout, the portal
and the webhook answer `503 billing_unavailable`, the Stripe SDK is never
built, and the Plan section says subscriptions are not available yet.

The Stripe SDK (`stripe@23.0.0`, exact) is used only in `stripe_gateway.ts`,
behind a narrow `StripeGateway` interface that tests replace. The Stripe API
version is pinned there (`2026-09-30.endive`).

### Data

- `Subscription`: one row per person (`userId` unique) with their Stripe
  customer (unique) and current or last subscription (unique), `plan` `pro`,
  `interval` `month | year`, `status` (Stripe's statuses, including `paused`),
  the current period, `cancelAtPeriodEnd`, `pastDueSince` and
  `lastEventCreatedAt`. Created at checkout with status `incomplete`.
- `StripeEvent`: webhook idempotency (event id, type, received, processed).

Both are classified in the personal-data manifests: `Subscription` is exported
and retained on erasure as a billing record kept for accounting; `StripeEvent`
names nobody. See `docs/engineering/personal-data-inventory.md`.

### Routes

| Route | Auth | What it does |
| --- | --- | --- |
| `GET /billing/subscription` | JWT | `available`, `testMode`, `contactEmailConfirmed`, `hasBillingAccount`, the resolved `plan`, the subscription (status, interval, period end, cancel at period end, past-due date and grace end) and the subscription consent wording. Always answers, with `available: false` when billing is off |
| `POST /billing/subscription/checkout` | JWT | `{ interval, acknowledgedImmediateStart: true, textVersion }` → `{ url }` |
| `POST /billing/portal` | JWT | → `{ url }` of a Customer Portal session; `404 no_billing_account` without a customer |
| `POST /billing/stripe/webhook` | Stripe signature | The webhook below |

Checkout, in order:

1. `503 billing_unavailable` when billing is off.
2. `409 contact_email_required` without a **confirmed** contact address
   (#2169). It becomes the Stripe customer's billing email.
3. `409 already_subscribed` while a subscription is live.
4. `409 consent_text_outdated` for another wording version;
   `400 subscription_consent_required` without the explicit tick.
5. The consent is recorded on the `subscription` surface
   (`PurchaseConsent`, deliver now, no hold) **before** anything is created at
   Stripe, and confirmed in a notice (emailed to the contact address).
6. One Stripe customer per person (metadata `userId`), created once and
   reused.
7. A Checkout Session in subscription mode with `client_reference_id`, the
   price for the interval, the return URLs
   (`/settings?section=usage&billing=success|cancel`) and the consent id in
   the session and subscription metadata. Stripe Tax is added when
   `STRIPE_AUTOMATIC_TAX=true`. The consent is linked to the session id.

### The subscription consent

A subscription is a service, so the wording (`SUBSCRIPTION_CONSENT_WORDING`,
version `2026-10-25.subscription-draft-1`, for legal review before production)
asks the person to request an immediate start and acknowledge that withdrawing
within 14 days refunds only the unused time, less any allowance used. It is
served by `GET /billing/subscription`, so the web carries no copy. The generic
`POST /purchase-consents` refuses the `subscription` surface
(`400 use_subscription_checkout`).

### The webhook

`POST /billing/stripe/webhook` is public but authorised by the
`Stripe-Signature` header over the raw body (`rawBody` in `main.ts`): a missing,
wrong or stale signature is `400 invalid_signature`. It declares no `@Body()`
(see `docs/engineering/request-body-validation.md`), is throttled, and logs the
event id and type only.

- **Idempotent:** `StripeEvent` records each event id; an event already
  processed is acknowledged with `duplicate: true`. A failure leaves the row
  unprocessed and answers 500, so Stripe's retry applies it.
- **Ordered** (`subscription_state.ts`): an event created before the last
  applied one is skipped; for the same subscription, a period ending earlier
  than the stored one is skipped; a canceled or expired subscription is never
  reopened; another subscription of the same customer that ended (or is still
  `incomplete`) never replaces a live one.
- **Handled:** `checkout.session.completed`, `invoice.paid` and
  `invoice.payment_failed` re-read the subscription from Stripe and apply it;
  `customer.subscription.created|updated|deleted` apply the event's object.
  The first past-due event sets `pastDueSince`; it is kept while the
  subscription stays past due and cleared once it is paid. Live-mode events on
  a test deployment are acknowledged and ignored. A customer with no row is
  adopted only when the subscription metadata names a live account without a
  billing row.

### The plan

`EntitlementsService.resolvePlan` checks the subscription before grants
(`entitlements/subscription_plan.ts`): active or trialing gives `pro` until
the period end; past due gives `pro` for 7 days from `pastDueSince`; canceled
at period end gives `pro` until that end; anything else falls through to
grants. `GET /usage/summary` shows `source: "stripe_subscription"` and
`validUntil`.

### The web

`web/src/components/settings/PlanBilling.tsx`, under the plan chip in
Usage & Billing:

- **Free:** "Artist Pro — $14.99/month or yearly", Subscribe monthly and
  Subscribe yearly. Choosing one opens the consent step inline: the server
  wording, an unticked box, and Continue to secure checkout (enabled only once
  ticked), then a redirect to Stripe Checkout. Without a confirmed contact
  email, a link to the Email settings replaces the buttons.
- **Active:** status, renewal date and Manage billing (Customer Portal).
- **Canceled at period end:** the end date and Manage billing.
- **Past due:** "Your last payment failed — update your card", with the grace
  end date and the portal.
- **Unpaid:** Pro has ended; update the card in the portal.
- **Not available:** an informative line, no button.
- A **Test mode** note while only test keys are accepted.
- The `?billing=success|cancel|portal` return shows the outcome and re-reads
  the state (several times after a success, until the webhook lands).

User Guide: the Artist Pro subscription section of the AI generation article
(Usage & Billing) and the withdrawal article.

## How to test

- Unit: `billing_config.spec.ts` (live-key refusal, unconfigured, return
  URLs), `subscription_state.spec.ts` (mapping and ordering),
  `subscription_plan.spec.ts` (grace period and period-end math).
- HTTP: `billing.controller.http.spec.ts` (JWT, DTO `400`s, `503` when
  unconfigured, webhook signature valid / wrong secret / tampered / missing /
  stale, using the SDK's local signature check).
- Postgres: `billing.integration.spec.ts` (checkout email gate and consent
  before the session with a fake gateway, customer reuse, portal, state, each
  handled event, idempotency, retry after failure, ordering, adoption,
  live-mode events, erasure) and `usage-summary.integration.spec.ts` (the plan
  from a subscription).
- Web: `PlanBilling.test.tsx` (every plan state and the consent step) and
  `UsageBillingPanel.test.tsx`.
- Manually, in Stripe test mode: set the variables with test keys, forward
  webhooks with the Stripe CLI to `/billing/stripe/webhook`, and pay with a
  Stripe test card.

## References

- RFC: [`docs/rfc/artist-pro.md`](../rfc/artist-pro.md) §4–§6, §8 and §10.
- Business model: [`docs/rfc/business-model.md`](../rfc/business-model.md)
  (Layer 2b).
- Entitlements: [`entitlements.md`](entitlements.md).
- Consent: [`purchase_consent.md`](purchase_consent.md).
