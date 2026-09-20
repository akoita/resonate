---
title: "Privacy Policy"
status: draft
owner: "@akoita"
issue: 1769
---

# Privacy Policy

**Template — not any deployment's published terms.** Resonate is software
anyone can deploy; whoever runs an instance is its operator and owns the
documents their users read. Operator-specific values are placeholders resolved
from that deployment's configuration. Sections marked **⚖ jurisdiction-specific**
are shaped by European obligations and do not transfer elsewhere unaltered.
Requires review by someone qualified in the operator's jurisdiction. Not legal
advice. See [README](README.md).

Effective from {{EFFECTIVE_DATE}}.

## Who is responsible

{{OPERATOR_LEGAL_NAME}}, {{OPERATOR_REGISTERED_OFFICE}}, registered under
{{OPERATOR_REGISTRY_ID}}, is the controller of the personal data described
here. Contact: {{OPERATOR_CONTACT_EMAIL}}.

## What we collect

**Account.** Your email address, the date you joined, and the public part of
the passkey credential your device creates. We never receive your biometric
data — your device keeps it and only tells us that it verified you.

**Wallet.** Your smart account address and the on-chain activity associated
with it. See "What we cannot delete" below, because this is the part that is
permanent.

**What you do on Resonate.** Playback, skips, saves, playlists, searches,
recommendations shown and chosen, purchases, pledges, collects, uploads,
generations and remix sessions. Every such event records a **privacy tier**,
and events in the personal and sensitive tiers must also record the **legal
basis** they were collected under — the system rejects them otherwise. Events
in the pseudonymous tier may not carry one, and lineage references are recorded
where the emitting system supplies them rather than always.

Behaviour events are keyed to a **pseudonymous actor identifier**, derived with
a secret salt, rather than to your email. Artists see aggregate audience
figures; they never see your identifier or your raw activity.

**Content you create.** Uploads, community posts and messages, disputes you
raise, and the metadata attached to them.

**Payments and settlement.** Amounts, assets, counterparties, settlement status
and the transaction references needed to prove that money moved correctly.

**Support.** Whatever you send us when you contact us.

We do not store prompts, notification bodies, payment proofs, private wallet
material, exact IP addresses, or user-agent strings in analytics.

## Why, and on what basis

> ⚖ **Jurisdiction-specific.** The lawful-basis framing below is European. The
> standard for valid consent, and whether any of this processing needs consent
> at all, is set by the operator's own law.

| Purpose | Basis |
| --- | --- |
| Providing the service: accounts, playback, library, uploads | Performance of the contract |
| Executing pledges, purchases, licences and payouts | Performance of the contract |
| Keeping financial, rights and tax records | Legal obligation |
| Security, fraud prevention, abuse and rights enforcement | Legitimate interests |
| Optional product analytics and personalised recommendations | Your consent |
| Personalised yearly summaries | Your consent, separately given |

Where we rely on consent you can withdraw it at any time, and doing so is as
easy as giving it. Withdrawing consent does not affect processing that already
happened, and it does not switch off the operational, security, payment and
rights events we must keep.

Optional product analytics are collected only after an explicit choice. No
answer is treated as refusal. The browser suppresses optional events before
sending them and the authenticated ingest routes independently refuse them
unless the current consent version is granted. You can change the choice at
any time in Settings under Privacy; turning it off stops future optional
collection and applies the withdrawal policy to previously consented events.

## Your controls

**Your rights do not depend on a button existing.** Whatever the product offers
at any moment, you can exercise every right below by writing to
{{OPERATOR_CONTACT_EMAIL}}.

As of {{EFFECTIVE_DATE}}:

| Control | Status |
| --- | --- |
| Turning optional product analytics off | Available in Settings under Privacy; the browser and server both enforce the choice. |
| Personalised yearly summaries | Not yet offered. |
| Resetting or adjusting taste memory | Partially available; social taste matching is off unless you turn it on. |
| Exporting your data | Available in Settings under Privacy as a self-service download. |
| Deleting your data | Available in Settings under Privacy, with signature confirmation and a 30-day cancellation period. |

Each row must be re-checked against the product on the day this ships and
whenever a control becomes available. A privacy policy that claims a control
the product does not have is a false statement, not an aspiration.

## How long we keep things

> ⚖ **Jurisdiction-specific.** The retention of financial, rights and tax
> records is set by the operator's accounting and tax obligations. The software
> makes these configurable; the numbers below are the reference deployment's
> defaults, not a legal floor that transfers.

| Data | Retention |
| --- | --- |
| Sensitive raw events | 90 days |
| Personal raw events | 395 days |
| Pseudonymous raw events | 730 days |
| Warehouse raw and clean rows | The retention of the event they came from |
| Behaviour facts linked to you | 24 months |
| Financial, payout, royalty, dispute, settlement, rights and tax facts | 7–10 years, with personal fields minimised |
| Aggregate views that cannot re-identify you | Kept while useful |
| Quarantined records | 30 days (personal or sensitive), 90 days (pseudonymous) |
| Deletion and consent records | Kept indefinitely, so we can prove a deletion happened |

