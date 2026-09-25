---
title: "Phase 0: Security & Risk Register"
status: draft
owner: "@akoita"
---

# Phase 0: Security & Risk Register

## Objectives

- Document core threats and mitigations.
- Capture key assumptions and compliance considerations.

## Threat Model (Initial)

| Area | Threat | Impact | Mitigation |
| --- | --- | --- | --- |
| Wallets | Unauthorized spend | High | Budget caps, signed intents, rate limits |
| Uploads | Malicious file upload | Medium | File type checks, virus scan, size limits |
| IP Rights | Unauthorized remix/commercial use | High | Licensing checks, audit logs |
| Encrypted stems | Plaintext exposure during server-side remix render (#1214) | High | Worker-time ownership + eligibility re-check before any decrypt; strict in-memory `decryptForRender` (no on-disk cache, fail-closed, ciphertext never reaches ffmpeg/providers); plaintext only in a unique temp dir removed in `finally`; `remix.encrypted_render_authorized`/`remix.encrypted_render_denied` audit events; `INTERNAL_SERVICE_KEY`-gated decrypt with no non-prod fallback |
| Payments | Reorgs or failed tx | Medium | Confirmation depth, retries |
| APIs | Credential leakage | High | Short-lived JWTs, secret rotation |
| APIs | Malformed or out-of-range request bodies reaching services (CWE-20) | Medium | Backend-wide `ValidationPipe` enforces class-validator DTO constraints with `400` (#1888, `backend/src/config/validation.ts`); interface-typed bodies validate in their services; client-supplied owner identifiers (e.g. generation `artistId`) are bound to the caller at the HTTP boundary |
| APIs | Role-restricted routes reachable by lower roles | High | Global `RolesGuard` fails closed: on any `@Roles(...)` route it authenticates the JWT itself (global guards run before route-level `AuthGuard("jwt")`) before checking the role; the controller test app registers the same global guard, and a reflection test requires every `@Roles` route to use JWT auth |
| Agents | Model output or injected content steering tool identity | High | Tool calls bind `userId` from the server-built runtime input, never from model arguments; only tools declared to the model are dispatched; generation tools publish only under the platform agent artist |

## Risk Register

| Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- |
| L2 instability | Medium | Medium | Failover plan, monitoring | @akoita |
| Pricing abuse | Medium | High | Floors/ceilings, alerts | @akoita |
| AI latency | Medium | Medium | Async processing, caching | @akoita |
| Data retention gaps | Low | Medium | Policy review, audits | @akoita |

## Compliance & Privacy Assumptions

- No PII stored in on-chain events.
- GDPR/CCPA deletion flows are required post-MVP.
- Audio assets are stored in private buckets by default.

## Open Questions

- Required confirmation depth for payment settlement?
- Minimum security review before public beta?
