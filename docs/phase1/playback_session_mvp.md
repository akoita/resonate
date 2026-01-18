---
title: "Phase 1: Playback Session MVP"
status: draft
owner: "@akoita"
issue: 23
---

# Phase 1: Playback Session MVP

## Goal

Implement a minimal session flow that plays tracks and triggers micro-payments.

## Actions

1. **Session API**
   - `POST /sessions/start` with preferences and budget.
   - `POST /sessions/stop` to close session.
2. **Track selection (MVP)**
   - Use a static playlist from catalog.
   - Record selected tracks in session log.
3. **License grant & payment**
   - Grant license per track play.
   - Initiate payment and confirm settlement.
4. **Spend summary**
   - Return session totals, spend breakdown, and remaining budget.

## MVP Acceptance Criteria

- Sessions can be started and stopped reliably.
- Each play triggers a recorded license and payment intent.
- Budget caps enforced during playback.

## Dependencies

- Wallet funding and budget cap.
- Catalog indexing.
- Payment splitter integration.
