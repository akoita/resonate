# Issue 875: Structured App Observability Signals

## Goal

Provide the app-owned observability contract needed by the production-readiness
RFC and the `resonate-iac` staging dashboard/alert baseline.

## Scope

1. Move request ID propagation and request completion logging into a shared,
   tested middleware.
2. Redact sensitive fields before structured JSON logs leave the process.
3. Emit stable x402 business events for challenge, settlement, replay, and
   verification failure paths without logging payment proofs.
4. Document the event names and fields under `docs/operations`.

## Validation

1. Run backend unit tests for the request observability helper.
2. Run backend TypeScript lint.
3. Confirm no environment-specific values or secrets are introduced.

