# Security Best Practices Report — Issue #457

**Date:** 2026-04-07
**Scope:** Backend dispute notification flow and frontend websocket notification hook

## Executive Summary

The `#457` changes harden realtime dispute notifications by improving reconnect behavior and adding automated coverage around backend event delivery. No Critical or High findings were identified in the changed files.

## Findings

### SBPR-001: Wallet-room delivery depends on client-provided wallet join

**File:** `backend/src/modules/shared/events.gateway.ts`
**Severity:** Low

**Description:** Targeted `notification.new` delivery relies on the client joining its own wallet room by emitting `wallet:join`. This is sufficient for the current unauthenticated websocket design, but room membership is not server-authenticated.

**Recommendation:** Keep the current design for this issue. In a future hardening pass, bind websocket room joins to authenticated session identity rather than trusting a raw wallet string from the client.

---

### SBPR-002: Reconnect refetch closes missed-event gap

**File:** `web/src/hooks/useDisputeNotifications.ts`
**Severity:** Informational

**Description:** Before this issue, a disconnected client could miss `notification.new` events and retain stale unread state after reconnect. The updated hook now rejoins the wallet room and refetches notifications on socket `connect`, which closes the missed-event window for the current polling-plus-websocket design.

**Recommendation:** No further action required in this issue.

## Summary

| Severity      | Count |
| ------------- | ----- |
| Critical      | 0     |
| High          | 0     |
| Medium        | 0     |
| Low           | 1     |
| Informational | 1     |

## Scans Performed

- [x] Hardcoded secret scan on backend sources relevant to the change
- [x] Raw SQL scan on backend sources
- [x] XSS scan on frontend sources
- [x] Client-exposed secret pattern scan on frontend sources
- [x] Manual review of changed websocket and notification code paths
