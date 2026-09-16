---
title: "Legal documents"
status: draft
owner: "@akoita"
issue: 1769
---

# Legal documents

Source text for the four documents the application must publish before real
users reach it. Tracked by [#1769](https://github.com/akoita/resonate/issues/1769)
in Vision Sprint 23.

| Document | File | State |
| --- | --- | --- |
| Terms of Service | [terms-of-service.md](terms-of-service.md) | Draft — needs owner and qualified legal review |
| Privacy Policy | [privacy-policy.md](privacy-policy.md) | Draft — **also blocked on implementation**: #1770, #1771, #1772 |
| Refund policy | [refund-policy.md](refund-policy.md) | Draft — needs owner and qualified legal review; #1776 changes it when it lands |
| Mentions légales | not drafted | Blocked: the registered office is not cleared for publication |

## These are drafts, not advice

Every sentence here was written against what the code actually does — the
canonical fee and payout rules in [`../rfc/business-model.md`](../rfc/business-model.md),
the analytics envelope and retention rules in
[`../features/analytics_consent_retention_policy.md`](../features/analytics_consent_retention_policy.md),
and the escrow, marketplace and generation paths as implemented. That makes
them accurate about the system, which most templates are not.

It does not make them legally sufficient. They need review by someone
qualified in the operator's jurisdiction before publication. Each document
ends with the specific questions that review should answer.

**Accuracy is a moving target.** Two documents contain blocks marked as not
publishable, because they describe mechanisms the system does not yet have —
consent for product analytics, and erasure that reaches past the primary event
store. Those blocks are not drafting placeholders to be tidied away; they are
publication blockers that clear when the implementation lands. Re-verify every
factual claim against the code on the day these ship.

## Placeholders

Operator identity is not recorded in this repository, which is public. The
documents use placeholders, resolved from configuration at publication time:

| Placeholder | Meaning |
| --- | --- |
| `{{OPERATOR_LEGAL_NAME}}` | Registered company name |
| `{{OPERATOR_LEGAL_FORM}}` | Legal form |
| `{{OPERATOR_SHARE_CAPITAL}}` | Share capital |
| `{{OPERATOR_REGISTERED_OFFICE}}` | Registered office address |
| `{{OPERATOR_REGISTRY_ID}}` | Trade register number and registry city |
| `{{OPERATOR_CONTACT_EMAIL}}` | Published contact address |
| `{{OPERATOR_PUBLICATION_DIRECTOR}}` | Directeur de la publication |
| `{{HOSTING_PROVIDER}}` | Hosting provider's name and address |
| `{{SERVICE_URL}}` | Canonical public URL of the service |
| `{{EFFECTIVE_DATE}}` | Date the document takes effect |
| `{{MINIMUM_AGE}}` | Minimum age to hold an account |
| `{{GOVERNING_LAW}}` | Law governing the terms |
| `{{JURISDICTION}}` | Courts with jurisdiction |
| `{{SUPERVISORY_AUTHORITY}}` | Data protection authority to complain to |
| `{{RESPONSE_WINDOW}}` | Time we commit to answering a refund request |
| `{{ACCEPTED_PAYMENT_ASSETS}}` | Payment assets accepted on-chain in production |
| `{{CHAIN_NAME}}` | Network the payment assets settle on |
| `{{CREDIT_CURRENCY}}` | Currency generation credits are denominated in |

`{{HOSTING_PROVIDER}}` and `{{OPERATOR_PUBLICATION_DIRECTOR}}` are reserved for
the mentions légales document, which is not drafted yet; every other
placeholder is in use today.

This table is the complete registry. A resolver and an unresolved-placeholder
test should both be generated from it, so adding a placeholder to a document
without adding it here fails rather than ships. A document that reaches
publication with an unresolved placeholder is a bug.

## Language

Drafted in English, matching the application. If the first cohort includes
consumers in the operator's own jurisdiction, a translation may be legally
required rather than merely courteous — one of the review questions.
