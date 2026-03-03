---
title: "Phase 1: Payment Splitter Integration"
status: draft
owner: "@akoita"
issue: 24
---

# Phase 1: Payment Splitter Integration

## Goal

Integrate the on-chain PaymentSplitter flow for payouts.

## Actions

1. **Contract interface**
   - Define ABI and contract client.
   - Validate recipient addresses and split percentages.
2. **Payout configuration**
   - Store default split (artist/mixer/platform).
   - Allow overrides per track.
3. **Transaction handling**
   - Initiate split transfer on payment settlement.
   - Confirm on-chain success with retry logic.

## MVP Acceptance Criteria

- Payments trigger a splitter transaction.
- Splits are auditable by transaction hash.
- Failed tx retries are logged and visible.

## Dependencies

- On-chain contracts deployed to target L2.
- Payments service settlement flow.
