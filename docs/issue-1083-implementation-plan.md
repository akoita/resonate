# Issue #1083 Implementation Plan

## Issue

- GitHub: https://github.com/akoita/resonate/issues/1083
- Title: AI-native moderation assist (advisory hints, no auto-enforcement)
- Branch: `feat/1083-ai-native-moderation-assist`

## Goal

Add moderator-facing assistive context to `/admin/community/moderation` so admins can triage reported community messages faster without changing the human review boundary.

The assist must provide summaries and risk hints only. It must not delete messages, ban members, pause rooms, archive rooms, resolve reports, or silently change report state.

## Current System Boundary

- Backend admin route:
  - `GET /admin/community/moderation/reports`
  - `PATCH /admin/community/moderation/reports/:reportId`
- Backend implementation:
  - `MaintenanceController` delegates to `MaintenanceService`.
  - `MaintenanceService` delegates to `CommunityRoomsService`.
  - `CommunityRoomsService.getModerationQueue` returns privacy-bounded report DTOs.
  - `CommunityRoomsService.resolveModerationReport` is the only path that applies admin actions.
- Frontend implementation:
  - `/admin/community/moderation` loads the queue and passes it to `CommunityModerationDashboard`.
  - `CommunityModerationDashboard` renders report context and explicit action buttons guarded by `ConfirmDialog`.

## Proposed Slice

1. Add an advisory moderation-assist object to each moderation report DTO.
   - Include a short summary.
   - Include severity and likelihood buckets for triage.
   - Include bounded reason codes or review focus items.
   - Include an explicit advisory disclaimer in the DTO.

2. Generate the assist from the existing moderation DTO surface only.
   - Allowed inputs: report reason, room title/type/status, message preview/status/type, report counts, membership status counts.
   - Disallowed inputs: emails, wallet addresses, raw access-policy payloads, private listener data, full unbounded thread history.

3. Keep enforcement isolated.
   - The assist generator must be pure/read-only.
   - `getModerationQueue` may include assist data.
   - `resolveModerationReport` remains the only method that mutates report, message, membership, or room state.
   - No auto-resolution or hidden moderation path is added.

4. Render the assist in the admin dashboard.
   - Show summary and risk hint near each report.
   - Use neutral copy that frames output as advisory.
   - Keep existing action buttons and confirmation flow unchanged.

5. Update durable docs.
   - Update `docs/features/listener_community_network.md`.
   - Update `docs/features/README.md` if the feature catalog summary needs the new capability called out.
   - Mention the change-impact checklist sections in the PR summary when finishing.

## Testing Plan

- Backend integration coverage in `backend/src/tests/community_rooms.integration.spec.ts`:
  - moderation reports include advisory assist fields;
  - assist uses bounded context and does not leak emails, wallets, or access-policy payloads;
  - queue retrieval with assist does not mutate report/message/member/room state;
  - resolution actions still require explicit admin action.
- Backend HTTP/controller coverage in `backend/src/tests/maintenance.controller.http.spec.ts`:
  - queue endpoint still requires admin role and returns the assist block.
- Frontend coverage in `web/src/components/admin/CommunityModerationDashboard.test.tsx`:
  - advisory summary/risk hints render;
  - advisory copy is visible;
  - action buttons remain separate from assist content.
- Existing validation during finish:
  - `npm run lint` in backend and web where relevant;
  - focused backend/frontend tests;
  - security-best-practices audit before final PR completion.

## Open Implementation Choice

For this slice, prefer deterministic advisory classification over live model calls inside the queue request. That keeps latency, cost, privacy, and test determinism controlled while still shipping the moderator-facing assist. If model-backed summarization is required later, add it behind an explicit service boundary and keep the same bounded DTO input contract.

## Non-Goals

- No automated enforcement.
- No hidden moderation action.
- No new stored moderator notes.
- No raw private listener data or full thread payloads to an AI/model layer.
- No broader policy engine or appeal workflow.
