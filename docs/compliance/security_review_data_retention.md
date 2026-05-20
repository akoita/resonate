# Phase 3: Security Review + Data Retention

## Security Review Checklist
- Authentication: JWT issuance, token expiry, refresh strategy
- Authorization: role-based access for artist/curator/admin
- Input validation: payload schemas and file upload limits
- Secrets management: environment variables + CI masking
- Dependency review: known CVEs and patch cadence
- Supply chain: lockfile integrity and build provenance
- On-chain flows: signature validation and replay protection
- Logging: redact PII and wallet addresses in logs

## Data Retention Policy (Draft)
### User Data
- Account profile: retain until account deletion request
- Wallet addresses: retain until account deletion request
- Auth logs: 30 days

### Music Assets
- Raw uploads (stems): 180 days or until published
- Published stems: retain while track is live
- Deleted tracks: purge within 30 days

### Analytics
- Personal raw event logs: 90 days in OLTP/log systems, 13 months in the
  warehouse unless a documented security, abuse, or compliance purpose requires
  longer retention.
- Pseudonymous raw analytics events: 24 months by default, extendable only with
  documented privacy review.
- Financial, payout, royalty, dispute, and audit facts: 7-10 years when needed
  for accounting, settlement, fraud, rights, or legal history.
- Anonymous aggregates: retain indefinitely while commercially useful, provided
  they cannot reasonably identify a person.
- Deletion/redaction lineage: retain indefinitely to prove downstream cleanup
  occurred.

See [Long-Term Analytics Event Ledger](../rfc/analytics-event-ledger.md) for
the analytics retention classes and governance model.

Operational knobs:
- `ANALYTICS_RETENTION_PERSONAL_DAYS` defaults to 395 days.
- `ANALYTICS_RETENTION_SENSITIVE_DAYS` defaults to 90 days.
- `ANALYTICS_RETENTION_PSEUDONYMOUS_DAYS` defaults to 730 days.
- `POST /admin/retention/cleanup` runs analytics retention cleanup and records
  deletion/redaction lineage in `AnalyticsGovernanceLog`.

### Compliance Notes
- GDPR/CCPA deletion within 30 days of request
- Access logs audited quarterly
- Incident response playbook reviewed every 6 months

## Mitigation Backlog (Initial)
- Add RBAC guard layer for curator/admin endpoints
- Introduce upload virus scan + file type allowlist
- Add rate limiting on auth and upload endpoints
- Enable dependency scanning in CI

## Implemented (Phase 3)
- RBAC guard with curator/admin roles on curation endpoints
- Rate limiting on auth and upload endpoints
- Audit log entries for auth and curation actions
- Admin retention cleanup endpoint (manual trigger)
