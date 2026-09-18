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

> **This table cannot be published as it stands.** Product analytics are
> currently recorded for any signed-in session with no prior choice offered and
> no persistent opt-out: `recordProductAnalytics` fires whenever a stored auth
> token exists. Consent under GDPR Article 7 requires a clear affirmative act,
> demonstrable afterwards, and withdrawal as easy as giving it — none of which
> exists yet, and a request by email after the fact cannot make consent the
> lawful basis retroactively.
>
> Before publication, one of two things must be true: the consent mechanism in
> [#1772](https://github.com/akoita/resonate/issues/1772) is live and enforced
> at ingest, or these rows name the basis that actually applies today and the
> collection is narrowed to match it. Choosing the second is a decision with
> product consequences, not a drafting choice.

## Your controls

**Your rights do not depend on a button existing.** Whatever the product offers
at any moment, you can exercise every right below by writing to
{{OPERATOR_CONTACT_EMAIL}}.

Being able to *receive* such a request is not the same as being able to
*fulfil* it. The table below says which controls exist; the sections that
follow say where the underlying mechanism is still incomplete. This document
must not go live while a row it describes cannot actually be honoured.

As of {{EFFECTIVE_DATE}}:

| Control | Status |
| --- | --- |
| Turning optional product analytics off | **Not yet available**, and there is no opt-out gate behind the scenes either — see the note under "Why, and on what basis". |
| Personalised yearly summaries | Not yet offered. |
| Resetting or adjusting taste memory | Partially available; social taste matching is off unless you turn it on. |
| Exporting your data | **Not yet available**, self-service or otherwise. |
| Deleting your data | **Not yet available** beyond the primary event store — see "When you delete". |

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

> **Most of this mechanism now exists; one gap still blocks publication.**
>
> Shipped: a person is resolved to every identifier their data is keyed by
> (#1785); erasure reaches the analytics warehouse and the facts derived from it
> (#1770); the erasure itself anonymises in place, rotates the account id — which
> for a wallet account *is* the wallet address — detaches an artist profile
> without deleting a catalogue other people bought from, and keeps only what
> retention obliges (#1795); and a person can ask for it themselves, from
> Settings, behind a signature, with 30 days to change their mind (#1771 slice
> 3b).
>
> **Still missing: nothing runs the scheduled erasures.**
> [#1797](https://github.com/akoita/resonate/issues/1797) — the engine and its
> endpoint exist, but no scheduler calls it, so a request reaches its due date
> and waits for an operator. There is also no operator runbook.
>
> So this section may not yet say a deletion completes on its own. Once #1797
> lands, the paragraphs below are accurate as written and this block comes off.
> Two related gaps do not block it but should be known:
> [#1796](https://github.com/akoita/resonate/issues/1796) (an unset salt makes
> analytics erasure depend on never rotating an auth secret) and
> [#1789](https://github.com/akoita/resonate/issues/1789) (retention has never
> run, so nothing has yet aged out of either store).

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

> **Not publishable while the mechanisms are missing.** The rights above exist
> regardless of what we have built, but the statutory deadline to satisfy them
> is not met by intending to. Access and portability have no export path;
> erasure reaches only the primary event store; withdrawal of consent for
> product analytics has nothing to withdraw from, because consent was never
> taken. Publishing this section is a commitment to a deadline the system
> cannot currently keep, which is a worse position than not publishing at all.
> It clears when [#1770](https://github.com/akoita/resonate/issues/1770),
> [#1771](https://github.com/akoita/resonate/issues/1771) and
> [#1772](https://github.com/akoita/resonate/issues/1772) land.

You can also complain to your data protection authority. In the operator's
jurisdiction that is {{SUPERVISORY_AUTHORITY}}.

## Automated decisions

Recommendations, discovery ranking and AI DJ selections are automated. They
decide what you are offered, not anything with a legal or similarly significant
effect on you.

Taste memory controls — resetting it, hiding individual signals — are partly
available today, and social taste matching stays off unless you turn it on.
Turning off the product analytics that feed these surfaces is **not** available;
see the controls table above.

## Children

Resonate is not for people under {{MINIMUM_AGE}}. We are obliged to delete data
we hold about someone below that age. Reports can be sent to
{{OPERATOR_CONTACT_EMAIL}}.

> **This case depends on the same missing erasure mechanism, and there is no
> response process behind the address.** Deleting a child's data completely
> requires exactly what "When you delete" says does not exist yet — identifier
> resolution, warehouse and derived-fact deletion, and rebuild tombstones — and
> no runbook or workflow turns a report into a completed deletion. Stating the
> obligation is right; implying that a report will be acted on today is not. It
> clears with
> [#1770](https://github.com/akoita/resonate/issues/1770) and
> [#1771](https://github.com/akoita/resonate/issues/1771).

## Changes

We will post changes here, and where they matter we will notify you before they
take effect.

> **No mechanism sends that notice.** Notifications are raised only by
> subscriptions and callers tied to particular domain events; nothing
> originates a policy-change notice, there is no broadcast or operator path,
> and there is no email or other outbound channel. The same gap is recorded in
> section 11 of the terms of service and must be closed in one place for both.

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
