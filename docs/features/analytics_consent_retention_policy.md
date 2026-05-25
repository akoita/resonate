---
title: "Analytics Consent And Retention Policy"
status: partial
owner: "@akoita"
issue: 963
---

# Analytics Consent And Retention Policy

## Status

`partial`

The analytics platform already stores privacy tier, consent basis, producer,
schema, lineage, and pseudonymous subject/actor identifiers in the shared
event envelope. Backend governance jobs can apply retention cleanup, deletion
propagation, consent withdrawal, redaction, and audit lineage through
`backend/src/modules/analytics/analytics_governance.service.ts`.

This page defines the product and operational policy that those jobs must
follow. User-facing controls, automated warehouse deletion propagation, and
yearly listener summary controls still need product UI and operator runbook
work before this is complete.

## Who It Is For

- Listeners who need transparency, export, deletion, and summary controls for
  their activity history.
- Artists who need aggregate audience and catalog analytics without receiving
  raw listener identity.
- Operators and compliance reviewers who need clear retention and deletion
  behavior across Postgres, BigQuery, Dataflow, and derived reports.
- Developers adding analytics events, marts, or reports.

## Principles

- Capture broad product memory, but store the minimum useful identifiers.
- Prefer pseudonymous actor IDs and stable domain IDs over personal fields.
- Keep raw personal and sensitive records short-lived.
- Keep future value in facts and aggregate views that do not expose direct
  personal identity.
- Do not store prompts, notification bodies, payment proofs, private wallet
  material, exact IP addresses, user-agent strings, or other bulky raw content
  in analytics payloads.
- Keep artist-facing and listener-facing reports separated by default.
- Treat deletion, consent withdrawal, and retention cleanup as replayable
  pipeline events with lineage, not as manual table edits.

## Consent And Controls

Resonate should expose the following controls before treating analytics
summaries as a mature product surface:

| Control | Behavior |
| --- | --- |
| Product analytics preference | Allows authenticated users to opt out of optional product analytics. Required operational, security, payment, rights, and fraud events may still be captured under the appropriate legal basis. |
| Yearly summary preference | Lets listeners opt in or out of personalized yearly summaries such as Wrapped-style recaps. Opting out disables summary generation from future eligible facts and hides generated summary surfaces. |
| Analytics export | Exports the user's linked personal and pseudonymous analytics facts, plus plain-language explanations of aggregate-only data that cannot be attributed back to them. |
| Analytics deletion | Deletes or redacts raw and fact rows linked to the user's actor ID or subject IDs, except financial/audit facts that must be preserved with personal fields minimized. |
| Consent withdrawal | Applies deletion/redaction to events captured under a withdrawn `consentBasis`, then records lineage so future backfills do not recreate removed rows. |
| Artist privacy boundary | Artists see aggregate catalog and fan behavior metrics, not raw listener event streams or listener actor IDs. |

Every personal or sensitive analytics event must include `consentBasis`.
Pseudonymous behavior events should include it when tied to an authenticated
user preference, even when the current backend accepts pseudonymous events
without one.

## Retention By Layer

| Layer | Default Retention | Notes |
| --- | --- | --- |
| Postgres `AnalyticsEvent` sensitive raw events | 90 days | Configured by `ANALYTICS_RETENTION_SENSITIVE_DAYS`; delete unless financial/audit preservation requires redaction. |
| Postgres `AnalyticsEvent` personal raw events | 395 days | Configured by `ANALYTICS_RETENTION_PERSONAL_DAYS`; aligns with the 13-month warehouse window in compliance docs. |
| Postgres `AnalyticsEvent` pseudonymous raw events | 730 days | Configured by `ANALYTICS_RETENTION_PSEUDONYMOUS_DAYS`; enough for replay, cohorts, long sessions, and annual summaries. |
| BigQuery `events_raw` | Same class as source event | Raw warehouse retention must mirror the event privacy tier and governance log state. |
| BigQuery `events_clean` | Same class as source event unless transformed to fact-only form | Clean rows are replay inputs and must not outlive raw retention if they retain actor/session identifiers. |
| BigQuery `analytics_facts` | 24 months for user-linked behavior facts; 7-10 years for financial/audit facts | User-linked facts can support annual summaries and churn/cohort reporting. Financial, payout, royalty, dispute, settlement, rights, and tax/audit facts keep lawful history with personal fields minimized. |
| BigQuery `analytics_views` | Indefinite when anonymous or k-anonymous | Artist dashboards, product funnels, and summary aggregates may be retained while commercially useful if users cannot reasonably be reidentified. |
| `analytics_quarantine` | 30 days for personal/sensitive payloads; 90 days for pseudonymous malformed records | Quarantine exists to fix pipeline loss, not as a shadow raw store. Keep reason/event metadata after payload deletion when useful. |
| Governance lineage | Indefinite | Deletion, redaction, consent withdrawal, retention cleanup, and backfill lineage must remain to prove cleanup occurred. |

