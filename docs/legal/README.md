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
| Privacy Policy | [privacy-policy.md](privacy-policy.md) | Draft — needs owner and qualified legal review |
| Refund policy | [refund-policy.md](refund-policy.md) | Draft — needs owner and qualified legal review |
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

Keep the placeholder list and the publication-time source in step. A document
that ships with an unresolved placeholder is a bug.

## Language

Drafted in English, matching the application. If the first cohort includes
consumers in the operator's own jurisdiction, a translation may be legally
required rather than merely courteous — one of the review questions.
