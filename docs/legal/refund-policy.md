---
title: "Refund policy"
status: draft
owner: "@akoita"
issue: 1769
---

# Refund policy

**Draft — not yet in force. Requires owner approval and qualified legal review.**

Effective from {{EFFECTIVE_DATE}}. This policy forms part of the
[Terms of Service](terms-of-service.md).

Resonate's escrow was built refund-first. This document describes what the
system actually does today — including where it does less than you might
expect, and where a right of yours survives because we have not yet built the
step that would end it.

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
will investigate. We do not currently monitor for refunds that are claimable
but unclaimed, so a refund you never claim will sit waiting rather than being
sent to you.

## What a pledge is not

A pledge supports a show. It is not a ticket, not a share of the show's
revenue, and not a claim against the artist. If a campaign funds and the show
then does not happen as described, that is a matter between you and the artist
— the escrow has already done its job by releasing funds the campaign earned.
We will help where we can, but we do not guarantee delivery of what an artist
promised on a campaign page.

## Marketplace purchases, licences and collectibles

Stems, licences, downloads and collectibles are digital content delivered
immediately.

**If you are a consumer, you have a statutory right to withdraw from a distance
purchase, and you still have it here.** That right can only be given up if you
expressly consent to immediate delivery and acknowledge that you are losing it,
and Resonate's checkout does not currently ask you to do either. Until it does,
the withdrawal period applies to your digital purchases, and you may withdraw
within it by writing to {{OPERATOR_CONTACT_EMAIL}}.

Beyond that period, these purchases are not refundable, with two exceptions:

- **We failed to deliver.** If you paid and did not receive what you bought, we
  refund in full.
- **What you received was not what was described.** Your statutory rights as a
  consumer apply and are not limited by this policy.

Rights disputes about a licensed work are handled through the dispute process,
which can result in a refund where a claim is upheld.

## Generation credits

Generation credits are prepaid and consumed when a generation **succeeds**. A
generation that fails does not consume credits; where credits were already
debited they are returned to your balance automatically.

Unused credits are not exchangeable for money. If we discontinue the feature we
will say what happens to unused balances before the change takes effect.

## What we cannot reverse

A transaction confirmed on a blockchain is final. Where a refund is possible it
is executed as a **new** transaction, not by undoing the original. If you send
funds to the wrong address outside Resonate's flows, we cannot recover them.

## How to ask

Write to {{OPERATOR_CONTACT_EMAIL}} with the transaction, the campaign or the
purchase. We will answer within {{RESPONSE_WINDOW}}.

---

## Questions for legal review

1. **The withdrawal right currently survives every digital purchase.** Losing
   it requires prior express consent, an acknowledgement, and durable
   confirmation of that agreement (Directive 2011/83/EU). Checkout collects
   none of the three, so this policy now says the right applies. Building the
   waiver flow is tracked in [#1776](https://github.com/akoita/resonate/issues/1776); until it ships and is
   tested, consumer sales operate with a live withdrawal period, and the
   operational cost of honouring it is real.
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
   honestly, but two questions follow: whether a consumer can be left short
   this way when the cancellation was an operator decision, and whether the
   campaign page discloses the possibility **before** the pledge rather than
   only in this policy. If not, the disclosure belongs in the pledge flow.
5. **Response window.** `{{RESPONSE_WINDOW}}` is unset, and statutory refund
   deadlines may impose one regardless of what we choose.
6. **Gas costs.** Refunds are claimed by the backer (`claimRefund` on
   `ShowCampaignEscrow`), so the backer initiates the transaction. Sponsorship
   is conditional: the paymaster only sponsors when one is configured and only
   up to a per-user limit (`AA_SPONSOR_MAX_USD`, default 5). The draft
   describes exactly that, deliberately promising nothing firmer. Before
   publication, confirm what production will actually be configured to
   sponsor — a refund a user cannot afford to claim is not a refund.
