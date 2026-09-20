---
title: "Legal document templates"
status: draft
owner: "@akoita"
issue: 1769
---

# Legal document templates

Resonate is open-source software that anyone can deploy. **Whoever runs an
instance is the operator of that instance**, and the operator — not this
repository — is responsible for the legal documents their users read.

These files are a starting point for that operator. They are not any
deployment's published terms, and no deployment's identity, jurisdiction or
published text belongs in this repository.

| Document | File | Notes |
| --- | --- | --- |
| Terms of Service | [terms-of-service.md](terms-of-service.md) | Template |
| Privacy Policy | [privacy-policy.md](privacy-policy.md) | Template; several sections blocked on software capabilities — #1770, #1771, #1772 |
| Refund policy | [refund-policy.md](refund-policy.md) | Template; #1776 and #1778 change it when they land |
| Imprint / operator identity | [imprint.md](imprint.md) | Template; requirements are jurisdiction-specific |

## What lives where

| | Public repository (here) | Operator's private configuration |
| --- | --- | --- |
| The pages and how they render | ✅ | |
| These templates | ✅ | |
| Facts about what the software does and does not do | ✅ | |
| Operator identity, registration, address, VAT | | ✅ |
| Governing law, jurisdiction, supervisory authority, mediation body | | ✅ |
| The published documents a deployment actually serves | | ✅ |

For the reference deployment those values live in `resonate-iac` alongside the
rest of its deployment configuration, following the same rule as every other
deployment-specific value in `AGENTS.md`: centralized configuration, never a
source-code default.

## Why the software's own gaps stay here

Several sections carry blocks saying a claim cannot be published yet. Keep
those blocks only while the underlying capability is genuinely missing. The
account-closure workflow, consent gate, warehouse erasure and durable
generation-credit refund reconciliation have shipped; the templates now state
those behaviours plainly. Open legal or product gaps remain explicit, notably
the escrow-classification review (#1774), the digital-content withdrawal flow
(#1776), and the missing material-policy-change notice workflow.

Those are **facts about this software**, true for every deployment, and they
belong in the open where a prospective operator can read them before adopting
it. They are not one operator's compliance record. Each names the issue that
clears it; when the capability lands, the block goes and the template can state
the behaviour plainly.

## Jurisdiction

The templates are shaped by European obligations, because that is where the
reference deployment operates. Sections marked **⚖ jurisdiction-specific** do
not apply universally:

- imprint and operator-identification duties
- the consent standard for analytics, and what counts as valid refusal
- the consumer withdrawal right for digital content
- supervisory authority, consumer mediation, and online dispute resolution
- retention periods tied to local accounting and tax law

An operator elsewhere must have these reviewed against their own law rather
than assume the template transfers. An operator in the EU still needs them
reviewed — the templates are accurate about the software, which is not the same
as being legally sufficient.

**Nothing here is legal advice.** Each document ends with the questions its
review should answer.

## Grounded in the code

What makes these worth starting from is that every factual claim was written
against the implementation rather than from boilerplate: the canonical fee and
payout rules in [`../rfc/business-model.md`](../rfc/business-model.md), the
analytics envelope and retention rules in
[`../features/analytics_consent_retention_policy.md`](../features/analytics_consent_retention_policy.md),
and the escrow, marketplace, generation and passkey paths as built.

That accuracy decays. Re-verify every claim against the code before a
deployment publishes, and whenever behaviour changes.

## Placeholders

Operator-specific values appear as placeholders, resolved from configuration at
publication time. This table is the complete registry; a resolver and an
unresolved-placeholder check should both be generated from it, so adding a
placeholder without registering it fails rather than ships.

| Placeholder | Meaning |
| --- | --- |
| `{{OPERATOR_LEGAL_NAME}}` | Registered name of the operating entity |
| `{{OPERATOR_LEGAL_FORM}}` | Legal form |
| `{{OPERATOR_SHARE_CAPITAL}}` | Share capital, where the jurisdiction requires it |
| `{{OPERATOR_REGISTERED_OFFICE}}` | Registered office address |
| `{{OPERATOR_REGISTRY_ID}}` | Trade register number and registry |
| `{{OPERATOR_CONTACT_EMAIL}}` | Published contact address |
| `{{OPERATOR_PUBLICATION_DIRECTOR}}` | Publication director, where required |
| `{{HOSTING_PROVIDER}}` | Hosting provider's name and address, where required |
| `{{SERVICE_URL}}` | Canonical public URL of the deployment |
| `{{EFFECTIVE_DATE}}` | Date the document takes effect |
| `{{MINIMUM_AGE}}` | Minimum age to hold an account |
| `{{GOVERNING_LAW}}` | Law governing the terms |
| `{{JURISDICTION}}` | Courts with jurisdiction |
| `{{SUPERVISORY_AUTHORITY}}` | Data protection authority for complaints |
| `{{RESPONSE_WINDOW}}` | Time the operator commits to answering a refund request |
| `{{ACCEPTED_PAYMENT_ASSETS}}` | Payment assets accepted on-chain in that deployment |
| `{{CHAIN_NAME}}` | Network the payment assets settle on |
| `{{CREDIT_CURRENCY}}` | Currency generation credits are denominated in |

A document that reaches publication with an unresolved placeholder is a bug.

## Language

Drafted in English, matching the application. Where an operator's consumers are
entitled to their own language, a translation may be legally required rather
than merely courteous.
