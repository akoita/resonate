---
title: "Privacy Policy"
status: draft
owner: "@akoita"
issue: 1769
---

# Privacy Policy

**Draft — not yet in force. Requires owner approval and qualified legal review.**

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
generations and remix sessions. Every such event carries a privacy tier, the
legal basis it was collected under, and its lineage, so that we can honour a
later deletion request precisely rather than approximately.

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

## Your controls

From your settings you can:

- **turn optional product analytics off**, and keep using the service;
- **opt in or out of personalised yearly summaries**;
- **reset or adjust taste memory**, including hiding individual signals, and
  keep social taste matching off — it is off unless you turn it on;
- **export your data**, including your linked personal and pseudonymous facts,
  with a plain-language explanation of aggregate data that cannot be attributed
  back to you;
- **delete your data**, which removes or redacts rows linked to you across the
  raw store, the warehouse and derived facts.

## How long we keep things

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

A deletion request resolves you to every identifier we hold — your user id,
your pseudonymous actor id, wallet subjects, artist profile subjects, sessions,
and owned releases — writes a record that the deletion was requested, and then
removes the rows linked to those identifiers across the raw store, the
warehouse and the derived facts. Aggregates survive only where they stay
anonymous. Summaries built from deleted facts are revoked or rebuilt without
them. Later rebuilds read the deletion record first, so deleted rows do not
come back.

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

You can ask us for access to your data, correction, erasure, restriction,
portability, and you can object to processing based on legitimate interests.
You can withdraw consent at any time. Most of this you can do yourself from
settings; for anything else, write to {{OPERATOR_CONTACT_EMAIL}}.

You can also complain to your data protection authority. In the operator's
jurisdiction that is {{SUPERVISORY_AUTHORITY}}.

## Automated decisions

Recommendations, discovery ranking and AI DJ selections are automated. They
decide what you are offered, not anything with a legal or similarly significant
effect on you. You can reset the memory behind them, hide individual signals,
or turn optional analytics off entirely.

## Children

Resonate is not for people under {{MINIMUM_AGE}}. If we learn that we hold data
about someone below that age we delete it.

## Changes

We will post changes here and, where they matter, tell you before they take
effect.

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
