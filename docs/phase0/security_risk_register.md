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
