# Issue #983 Implementation Plan

## Goal

Expose safe, bounded analytics-derived recommendation explanations from Agent
Taste Intelligence without leaking raw listening history or trusting arbitrary
warehouse text.

## First Slice

1. Sanitize BigQuery taste score explanations as they enter the backend:
   - strip control characters and markup
   - collapse whitespace
   - cap length
   - drop malformed or unsafe strings
2. Translate warehouse explanation hints into listener-safe reason categories:
   - taste fit
   - session intent / mood fit
   - novelty / replay fit
   - commerce / listing fit
3. Attach those explanations to `agentRecommendation.explanation` alongside the
   existing selector signals.
4. Preserve deterministic fallback when explanations are missing or rejected.
5. Update tests and feature docs with privacy boundaries.

## Non-Goals

- Do not expose raw event counts, track history, user ids, sessions, or model
  internals to listener-facing copy.
- Do not require BigQuery taste signals for recommendations.
- Do not change the bounded BigQuery serving query shape beyond explanation
  sanitization.

## Validation

- `cd backend && npx jest --runInBand src/tests/agent_bigquery_taste_signal.spec.ts src/tests/agent_learning.spec.ts`
- `cd backend && npm run lint`
- `git diff --check`
