---
title: "Phase 1: Wallet Funding & Budget Cap"
status: draft
owner: "@akoita"
issue: 22
---

# Phase 1: Wallet Funding & Budget Cap

## Goal

Enable wallet funding and enforce budget caps during playback sessions.

## Actions

1. **Funding flow**
   - Support USDC deposits into AA wallet.
   - Record funding events and balances.
2. **Budget cap persistence**
   - Store per-user monthly budget cap.
   - Reset cap monthly or via admin override.
3. **Spend tracking**
   - Deduct cost on each license grant/payment.
   - Emit spend events for analytics.
4. **Failure handling**
   - Stop session when cap is reached.
   - Surface error to client with remaining balance.

## MVP Acceptance Criteria

- Funding increases available balance.
- Sessions cannot exceed configured budget.
- Spend totals are reported per session.

## Dependencies

- Account abstraction wallet provider.
- Payments service integration.
