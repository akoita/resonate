---
title: "Refund policy"
status: draft
owner: "@akoita"
issue: 1769
---

# Refund policy

**Template — not any deployment's published terms.** Resonate is software
anyone can deploy; whoever runs an instance is its operator and owns the
documents their users read. Operator-specific values are placeholders resolved
from that deployment's configuration. Sections marked **⚖ jurisdiction-specific**
are shaped by European obligations and do not transfer elsewhere unaltered.
Requires review by someone qualified in the operator's jurisdiction. Not legal
advice. See [README](README.md).

Effective from {{EFFECTIVE_DATE}}. This policy forms part of the
[Terms of Service](terms-of-service.md).

Resonate's escrow was built refund-first. This document describes what the
system actually does today — including where it does less than you might
expect, and where a right of yours survives unless you choose to give it up at
checkout.

## Show campaign pledges

**If a campaign does not fund, you get everything back.** A pledge is held in a
smart contract and is never touched while the campaign is running.

A funded campaign does not pay out all at once. It moves through booking
confirmation, a deposit release to the artist, fulfilment of the show, and a
dispute window before the remaining funds are released. **Our fee is taken only
when money actually moves to the artist**, proportionally at each release —
never when you pledge, and never at all if nothing is ever released.

What you get back depends on where the campaign stopped:

| Situation | Your refund |
| --- | --- |
| The campaign does not reach its goal | **Your full pledge.** We deduct nothing. |
| The campaign is cancelled before any money has been released to the artist | **Your full pledge.** |
| The campaign is cancelled after a deposit has already been released to the artist — for example when a dispute is resolved during the dispute window | **Your proportional share of what is left in escrow.** This is less than your pledge, because part of the money has already been paid out. |

In the last case every backer is treated identically: each receives the same
proportion of the remaining balance as their pledge bore to the total. We take
no fee from that refund.

**You are told before you pledge.** Each campaign's locked terms fix the share
of the pledged money that can be released to the artist as a deposit once the
booking is confirmed; some campaigns have no deposit at all. When a campaign has
one, the campaign page and the pledge confirmation state it in plain words
before you commit — for example, with a 10% deposit, a refund after that deposit
is about 90% of your pledge. A campaign with no deposit shows no such warning,
because its refund is always your full pledge.

Cancellation is not automatic — it is an operator action, available while a
campaign can still be unwound, and it becomes unavailable once a fulfilled
campaign's dispute window has closed and the artist's payout has matured.

Refunds return the asset you pledged, to the wallet you pledged from.

**How you get it.** You claim your refund yourself once the campaign is
resolved. Claiming is an on-chain action.

**Network costs.** On-chain actions cost gas. Resonate may sponsor that cost
through its account-abstraction paymaster, up to a per-user sponsorship limit;
beyond that limit, or where sponsorship is not configured, the cost is paid
from your wallet. **We never take a fee out of a refund** — what the table
above says you are owed is what you receive.

**If something goes wrong.** Contact us at {{OPERATOR_CONTACT_EMAIL}} and we
will investigate. A refund is never sent to you automatically: you claim it
yourself. When a campaign's refunds open and you have not yet claimed, we
remind you in the app with a notice that links to the campaign page where you
claim — once when refunds open, again after 7 days and a last time after 30
days — and then we stop. A refund you never claim keeps waiting for you in the
escrow.

## What a pledge is not

A pledge supports a show. It is not a ticket, not a share of the show's
revenue, and not a claim against the artist. If a campaign funds and the show
then does not happen as described, that is a matter between you and the artist
— the escrow has already done its job by releasing funds the campaign earned.
We will help where we can, but we do not guarantee delivery of what an artist
promised on a campaign page.

## Marketplace purchases, licences and collectibles

> ⚖ **Jurisdiction-specific.** The consumer withdrawal right for digital
> content, and the conditions for ending it, are European. An operator
> elsewhere may owe a different right, or none.
>
> **Wording for legal review before production.** The delivery-consent
> sentences below, and the checkout text they describe, are a draft. They have
> not been reviewed by anyone qualified in the operator's jurisdiction.

Stems, licences, downloads and collectibles are digital content.

