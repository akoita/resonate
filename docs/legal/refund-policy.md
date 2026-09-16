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

Resonate's escrow was built refund-first. This document writes down the promise
the code already keeps.

## Show campaign pledges

**If a campaign does not fund, you get everything back.**

- A pledge is held in a smart contract until the campaign's deadline.
- If the campaign **fails to reach its goal, or is cancelled**, you are
  refunded **100%** of your pledge. We deduct nothing. There is no fee on a
  campaign that does not fund.
- If the campaign **funds successfully**, the money is released to the artist
  and our 6% fee is taken **at that moment** — never when you pledge.

Refunds return the same USDC you pledged, to the wallet you pledged from.

**How you get it.** You claim your refund yourself once the campaign is
resolved. Claiming is an on-chain action.

**Network costs.** On-chain actions cost gas. Resonate may sponsor that cost
through its account-abstraction paymaster, up to a per-user sponsorship limit;
beyond that limit, or where sponsorship is not configured, the cost is paid
from your wallet. **We never take anything out of the refund itself** — the
pledge comes back whole.

**If something goes wrong.** Our reconciliation process detects refunds that
should have been claimable and were not, and an operator can settle them. You
can also contact us.

## What a pledge is not

A pledge supports a show. It is not a ticket, not a share of the show's
revenue, and not a claim against the artist. If a campaign funds and the show
then does not happen as described, that is a matter between you and the artist
— the escrow has already done its job by releasing funds the campaign earned.
We will help where we can, but we do not guarantee delivery of what an artist
promised on a campaign page.

## Marketplace purchases, licences and collectibles

Stems, licences, downloads and collectibles are **digital content delivered
immediately**. Where you are a consumer with a statutory right to withdraw from
a distance purchase, you will be asked at checkout to consent to immediate
delivery and to acknowledge that doing so ends that right. If you do not give
that consent, delivery waits until the withdrawal period expires.

Once delivered, these purchases are not refundable, with two exceptions:

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

1. **The withdrawal-right waiver has to be collected, not assumed.** This draft
   describes a checkout that takes express consent to immediate delivery and an
   acknowledgement that the withdrawal right ends. **That flow does not exist in
   the product today.** Either it gets built before consumer sales open, or the
   statutory withdrawal period applies to every digital purchase and the policy
   above is wrong. This is the single largest gap between this document and the
   code.
2. **Who is the seller?** If artists sell to buyers and the platform is an
   intermediary, the statutory refund obligations may sit with the artist while
   the refund mechanics sit with us. The two need to line up, and the terms of
   service carries the same open question.
3. **Campaign failure versus show failure.** The policy is clear that the
   escrow's obligation ends when a funded campaign releases. Whether consumer
   law in the operator's jurisdiction agrees — particularly where the campaign
   page reads like a promise of a performance — is worth an answer before
   campaigns run at scale.
4. **Response window.** `{{RESPONSE_WINDOW}}` is unset, and statutory refund
   deadlines may impose one regardless of what we choose.
5. **Gas costs.** Refunds are claimed by the backer (`claimRefund` on
   `ShowCampaignEscrow`), so the backer initiates the transaction. Sponsorship
   is conditional: the paymaster only sponsors when one is configured and only
   up to a per-user limit (`AA_SPONSOR_MAX_USD`, default 5). The draft
   describes exactly that, deliberately promising nothing firmer. Before
   publication, confirm what production will actually be configured to
   sponsor — a refund a user cannot afford to claim is not a refund.
