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
- Event logs: 90 days in OLTP, 24 months in BigQuery
- Aggregates: retain 36 months

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