Account data is kept while your account exists, then deleted as described
below.

## When you delete

A deletion request writes a record that the deletion was asked for, and then
removes or redacts the analytics rows linked to the identifier it is given.
Financial and audit records are redacted rather than deleted, as described
below.

When you ask us to delete your account, we resolve you to every identifier your
data is held under — not just your account id, but the wallet addresses, the
artist profile and the pseudonymous identifier your activity is recorded against
— and record the request. Nothing happens for 30 days, and signing in during
that time cancels it.

After that we remove or redact your data across the primary store, the analytics
warehouse and the facts derived from it, keep aggregates only where they remain
anonymous, and read the deletion record on every later rebuild so deleted rows
do not come back. Your account id is replaced, because for a wallet account that
id is your wallet address. If you released music, it stops streaming; people who
bought something from you keep it.

**Financial and audit records are redacted rather than deleted.** We keep what
accounting, rights and tax law require us to keep — the fact, the date, the
amount, the status — with personal fields minimised.

## What we cannot delete

Two parts of Resonate are permanent and public, and no request to us can change
that:

- **The blockchain.** Transactions on Base — pledges, purchases, settlements,
  mints — are public, permanent, and outside anyone's control, including ours.
  Your wallet address and its history stay visible.
- **IPFS.** Content published to IPFS is addressed by its contents and may be
  stored by anyone. We can stop serving it; we cannot make other people forget
  it.

Consider this before publishing anything you may later want withdrawn.

## Who else processes your data

We use service providers who process data on our instructions. At publication
this list will name each provider, what it does, and where it processes:
cloud infrastructure and the data warehouse, AI generation and analysis, the
account-abstraction bundler and smart-account infrastructure, IPFS storage,
human-verification, audio processing, and observability tooling.

Some are established outside the European Economic Area. Where that is so,
transfers rely on the European Commission's standard contractual clauses or
another lawful mechanism, and the list will say which.

Artists receive aggregate statistics about their own catalogue and audience.
They do not receive your identity or your raw activity.

## Your rights

You have the right to ask us for access to your data, correction, erasure,
restriction and portability, and to object to processing based on legitimate
interests. You can withdraw consent at any time. Write to
{{OPERATOR_CONTACT_EMAIL}}. Where a self-service control exists you can also
use it — see the table above for which ones are live.

You can also complain to your data protection authority. In the operator's
jurisdiction that is {{SUPERVISORY_AUTHORITY}}.

## Automated decisions

Recommendations, discovery ranking and AI DJ selections are automated. They
decide what you are offered, not anything with a legal or similarly significant
effect on you.

Taste memory controls — resetting it, hiding individual signals — are partly
available today, and social taste matching stays off unless you turn it on.
Turning off product analytics stops future optional analytics collection; it
does not remove operational records or independently chosen taste settings.

## Children

Resonate is not for people under {{MINIMUM_AGE}}. We are obliged to delete data
we hold about someone below that age. Reports can be sent to
{{OPERATOR_CONTACT_EMAIL}}.

## Changes

Changes are posted here with a new effective date. An operator must not make a
change that legally requires direct notice until it has a channel capable of
delivering that notice.

---

## Questions for legal review

1. **The processor list is a promise this document has to keep.** It is written
   as "will name each provider" because several providers are currently
   staging-only or feature-gated. Publication must replace it with the real
   list, verified against deployment configuration, with transfer mechanisms
   named. An inaccurate processor list is worse than none.
2. **Legitimate-interest balancing.** Security, fraud and rights enforcement
   are asserted as legitimate interests without a documented balancing test.
   One should exist before publication.
3. **Retention beyond deletion.** The 7–10 year window for financial and audit
   facts is taken from the internal policy. Whether that matches the operator's
   actual accounting and tax obligations needs confirming, since it is the main
   exception a user will notice.
4. **Blockchain and erasure.** Section "What we cannot delete" states the
   position plainly. Whether stating it is sufficient, or whether the design
   itself needs to change — for example by keeping identifiers off-chain —
   is a question this draft cannot settle.
5. **Consent mechanics.** Regulators in the operator's jurisdiction are
   specific about how consent is collected: refusing must be as easy as
   accepting, nothing pre-ticked, and the choice must be revisitable. Whether
   any of the current measurement qualifies for an audience-measurement
   exemption is worth checking, because it would simplify the consent surface
   considerably.
6. **Supervisory authority and DPO.** `{{SUPERVISORY_AUTHORITY}}` must be
   named. Whether the processing requires a formal data protection officer, or
   a record of processing activities in the statutory form, is unanswered.
7. **Age.** `{{MINIMUM_AGE}}` has to agree with the terms of service, and the
   age at which someone can consent to data processing may differ from the age
   at which they can spend money.
