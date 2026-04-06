# Issue #457 Plan: Verify End-to-End Dispute Notifications

## Goal

Close the reliability gap in the dispute notification flow by verifying persistence, websocket delivery, frontend subscription behavior, and dashboard refresh coverage for dispute lifecycle events.

## Scope

1. Backend notification flow
   - Inspect the current event bus -> notification persistence -> websocket emit path for:
     - `dispute_filed`
     - `dispute_resolved`
     - `dispute_appealed`
   - Confirm recipient selection and unread/read behavior.

2. Frontend realtime behavior
   - Verify wallet-room subscription and reconnect behavior in the dispute notification hook.
   - Verify `DisputeDashboard` responds to dispute status events and refreshes reliably.

3. Automated coverage
   - Add or update backend tests for notification creation and event emission.
   - Add or update frontend tests for dashboard refresh and notification subscription behavior where practical.

## Planned Changes

### Backend

- Review [notification.service.ts](/home/koita/dev/web3/resonate/backend/src/modules/notifications/notification.service.ts)
- Review [events.gateway.ts](/home/koita/dev/web3/resonate/backend/src/modules/shared/events.gateway.ts)
- Review [metadata.controller.ts](/home/koita/dev/web3/resonate/backend/src/modules/contracts/metadata.controller.ts)
- Extend [notification.service.spec.ts](/home/koita/dev/web3/resonate/backend/src/modules/notifications/notification.service.spec.ts) or adjacent tests to cover the acceptance criteria event paths.

### Frontend

- Review [useDisputeNotifications.ts](/home/koita/dev/web3/resonate/web/src/hooks/useDisputeNotifications.ts)
- Review [DisputeDashboard.tsx](/home/koita/dev/web3/resonate/web/src/components/disputes/DisputeDashboard.tsx)
- Add focused test coverage for websocket-driven refresh behavior if the current test harness supports it cleanly.

## Verification Plan

- Run targeted backend tests for notification flows.
- Run targeted frontend tests if added.
- Run lint in the touched package(s).

## Risks

- Realtime coverage may span backend gateway behavior and frontend socket lifecycle, so some logic may need refactoring to become testable without brittle integration tests.
- There may already be partial behavior in place but with recipient or event-name mismatches; I’ll prioritize fixing the actual contract between backend emits and frontend listeners.