**If you are a consumer, you have a statutory right to withdraw from a distance
purchase within 14 days.** For digital content that right ends only if you
expressly ask for delivery to begin during the 14 days **and** acknowledge that
you lose the right by doing so, and the seller confirms that agreement to you
on a durable medium. Resonate's checkout asks for exactly that, before you pay,
for every stem, licence and collectible bought in the app:

- **Deliver now.** You ask for delivery as soon as your payment is confirmed
  and tick a box saying you understand you lose your right to withdraw from
  that purchase. Nothing is ticked or selected for you.
- **Wait 14 days.** You keep your right to withdraw. We hold the delivery
  (the download, the licence entitlement, the collectible) until 14 days after
  your purchase, tell you the date, and release it automatically. A paid
  collectible's edition is reserved for you at once, so nobody else can take
  it; it is delivered to you on that date.

Where delivery means something recorded on a blockchain that cannot be undone,
**only Deliver now is offered**, and the checkout says why.

We record your choice before payment starts (what you chose, the item, the
time, and the version of the wording you saw) and send you a confirmation in
your notices, which is also emailed if you have confirmed a contact address.
You can see the record in your notices and ask for a held delivery to be
released early at any time; doing so ends your right to withdraw from that
purchase.

**Held delivery is enforced where we can enforce it.** A purchase made on-chain
cannot be refused by us, so the point of control is the delivery of the
content: a download or licence is released only against a recorded Deliver-now
choice or after the 14 days have passed. A purchase with no recorded choice at
all (made outside the app, or by an AI agent's session key on your behalf) is treated as Wait 14 days.

**Not covered by this checkout.** Purchases made by software agents on their own
account over the machine-to-machine payment interface are sales to the agent's
operator, not to a consumer, and do not go through this step. Show campaign
pledges are not digital content and are governed by the section above.

Purchases made before this checkout step existed are delivered as before and are not held; this policy does not change what you could already download or use.

If you withdraw within the 14 days (having chosen Wait, or having never asked
for delivery), write to {{OPERATOR_CONTACT_EMAIL}}.

Beyond that period, these purchases are not refundable, with two exceptions:

- **We failed to deliver.** If you paid and did not receive what you bought, we
  refund in full.
- **What you received was not what was described.** Your statutory rights as a
  consumer apply and are not limited by this policy.

Rights disputes about a licensed work are handled through the dispute process,
which can result in a refund where a claim is upheld.

## Generation credits

Generation credits are prepaid and consumed when a generation **succeeds**. A
generation that fails should not cost you anything: where credits were already
debited, they are returned to your balance.

Terminal outcomes are recorded durably and refunds are idempotent. A failed
refund emits an alertable event and remains eligible for the reconciliation
job, which derives eligibility from durable outcomes rather than expiring job
state. Operators run reconciliation in dry-run mode first and review the
candidate set before applying corrections.

Unused credits are not exchangeable for money. If we discontinue the feature we
will say what happens to unused balances before the change takes effect —
subject to the same missing notice workflow the terms of service records in
section 11.

## Artist Pro subscription: closing, erasing or suspending an account

> **Wording for legal review before production** ([#2430](https://github.com/akoita/resonate/issues/2430)).
> The rules below are what the system does; the wording has not been reviewed
> by anyone qualified in the operator's jurisdiction.

- **You ask to close your account.** Renewal stops straight away, so you are
  not charged again while the 30-day closure window runs. Your plan stays on
  until the end of the period you already paid for. Cancelling the closure
  (by signing in) does not turn renewal back on; you can do that yourself from
  Manage billing.
- **Your account is erased, or closed by us.** Your subscription is cancelled
  immediately, before any of your data is erased. We do not refund the rest of
  the current period beyond what this policy already gives you (for example,
  withdrawing within 14 days of subscribing). Your data is not erased until
  the payment provider has confirmed the cancellation; until then we keep
  trying.
- **Your account is suspended.** We stop charging you while the suspension
  lasts: invoices that fall due during a suspension are voided, not collected
  later. Billing starts again when the suspension ends.
- **Your billing email.** When you confirm a new contact email, it becomes the
  email on your receipts.

## What we cannot reverse

A transaction confirmed on a blockchain is final. Where a refund is possible it
is executed as a **new** transaction, not by undoing the original. If you send
funds to the wrong address outside Resonate's flows, we cannot recover them.

## How to ask

Write to {{OPERATOR_CONTACT_EMAIL}} with the transaction, the campaign or the
purchase. We will answer within {{RESPONSE_WINDOW}}.

---

## Questions for legal review

1. **Immediate-delivery consent and the withdrawal right** ([#1776](https://github.com/akoita/resonate/issues/1776)).
   The checkout now collects prior express consent and the acknowledgement
   before payment, and confirms them by notice and email (Directive
   2011/83/EU art. 16(m) and 8(7)). Questions: (a) is the wording
   ("Deliver now" and its acknowledgement) sufficient and fairly presented in
   the operator's jurisdiction; (b) is a notice in the app, plus email only to
   buyers who confirmed an address, a durable medium, or must every buyer give
   an email address first; (c) the **scope**: stem and licence purchases,
   collectibles and credit top-ups are covered, machine-to-machine x402 / MCP
   purchases and Shows pledges are not. Confirm the exclusions hold, in
   particular that an AI agent buying with a session key for a consumer is not
   itself a consumer sale; (d) a purchase with no recorded choice is held
   14 days. Is that the right default, and is holding delivery of an
   already-paid on-chain purchase acceptable; (e) a late request for
   immediate delivery from a held purchase is treated as valid consent because
   delivery has not begun; (f) free collectible claims are not covered (no
   price); confirm that a free claim given for an account is not a contract for
   this purpose; (g) on-chain mints are only offered with Deliver now.
2. **Who is the seller?** If artists sell to buyers and the platform is an
   intermediary, the statutory refund obligations may sit with the artist while
   the refund mechanics sit with us. The two need to line up, and the terms of
   service carries the same open question.
3. **Campaign failure versus show failure.** The policy is clear that the
   escrow's obligation ends when a funded campaign releases. Whether consumer
   law in the operator's jurisdiction agrees — particularly where the campaign
   page reads like a promise of a performance — is worth an answer before
   campaigns run at scale.
4. **Partial refunds after a deposit release.** `claimRefund` pays a backer's
   pro-rata share of `totalPledged - totalReleased`, so a cancellation during
   the dispute window returns less than the pledge. The table above states that
   honestly, and the campaign page and pledge confirmation now disclose the
   resulting refund share before the pledge, computed from the campaign's
   locked deposit-release term
   ([#2150](https://github.com/akoita/resonate/issues/2150)). One question
   remains: whether a consumer can be left short this way when the cancellation
   was an operator decision.
5. **Response window.** `{{RESPONSE_WINDOW}}` is unset, and statutory refund
   deadlines may impose one regardless of what we choose. Note also that every
   route in this policy ends at a human reading {{OPERATOR_CONTACT_EMAIL}}, and
   #1595 still carries "support channel for real users" as an open box. A
   published response window with nobody staffing the inbox is a commitment
   that fails quietly.
6. **Artist Pro on closure, erasure and suspension**
   ([#2430](https://github.com/akoita/resonate/issues/2430)). Defaults chosen
   for review: (a) erasure and operator closure cancel at once with no
   proration credit beyond this policy, on the reasoning that a closed account
   cannot use the rest of the period; is a pro-rata refund owed in the
   operator's jurisdiction, in particular when the operator closed the account;
   (b) a self-service closure request stops renewal at once and leaves the paid
   period running; (c) suspension voids the invoices that fall due while it
   lasts, so a suspended person is not charged and is not back-billed; confirm
   that is acceptable, and whether a suspension for fraud should be treated
   differently.
7. **Gas costs.** Refunds are claimed by the backer (`claimRefund` on
   `ShowCampaignEscrow`), so the backer initiates the transaction. Sponsorship
   is conditional: the paymaster only sponsors when one is configured and only
   up to a per-user limit (`AA_SPONSOR_MAX_USD`, default 5). The draft
   describes exactly that, deliberately promising nothing firmer. Before
   publication, confirm what production will actually be configured to
   sponsor — a refund a user cannot afford to claim is not a refund.
