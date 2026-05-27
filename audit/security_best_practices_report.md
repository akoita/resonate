# Security Best Practices Report

## Executive Summary

This review covers the Agent Taste explanation changes in #983, which touch
backend data handling for warehouse-provided recommendation explanations. No
Critical or High findings were identified; the implementation adds sanitization
and bounded listener-facing categories before analytics-derived text reaches
recommendation responses.

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None.

## Low Findings

None.

## Informational Notes

### SBPR-001: Warehouse Explanation Text Is Treated As Untrusted Input

**File:** `backend/src/modules/agents/agent_bigquery_taste_signal.service.ts`

Warehouse explanation text is sanitized before it is attached to taste-score
objects. The sanitizer strips markup/control characters, collapses whitespace,
rejects URLs/emails/user/session identifiers, and bounds length.

### SBPR-002: Listener-Facing Copy Uses Safe Categories

**File:** `backend/src/modules/agents/agent_selector.service.ts`

The selector maps sanitized warehouse hints into bounded explanation categories
for taste fit, session intent fit, novelty/replay fit, and commerce/listing fit
instead of exposing raw private event history.

## Review Commands

```bash
rg 'password|secret|api_key|private_key' backend/src/modules/agents backend/src/modules/analytics --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw|dangerouslySetInnerHTML|innerHTML|eval\(' backend/src/modules/agents backend/src/modules/analytics web/src
rg 'JSON\.parse|@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/agents backend/src/modules/analytics
rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src
```
