---
title: "Artist Pro billing (Stripe subscriptions and credit packs)"
status: in-progress
owner: "@akoita"
---

# Artist Pro billing (Stripe subscriptions and credit packs)

## Status

`in-progress`: slice 2 of Artist Pro (`docs/rfc/artist-pro.md` §6 and §10,
item 2; [#2407](https://github.com/akoita/resonate/issues/2407)), in **Stripe
test mode only**. A person can subscribe to Artist Pro monthly or yearly
through Stripe Checkout, manage it in the Stripe Customer Portal, and their
plan becomes `pro` with the source `stripe_subscription`. The entitlement
policy is still `entitlements/v1` (`everyone`), so **subscribing changes
nothing a person can do yet**.

Slice 4 ([#1422](https://github.com/akoita/resonate/issues/1422), RFC §7)
adds **credit packs**: $5, $10 (the default) and $25 of generation credits,
bought through a one-time Stripe Checkout, also in test mode only. See
[Credit packs](#credit-packs-1422) below.

[#2496](https://github.com/akoita/resonate/issues/2496) adds **EUR prices with
VAT included** for buyers with an EU billing address, keeping USD (tax added at
checkout) elsewhere (RFC §9 decision #3). See
[Currencies and VAT](#currencies-and-vat-2496) below.

What remains:

| Item | Where |
| --- | --- |
| Live charging (`BILLING_LIVE_MODE=true`) | Blocked on the RFC §8 gates: price sign-off (#1421), legal review of the consent wording and terms, tax and accounting set-up |
| The Stripe account, prices, Stripe Tax, webhook endpoint and secrets | The deployment half, in the private infrastructure repository |
| Refunding money on withdrawal, less the allowance used | Needs live charging; the "allowance spent this period" value is ready (`GenerationAllowanceService.spentThisBillingPeriodCents`, #2408) |
| Pro gates on | [#2409](https://github.com/akoita/resonate/issues/2409) |
| Stripe settings on the scheduled erasure and retention jobs, so they can cancel, pause and resume at Stripe (#2430) | The deployment half, in the private infrastructure repository (with the Stripe keys) |
| Legal review of the closure, erasure and suspension wording (#2430) | `docs/legal/refund-policy.md`, question 6, before live charging |
| Credit pack prices in Stripe (`STRIPE_PRICE_CREDITS_5/10/25`) | The deployment half, in the private infrastructure repository |
| EUR currency options on the Stripe prices, then `STRIPE_EUR_PRICES=true` (#2496) | The deployment half, `resonate-iac#325`; until then every checkout stays USD |
| Auto-reload and USDC top-up of credits | [#2410](https://github.com/akoita/resonate/issues/2410) |
| Legal review of the credit refund policy and the delivery wording for credits | RFC §8, before live charging |

**Revenue line (ADR-BM-6):** line 2, Artist Pro, Phase 2. Price: $14.99 a
month before tax, or €14.99 with VAT included in the EU, with an annual option
at 2 months free ($149.90 / €149.90; `docs/rfc/business-model.md`, Layer 2b). The price itself lives in Stripe (price ids are configuration). No
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
`STRIPE_PRICE_ARTIST_PRO_ANNUAL`, `BILLING_LIVE_MODE`, `STRIPE_AUTOMATIC_TAX`,
`STRIPE_EUR_PRICES` (#2496) and the first `FRONTEND_URL` entry (see `docs/deployment/environment.md`).
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
- `StripeEvent`: webhook idempotency (event id, type, received, processed),
  pruned 90 days after processing (#2430).
- `Subscription` lifecycle columns (#2430): `endReason`, `endRequestedAt`,
  `endConfirmedAt`, `endAttempts`, `endLastError`, `collectionPausedAt`,
  `closureRequestId`, `billingEmailStale`.

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
   the session and subscription metadata, and an explicit `currency` (#2496;
   `usd` unless the body names an offered one, otherwise
   `409 currency_unavailable` before any consent is recorded). Stripe Tax is
   added when `STRIPE_AUTOMATIC_TAX=true`. The consent is linked to the
   session id.

### Account closure, erasure and suspension (#2430)

`SubscriptionLifecycleService` (`subscription_lifecycle.service.ts`, provided
with the config and gateway by `BillingCoreModule`) is what the account
lifecycle does at Stripe. Before #2492 Nest never injected it into its four
consumers (`AccountStatusService`, `ContactEmailService`, `MaintenanceService`,
`PrivacyController`). Their `SubscriptionLifecycleService | null = null`
parameters were recorded as `Object` in the decorator metadata, so the hooks
those consumers call did nothing. `billing_lifecycle_wiring.spec.ts` now pins
the wiring. Defaults (sprint 45, for owner and legal review):

| Account event | At Stripe | When it fails |
| --- | --- | --- |
| Erasure (the due-erasure run, `eraseAccount`) | Cancelled **immediately** (`prorate: false`, no final invoice), before anything is erased. The erasure does not run until Stripe answers with a canceled subscription | `SubscriptionCancellationPendingError`: the closure request stays `pending` with the reason, and the next due-erasure run retries |
| Operator closure (`POST /admin/accounts/:id/close`) | Cancelled immediately; the audit record carries `subscription: canceled \| pending \| none` | The closure still applies; the retention job retries the cancellation |
| Self-service closure request (`POST /privacy/account/closure`) | `cancel_at_period_end`, so no renewal is charged during the 30-day window. Signing in to cancel the closure does not undo it: the person renews in the Customer Portal | The retention job retries |
| Suspension (`POST /admin/accounts/:id/suspend`) | `pause_collection` with behavior `void` and `resumes_at` = the suspension's end when set; audit `billingCollection` | The retention job retries |
| Suspension lifted (or past its end) | `pause_collection` cleared | The retention job retries |
| Contact address confirmed (#2169) | The Stripe customer email is updated | `billingEmailStale` stays set; the retention job retries |

No extra pro-rata refund is made on cancellation; the refund policy
(`docs/legal/refund-policy.md`) says what a person gets back. Cancellation is
idempotent: a subscription already ended (or one Stripe no longer has) is
recorded as ended without a second cancel call, and the cancel call carries
the idempotency key `resonate-cancel-<subscription id>`. Every request is
audited on the row: `endReason` (`account_erasure | account_closure`),
`endRequestedAt`, `endConfirmedAt`, `endAttempts` and `endLastError` (a Stripe
error code, never a message). Logs carry the row id, the reason and the code.
A canceled row is final, so a late webhook never reopens it.

Without a Stripe gateway (billing not configured), an account with a live
subscription is never erased: the erasure stays pending. The scheduled jobs
(`run_due_erasures`, `run_retention_cleanup`) build the real gateway from the
same `BillingConfig` environment as the API.

**The retention job** (`POST /admin/retention/cleanup` and
`run_retention_cleanup`) runs `runBillingRetention` (`billing_retention.ts`)
after analytics retention:

- deletes `StripeEvent` rows processed more than 90 days ago (5,000 per run;
  unprocessed rows are kept as evidence of a failed delivery);
- `reconcile()`: cancels the live subscription of every erased or closed
  account and every requested cancellation not yet confirmed; pauses
  suspended accounts still collecting; resumes reinstated ones still paused;
  stops renewal for pending closures; pushes stale billing emails (100 rows
  per step per run).

The result is under `billing` (`stripeEventsPruned`, the reconcile counts,
`failed`). The scheduled job exits `1` when any billing step failed, so a
cancellation still owed is never a clean run.

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

- **Free:** "Artist Pro — $14.99/month or $149.90/year" (or the EUR prices,
  #2496), with the tax line for the currency, Subscribe monthly and Subscribe
  yearly. Choosing one opens the consent step inline: the server
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
- The page's **Refresh** re-reads the subscription along with the usage
  summary (#2494), so a change made elsewhere (a payment that failed, a
  cancellation in the portal) shows without a full reload.

User Guide: the Artist Pro subscription section of the AI generation article
(Usage & Billing) and the withdrawal article.

## Credit packs (#1422)

**Revenue line (ADR-BM-6):** line 2 (creator tools, metered generation),
Phase 2. Credits are a cost-plus-margin tool balance: they never touch a
fan→artist transaction, so the artist share (ADR-BM-4) is unchanged. Packs
from `docs/rfc/business-model.md` Layer 2b; no fee changes.

### Catalogue and configuration

`billing/credit_packs.ts` holds the catalogue on the server: `credits_5`
(500 cents), `credits_10` (1000, the default) and `credits_25` (2500), each
priced the same number of cents in USD (before tax) and EUR (VAT included). A
pack buys credits equal to the pack's price, whichever currency pays: €10 and
$10 both buy 1,000 credit cents. The client names a pack id and a currency,
nothing else: an amount in the request is ignored. Each pack's Stripe price id
comes from `STRIPE_PRICE_CREDITS_5`, `_10` and `_25`; buying credits is
available only when billing is (above) **and** all three are set, otherwise
the checkout answers `503 billing_unavailable` and the page says buying is not
available yet.

### Routes

| Route | Auth | What it does |
| --- | --- | --- |
| `GET /billing/credits` | JWT | `available`, `testMode`, `contactEmailConfirmed`, `currencies`, the packs (`prices` per currency, `creditsCents`) and `defaultPackId`, `heldCents`, the 10 most recent purchases (status, hold date, refunds, receipt reference) and the #1776 delivery wording. Releases any hold that has ended first |
| `POST /billing/credits/checkout` | JWT | `{ packId, currency?: "usd" \| "eur", consent: { choice: "deliver_now" \| "wait", acknowledgedWaiver, textVersion } }` → `{ url }` |
| `POST /billing/credits/purchases/:id/deliver-now` | JWT | `{ acknowledgedWaiver: true, textVersion }` → the state; releases a held purchase now |

Checkout, in order: `503` when unavailable; `409 contact_email_required`
without a confirmed contact email; the `credit_topup` consent recorded through
`PurchaseConsentService.record` (`409 consent_text_outdated`,
`400 waiver_acknowledgement_required` / `waiver_without_consent`, nothing
written on refusal) **before** anything is created at Stripe; the person's one
Stripe customer (shared with the subscription; created with the same
idempotency key); a Checkout Session in `payment` mode for the pack's price
in the requested `currency` (`usd` by default; `409 currency_unavailable`
before any consent when not offered), with metadata `purpose: credit_topup`, `userId`, `packId` and `consentId` on
the session and the payment intent, and return URLs
`/settings?section=usage&credits=success|cancel` (success also carries the
Checkout Session id). Stripe Tax as for subscriptions.

### Fulfilment

`checkout.session.completed` (and `checkout.session.async_payment_succeeded`)
for a `payment` session is handed to `CreditTopUpService.fulfilFromCheckout`;
the webhook's event-id idempotency and live-mode refusal apply as above.
`CreditTopUpService` is a required dependency of the webhook. Before #2492 it
was declared optional and was never injected, so every pack event was
acknowledged as `ignored_unavailable` without crediting anyone.
`stripe_webhook_wiring.integration.spec.ts` now boots `BillingModule` and
checks fulfilment and refunds through the real wiring.

- Only `payment_status: paid` is fulfilled (an asynchronous method waits for
  `async_payment_succeeded`).
- **Exactly once:** one `CreditTopUp` row per Checkout Session; the session id
  and the payment intent id are unique, and the ledger grant is written in the
  same transaction, so a replay, a second event or a concurrent delivery
  credits nothing more (`duplicate_checkout_session`).
- **Deliver now** (the consent asked for immediate delivery and acknowledged the
  waiver): a ledger `grant` with reason `top_up` and the payment intent id in
  `paymentRef`.
- **Wait** (or no consent found): status `held`, `heldUntil` = payment + 14
  days. The hold is released **lazily**: every balance read and every debit
  (`GenerationCreditsService.getBalance` / `debit`) and `GET /billing/credits`
  credit any purchase whose date has passed, through a conditional claim on
  the row, so concurrent reads credit it once. `releaseBasis` records
  `consent`, `hold_elapsed` or `deliver_now_later`. Deliver now later records a
  new `credit_topup` consent linked to the Checkout Session.
- The pack is credited only when Stripe reports its catalogue price in USD or
  EUR (`paidCurrency` in `credit_packs.ts`): a USD subtotal (before tax) equal
  to the price, or an EUR subtotal equal to the price. For EUR the check also
  accepts a subtotal that excludes the included VAT when subtotal plus tax and
  the total both equal the price, so it holds however Stripe reports inclusive
  tax. The row records the currency paid (`CreditTopUp.currency`).
- Anything else (another amount or currency) is recorded as `needs_review`,
  with the amount and currency Stripe reported, and credits nothing (logged as
  an error).
- A `purchase` notice (emailed to the contact address) states the amount, the
  delivery choice and the receipt reference.

**Expiry:** bought credits do not expire. The RFC promises at least 24 months;
the balance is one pooled number with no per-purchase lots, so no expiry date
is recorded.

### Refunds

A refund is issued in Stripe (for example after a withdrawal within 14 days for
a "wait" purchase). `charge.refunded` withdraws the refunded share of the
pack's credits (proportional to the money refunded over the money charged, in
the charge's currency, so USD and EUR behave alike; all of it on a full refund;
cumulative across partial refunds):

- credits already in the balance are taken back with a `reversal` row (reason
  `top_up_refund`, same `paymentRef`), **never below a zero balance**: credits
  already spent stay spent;
- a held purchase simply releases less, or nothing after a full refund.

Policy: unused credits are refundable according to the consent choice; with
"deliver now" the buyer gave up the right to withdraw for the credits used.
Refunds are an operator action in Stripe. **For legal review before live
charging.**

### Data

`CreditTopUp` (one row per Checkout Session): pack, price and its currency
(`usd` or `eur`; #2496), credits, session and
payment intent ids, consent id, delivery, status (`held | credited | refunded |
needs_review`), hold and release, credited, refunded and reversed amounts.
Exported, and retained on erasure as a billing record.
`GenerationCreditTransaction.paymentRef` names the payment behind a `top_up`
grant or its reversal.

### The web

`web/src/components/settings/BuyCredits.tsx`, under the balance in Usage &
Billing → Credits: the three packs with $10 (or €10) preselected, the tax line
for the currency, "Buy $10.00 of credits", then the inline #1776 delivery step (`DeliveryConsentStep`, nothing
selected, an unticked acknowledgement for deliver now) and Continue to secure
checkout, enabled only once the choice is complete. Held purchases show their
date and Deliver now (with an unticked acknowledgement); recent purchases show
status and receipt reference. The `?credits=success` return re-reads the state
and the balance until the purchase lands. A Test mode note, an email gate, and
an informative unavailable state with no button. The page's Refresh re-reads
the packs and purchases too (#2494).

## Currencies and VAT (#2496)

RFC §9 decision #3: prices include VAT in the EU and exclude it elsewhere,
with Stripe Tax. ADR-BM-6 line 2, Phase 2, test mode until the §8 gates clear;
no fee or split change.

**The rule** (`billing/billing_currency.ts`): a buyer whose billing address is
in the EU VAT area pays in **EUR, VAT included**; everyone else pays in
**USD, with any tax added at checkout**.

- The web asks "Where is your billing address?" in the Plan offer and in Buy
  credits, only when EUR is offered. The answer is preselected from the
  browser's time zone (a zone of the EU VAT area, Monaco included; the Canary
  Islands, Ceuta, Åland, Büsingen and the French overseas regions are outside
  it), can be changed, applies to both sections, and is remembered in that
  browser.
- The person sees every price in that currency, labelled "VAT included" (EUR)
  or "plus any applicable tax" (USD), and the checkout request names it.
  Checkout charges exactly that currency, so the price shown is the currency
  charged.
- Stripe Tax still taxes by the billing address Checkout collects. An EUR
  price keeps the same total whatever its tax share (none outside the EU); a
  USD price gets any tax on top.

**Prices** (display: `ARTIST_PRO_PRICES` in `billing.service.ts` and the pack
catalogue; Stripe's prices are what is charged): Artist Pro €14.99 a month and
€149.90 a year; credit packs €5, €10 and €25, at face value (the same credits
as $5, $10 and $25). VAT on EU sales comes out of the margin, which the #1421
pricing review accounts for.

**Rollout.** `STRIPE_EUR_PRICES=true` adds EUR to `currencies` in both state
routes. Set it only once every Stripe price (Artist Pro and the three packs)
carries a tax-inclusive EUR currency option: Checkout refuses a currency a
price does not have. Without it every checkout is USD, as before, and the
question is not shown. Fulfilment accepts EUR either way.

**Edge:** Stripe may refuse a subscription in a second currency for a customer
that already had one in the other; the checkout then fails with Stripe's error
and nothing is charged. Test mode only today; revisit with live charging.

## The monthly generation allowance (#2408)

Slice 3 of Artist Pro (`docs/rfc/artist-pro.md` §5,
`docs/rfc/business-model.md` Layer 2b). **Revenue line (ADR-BM-6):** line 2,
generation credits (ADR-BM-3), Phase 2. In Stripe test mode only, like the
rest of billing.

- **Size:** `ARTIST_PRO_MONTHLY_ALLOWANCE_CENTS`, default `300` ($3.00 at sell
  prices, about 30 Lyria clips); `0` turns grants off.
- **Grant:** `invoice.paid` calls `GenerationAllowanceService.grantForInvoice`
  (`backend/src/modules/credits/allowance.service.ts`) after the subscription
  row is updated. Only invoices that open a billing period grant
  (`subscription_create`, `subscription_cycle`, or a `subscription_update`
  with a full, non-proration line such as a switch to yearly); proration-only,
  manual and threshold invoices grant nothing. An invoice with
  `amount_paid = 0` (for example a 100% coupon) grants nothing either:
  free allowances come only through promo credits (ADR-BM-3). The allowance
  is spendable only while the subscription still gives Pro, so an immediate
  cancellation also stops future annual slices. The period comes from the
  invoice's own subscription line, so a late invoice still grants the month it
  paid. Idempotent per invoice (`stripeInvoiceId`, `sliceIndex`) and per month
  (`userId`, `periodStart`).
- **Annual plans:** the paid year is cut into twelve monthly slices with
  consecutive windows (`monthlySlices` in `credits/allowance.ts`, calendar
  months clamped like Stripe's anchors), all written when the invoice is paid.
  Each becomes spendable only in its own month. Writing them up front is
  deterministic and needs no job; a lazy grant on first use would make the row
  depend on when the person first generates.
- **Bucket:** `GenerationAllowanceGrant` (`amountCents`, `consumedCents`,
  `periodStart`, `expiresAt`, CHECK `0 <= consumedCents <= amountCents`), kept
  apart from the bought/promo balance. Debit and refund ledger rows carry
  `allowanceCents` and `allowanceGrantId`, so `consumedCents` reconciles
  against `GenerationCreditTransaction` and `balanceAfterCents` still means the
  bought/promo balance.
- **Spend order:** every debit (Lyria, remix draft, remix part) spends the live
  allowance first, then the balance, in one transaction under a per-person
  advisory lock; a charge can use both. A failed generation's refund goes back
  to the bucket it came from.
- **Expiry:** computed at read and debit time; no job, and nothing is written
  when a month ends. The live grant is the latest one started, while it is
  unexpired and the subscription still gives `pro`. A later grant (a plan
  change) ends the earlier one at its own start. Unused cents lapse
  (`amountCents - consumedCents`), are never carried over and never become
  bought credits; a refund to a grant whose month ended lapses with it.
  `/usage/summary` reports what lapsed when the previous month ended.
- **Never refunded in cash:** the withdrawal refund deducts the allowance
  already used. `GenerationAllowanceService.spentThisBillingPeriodCents(userId)`
  and `spentInBillingPeriodCents(subscriptionId, start, end)` return that value
  (net of refunds) for the subscription's current billing period. Nothing
  refunds money yet: there is no live charging.
- **Web:** Usage & Billing shows "$2.40 of $3.00 Pro allowance left · resets
  <date>" under the credit meter, with the spend order. The meters on Create
  and in Remix Studio count the allowance in what can be spent
  (`spendableCents`). The User Guide explains it in the Usage & Billing and
  Artist Pro subscription sections.

## Monthly reconciliation report (#2497)

**Revenue line (ADR-BM-6):** line 2, Phase 2. Reporting only: it changes no
fee and moves no money; ADR-BM-4 is unaffected.

The operator reconciles Stripe against the credit ledger every month from this
read-only report, and the accountant reviews it each quarter and at year end.
The procedure and the accounting treatment are operator documents kept with
the deployment, not here.

**Route:** `GET /admin/billing/reconciliation/:month` (JWT, role `admin` or
`operator`, recorded in the admin audit log as
`billing.reconciliation_viewed` with the month, format and section only).
`:month` is a UTC month, `YYYY-MM`; a future month answers
`400 month_in_future`, a malformed one `400 invalid_month`. The current month
can be read, with `complete: false`. `?format=json` (the default) returns the
whole report; `?format=csv&section=<section>` returns one section as a CSV
download (`400 section_required` without a section). Responses are
`Cache-Control: no-store`. Code: `backend/src/modules/billing/billing_reconciliation*.ts`.

**Admin page:** `/admin/billing-reconciliation` (sidebar › Billing
Reconciliation, admins and operators;
`web/src/app/admin/billing-reconciliation/`). Pick a month (the previous UTC
month by default; the current one is marked in progress). The control totals
per currency and the checks (each roll-forward balanced, ledger against
balances, `needs_review` count) are shown first, then the roll-forwards, the
allowance and the row tables. Each section has a CSV download, and the whole
report a JSON download. The User Guide covers it in "Finding people and opening
their record (operators)".

**Sections** (`reportVersion: billing-reconciliation/v1`):

| Section | What it holds |
| --- | --- |
| `purchases` | Credit packs paid in the month (`paidAt`), except `needs_review`: Checkout Session and payment intent ids, pack, the currency paid, the catalogue price in that currency (before tax in USD, VAT included in EUR), the amount charged with any tax (`amountTotalCents`, null on purchases before #2497), credits, delivery, and the credits that reached the balance in the month |
| `refunds` | Each pack refund applied in the month (`CreditTopUpRefund`, dated by the Stripe event): money refunded, credits withdrawn, credits taken back from the balance, credits already spent, and the reduction of a held purchase |
| `needs_review` | Packs paid in the month whose amount did not match the catalogue; nothing was credited. Each one needs a refund or an audited operator grant |
| `held_purchases` | Roll-forward, in credit cents, of credits paid for but not yet in the balance (the 14-day hold): opening, purchased, credited, withdrawn by refunds, closing |
| `credit_balance` | Roll-forward, in credit cents, of the pooled bought and free balance: opening, grants by reason (`top_up`, `signup_starter`, `credit_request`, `operator_grant`), spends and job refunds (the balance part only), `top_up_refund` reversals, closing |
| `allowance` | The Artist Pro allowance, apart: granted, used, returned and lapsed. It expires, has no cash value and is never a liability |
| `subscription_invoices` | Paid Artist Pro invoices in the month (`SubscriptionInvoice`): amount paid, amount before tax, currency, interval, billing reason and service period, so annual plans can be spread over their 12 months |
| `control_totals` | Per currency (USD and EUR are never added together): pack purchases, pack refunds, `needs_review` and invoice totals, and the net collected, to set against Stripe's balance report for the month. Amounts charged use `amountTotalCents`, so a USD purchase counts its tax and an EUR one its included VAT |

The JSON also carries an `integrity` check: the whole ledger's signed sum
against the cached balances, now.

**Bought-credit liability.** Bought and free credits share one balance with no
per-purchase lots, so the report does not split spends between them. It gives
the inputs: held purchases, the bought flows into and out of the balance, and
grants by reason. The accountant applies the allocation rule. Each roll-forward
states `computedClosingCents` beside the closing balance and `balanced` when
they agree.

**Reproducible:** every total comes from dates and append-only rows, never
from a purchase's current status, so two runs for a past month give the same
totals, and later refunds or spends do not change it.

**Personal data:** account ids are opaque user ids. The report holds no
emails, names, notes or consent ids. A free-text reason an operator typed for a
grant is reported only as `operator_grant`.

**Records added for it:**

- `CreditTopUpRefund`: one row per applied refund, written in the refund's
  transaction, exactly once per `charge.amount_refunded` value. Purchases
  refunded before #2497 got one backfilled row each (`backfilled: true`), dated
  by the purchase's last update.
- `SubscriptionInvoice`: one row per paid invoice, written by `invoice.paid`
  after the subscription row is updated (`backend/src/modules/billing/subscription_invoices.ts`).
  Invoices paid before #2497 are not backfilled; they are at Stripe.
- `CreditTopUp.amountTotalCents`: what the buyer was charged, tax included.

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
- Allowance (#2408): `generation-allowance.spec.ts` (slicing, which invoices
  grant, split) and `generation-allowance.integration.spec.ts` (grant through
  the webhook once per invoice, spend order, zero-balance block, refunds to the
  original bucket, expiry, subscription gate, annual slices, plan change,
  concurrent debits, registry parity, withdrawal helper, summary values).
- Web: `PlanBilling.test.tsx` (every plan state and the consent step) and
  `UsageBillingPanel.test.tsx`.
- Credit packs: `credit_packs.spec.ts` (catalogue, configuration, refunded
  share), `credit_topup.controller.http.spec.ts` (JWT, DTO `400`s, `503`),
  `credit_topup.integration.spec.ts` (email gate, consent before the session,
  client amount ignored, customer reuse, fulfilment once per session including
  concurrent deliveries, asynchronous payments, amount mismatch, live-mode
  events, the hold and its lazy and requested release, refunds floored at
  zero), and `BuyCredits.test.tsx`.
- Reconciliation report (#2497): `billing_reconciliation.spec.ts` (month
  parsing, CSV quoting and formula guard, reason labels),
  `billing_reconciliation.controller.http.spec.ts` (roles, `400`s, CSV
  headers, audit) and `billing_reconciliation.integration.spec.ts` (a seeded
  month with a purchase, a partial refund, a held release, spends, a
  `needs_review` purchase and monthly and annual invoices: exact totals per
  currency, balanced roll-forwards, no personal data, the same totals on a
  second run and after later activity). The refund and invoice records are
  covered in `credit_topup.integration.spec.ts` and the `invoice.paid` tests.
  The admin page: `reconciliation.test.ts` and `ReconciliationView.test.tsx`.
- Manually, in Stripe test mode: set the variables with test keys, forward
  webhooks with the Stripe CLI to `/billing/stripe/webhook`, and pay with a
  Stripe test card.

## References

- RFC: [`docs/rfc/artist-pro.md`](../rfc/artist-pro.md) §4–§8 and §10.
- Generation credits: [`generation_credits.md`](generation_credits.md).
- Business model: [`docs/rfc/business-model.md`](../rfc/business-model.md)
  (Layer 2b).
- Entitlements: [`entitlements.md`](entitlements.md).
- Consent: [`purchase_consent.md`](purchase_consent.md).