Any retention longer than these defaults needs a documented purpose, data
owner, access boundary, and deletion behavior.

## Export And Deletion Propagation

User export/delete and consent withdrawal must propagate through the full
analytics path:

1. Resolve the authenticated user to every linked analytics subject: user ID,
   pseudonymous actor ID, wallet subjects, artist profile subjects, active
   session IDs when available, and relevant release/track ownership IDs for
   artist-side exports.
2. Write a governance lineage record before mutating downstream data.
3. Delete non-audit raw, clean, and fact rows linked to the user or withdrawn
   consent basis.
4. Redact financial/audit rows instead of deleting lawful transaction history.
   Keep event name, dates, amounts, settlement/rights status, and source refs
   only when required for accounting, fraud, rights, or legal obligations.
5. Recompute or invalidate dependent views and marts so deleted rows do not
   reappear after a cache refresh, Dataflow retry, or BigQuery backfill.
6. Keep aggregate rows only when they remain anonymous or meet the approved
   aggregation threshold for the report.
7. Mark historical summary artifacts as revoked or regenerate them without the
   deleted facts.

Backfills must read governance lineage and tombstones before writing derived
facts. A backfill that ignores deletion lineage is considered unsafe.

## Yearly Summary Rules

Yearly listener summaries can use:

- pseudonymous playback facts such as track, artist, release, source, duration
  bucket, completion bucket, replay count, and listening day;
- playlist/library facts such as save/add/remove counts and playlist-to-play
  funnels;
- discovery facts such as search-to-play and marketplace-to-play paths;
- commerce facts such as purchase counts, assets, tiers, and settlement status
  after personal payment details are removed;
- coarse cohorts and trends that are safe to expose to the listener.

Yearly summaries must not use:

- raw prompts, notification bodies, support messages, free-form names, exact IP
  addresses, device fingerprints, payment proofs, or private wallet data;
- artist-facing aggregate data to infer another listener's behavior;
- deleted/redacted rows or rows captured after summary opt-out;
- low-count artist or listener cohorts that could identify another person.

Artist yearly reports should use artist-owned catalog facts and anonymous
audience aggregates. Listener yearly reports should use the listener's own
facts and platform-wide anonymous comparison baselines. Do not mix the two
without an explicit report contract.

## Developer Checklist

When adding analytics events or marts:

- Choose a privacy tier and consent/legal basis.
- Avoid personal fields in payloads; store stable IDs or coarse buckets.
- Add the event family to the taxonomy and warehouse allowlist when needed.
- Document whether the event can appear in listener reports, artist reports,
  operational reports, agent datasets, or financial/audit exports.
- Define retention and deletion behavior before shipping the event.
- Include governance lineage or deletion/backfill tests when the event feeds a
  durable fact or view.

## Current Surfaces

- Event envelope and validation:
  `backend/src/modules/analytics/analytics_event.ts`
- Governance implementation:
  `backend/src/modules/analytics/analytics_governance.service.ts`
- Admin retention trigger:
  `POST /admin/retention/cleanup`
- Analytics platform feature page:
  [Analytics Event Ledger](analytics_event_ledger.md)
- Long-term RFC:
  [Long-Term Analytics Event Ledger](../rfc/analytics-event-ledger.md)
- Compliance retention summary:
  [Security Review + Data Retention](../compliance/security_review_data_retention.md)
- Environment variables:
  [Environment Variables](../deployment/environment.md)

## Verification

- Governance behavior is covered by
  `backend/src/tests/analytics_governance.spec.ts` and
  `backend/src/tests/analytics_governance.integration.spec.ts`.
- New analytics events should add unit or integration coverage for
  privacy-tier validation, allowed payload fields, deletion/redaction behavior,
  and downstream fact/view propagation when applicable.
