---
title: "Legal Surface"
status: partial
owner: "@akoita"
issue: 1769
---

# Legal Surface

Resonate provides public, signed-out Terms, Privacy, Refund and Imprint routes.
The pages are generated from the reviewed templates in `docs/legal/`; the web
application does not carry a second copy of their text.

## Deployment boundary

This public repository contains only templates, placeholder names, rendering
code and fail-closed validation. Operator identity, registration, office,
contact, jurisdiction and hosting values are deployment-specific. The reference
deployment supplies them from private `resonate-iac` configuration during the
frontend build.

The canonical application origin remains technical configuration for links and
metadata. Legal copy does not render it, so provider-generated hostnames and
other deployment topology are not exposed as visible document content.

A normal development build renders conspicuous bracketed placeholders so an
open-source adopter can work on the UI without impersonating an operator. A
deployable build sets `LEGAL_PUBLISH_MODE=required`; any missing value, invalid
payment-asset configuration or unresolved placeholder fails the build.

## User surfaces

- `/terms`, `/privacy`, `/refunds` and `/imprint` are public static pages.
- The global footer links all four pages for signed-in and signed-out visitors.
- The sign-up surface links Terms, Privacy and Refunds before account creation.
- Privacy states the analytics envelope, consent gate, retention periods,
  export and erasure controls, and the permanent blockchain/IPFS limits.
- Refunds record the existing escrow behavior, including full refunds before
  any release, proportional refunds after a deposit release, fee-free refund
  amounts, and conditional gas sponsorship.

## Remaining gates

The feature stays `partial` until the private deployment configuration in
`resonate-iac#226` is applied and the owner approves each resolved document.
The legal classification review in #1774 and digital-content withdrawal flow in
#1776 remain explicit launch risks; this work does not decide either question.

Vision-neutral infrastructure (`vision:keep`). No ADR-BM-6 revenue line, fee,
split, price or payout behavior changes.
