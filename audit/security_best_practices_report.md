# Security Best Practices Report

## Executive Summary

This review covers the AgentSignal outcome feedback changes in #980, including
analytics-to-learning mirroring, Session Intent metadata, and the new signal
actions. No Critical, High, Medium, or Low findings were identified; the change
keeps public analytics actor ids pseudonymous and routes raw authenticated user
ids only through backend-internal learning calls.

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None.

## Low Findings

None.

## Informational Notes

### SBPR-001: AgentSignal Metadata Is Bounded And Sanitized

**File:** `backend/src/modules/agents/agent_learning.service.ts`

`buildAgentSignalMetadata` keeps intent, mood/vibe, recommendation, and outcome
context in an allowlisted schema. It drops URLs, email-like values, wallet/user
identifier-looking strings, control characters, oversized strings, and nested
free-form payloads.

### SBPR-002: Analytics Actor Privacy Boundary Is Preserved

**File:** `backend/src/modules/analytics/analytics.controller.ts`

Analytics events still use `pseudonymousAnalyticsActorId` in the event envelope.
The raw authenticated `userId` is passed only as backend-internal
`actorUserId` so `AnalyticsInstrumentationService` can mirror eligible
track-level outcomes into `AgentSignal`; it is not emitted into analytics
payloads or source refs.

### SBPR-003: Product Event Allowlist Now Matches AI DJ UI Emissions

**File:** `backend/src/modules/analytics/analytics.controller.ts`

The product analytics allowlist now includes the Session Intent events emitted
by the AI DJ UI (`agent.intent_viewed`, `agent.intent_selected`,
`agent.session_started`, and `agent.next_pick_requested`). Unsupported product
event names continue to be rejected.

## Review Commands

```bash
rg 'password|secret|api_key|private_key' backend/src/modules/agents backend/src/modules/analytics backend/src/modules/sessions --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw|\$executeRaw' backend/src/modules/agents backend/src/modules/analytics backend/src/modules/sessions
rg 'JSON\.parse|eval\(' backend/src/modules/agents backend/src/modules/analytics backend/src/modules/sessions
rg 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/lib/api.ts web/src/lib/productAnalytics.ts
rg '@(Controller|Get|Post|Put|Delete|Patch)|@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/agents backend/src/modules/analytics backend/src/modules/sessions
```
