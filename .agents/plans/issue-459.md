# Issue 459 Plan

## Goal

Expose the existing dispute notification UX in normal authenticated flows so users can
see realtime unread counts, open their notification center, and manage preferences.

## Scope

- Mount `NotificationBell` in the main authenticated app shell/header without breaking
  unauthenticated rendering.
- Add a visible entry point for `NotificationPreferences` in the settings UI.
- Verify the existing notification list and read/read-all flows remain accessible once
  mounted.
- Preserve current wallet-gated behavior for notification fetching and socket room
  subscription.

## Working Assumptions

- The backend notification endpoints and WebSocket events are already functional, so
  this issue is primarily a frontend integration task.
- The current topbar and settings layout can absorb the new entry points without a
  broader navigation redesign.
- Follow-up hardening and automated coverage for realtime dispute notifications remain
  tracked separately in issue `#457`.

## Planned Changes

1. Update the authenticated topbar/app shell to render `NotificationBell` alongside the
   existing wallet and playlist actions.
2. Extend the settings page with a notification preferences section that mounts
   `NotificationPreferences`.
3. Sanity-check wallet-dependent rendering paths so disconnected users do not see broken
   controls or trigger notification fetches.

## Verification

- `cd web && npm run lint`
- Manual UI check for desktop/mobile header layout and settings access
- Manual notification flow check: unread badge, mark read, mark all read
