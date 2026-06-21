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
