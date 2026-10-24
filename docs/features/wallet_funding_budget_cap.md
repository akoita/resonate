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

## Amount rules (#2361)

`POST /wallet/fund` and `POST /wallet/budget` check types in the DTO and values
in `WalletService` (rejected with `400` before any read, write or event):

- `amountUsd` (fund) must be finite, greater than 0 and at most
  `MAX_WALLET_AMOUNT_USD` (10,000 per call).
- `monthlyCapUsd` (budget) must be finite, not negative and at most
  `MAX_WALLET_AMOUNT_USD`. `0` is allowed: it is the wallet default and means
  nothing may be spent (spend is denied once spent + amount exceeds the cap),
  not "no cap".

Tests: `wallet_amount_rules.spec.ts`, `wallet.controller.http.spec.ts`,
`wallet.integration.spec.ts`.
