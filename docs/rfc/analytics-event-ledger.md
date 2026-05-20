# RFC: Long-Term Analytics Event Ledger

Date: 2026-05-20
Status: Draft
Issue: [#867](https://github.com/akoita/resonate/issues/867)

## Summary

Resonate should treat analytics as a long-lived product and protocol memory,
not as dashboard counters. The platform should capture durable domain events
now so future product, artist, agent, rights, marketplace, accounting, and
protocol questions can be answered without retrofitting instrumentation after
the fact. A dashboard is only one possible consumer; the same event history
should support any future report, export, audit, cohort, model feature, or
decision-support view.

The design is an append-only analytics event ledger feeding a warehouse with
separate raw, clean, fact, and aggregate layers. Raw capture should be broad,
but retention and access must be governed: long-term value should come from
pseudonymous events, financial/audit facts, and anonymized aggregates, not from
keeping personal data forever.

## Current State

- Artist dashboard docs exist in
  [Analytics Dashboard v0](../features/analytics_dashboard_v0.md).
- Architecture docs already mention BigQuery datasets:
  `events_raw`, `events_clean`, and `analytics_views`.
- Event taxonomy docs define early domain events and `event_version`.
- Compliance docs now distinguish raw personal events, pseudonymous events,
  financial/audit facts, anonymous aggregates, and deletion lineage.
- Shared backend event envelope validation exists in
  `backend/src/modules/analytics/analytics_event.ts`.
- Backend analytics ingestion now persists raw envelopes to the Postgres
  `AnalyticsEvent` ledger through
  `backend/src/modules/analytics/analytics_event_store.ts`; production
  warehouse loading is not implemented yet.
- The first warehouse export contract exists in
  `backend/src/modules/analytics/analytics_warehouse.ts` and emits raw, clean,
  fact, view, and quarantine layers.
- Core analytics producer helpers exist in
  `backend/src/modules/analytics/analytics_instrumentation.service.ts` for
  playback, library, commerce, rights, agent, and generation events.
- Analytics governance jobs exist in
  `backend/src/modules/analytics/analytics_governance.service.ts` for
  retention cleanup, deletion propagation, consent withdrawal, redaction, and
  lineage logging.
- Product-specific analytics issues exist for listening behavior, Punchline
  Drops funnels, payout breakdowns, content-protection reports, and dashboards.

## Goals

- Preserve future analytical optionality for features not yet imagined.
- Make every important product/protocol transition observable as a versioned
  domain event.
- Keep event capture append-only and replayable.
- Separate event capture from report-specific aggregates and UI-specific views.
- Support decade-scale analysis through stable facts and privacy-safe
  aggregates.
- Make schema evolution explicit and backwards-compatible by default.
- Respect GDPR/CCPA deletion, consent, and minimization requirements.
- Give developers one canonical event envelope and ownership model.
- Make analytics useful for humans, agents, auditors, and product experiments.

## Non-Goals

- Building the full ingestion pipeline in this RFC.
- Choosing a final BI tool.
- Keeping all raw request logs forever.
- Circumventing user deletion or consent controls.
- Treating analytics events as the source of truth for transactional state.

## Design Principles

1. Capture domain facts, not implementation noise.
2. Store event envelopes consistently across producers.
3. Keep raw events immutable; correct with compensating events.
4. Retain PII-bearing raw data for the shortest useful period.
5. Preserve long-term value in pseudonymous facts and anonymous aggregates.
6. Record consent, privacy tier, producer, schema version, and lineage.
7. Prefer additive schema evolution.
8. Make idempotency mandatory.
9. Keep financial and audit facts traceable to source events.
10. Make deletion and redaction jobs first-class pipeline concerns.

## Event Envelope

Every analytics event should use the same outer shape:

| Field | Purpose |
| --- | --- |
| `event_id` | Globally unique idempotency key. |
| `event_name` | Stable dotted name, such as `playback.completed`. |
| `event_version` | Integer schema version for this event name. |
| `occurred_at` | Source timestamp for the user/domain action. |
| `received_at` | Ingestion timestamp. |
| `producer` | Service, worker, contract indexer, or client source. |
| `environment` | `local`, `dev`, `staging`, or `prod`. |
| `privacy_tier` | `anonymous`, `pseudonymous`, `personal`, or `sensitive`. |
| `subject_type` | Main entity type: user, artist, wallet, track, release, agent, etc. |
| `subject_id` | Main entity identifier, hashed or tokenized when needed. |
| `actor_id` | Optional actor identifier, hashed or omitted by privacy tier. |
| `session_id` | Product/session correlation id when available. |
| `trace_id` | Request/job/agent trace correlation id. |
| `schema_uri` | Link or stable key for the event schema. |
| `consent_basis` | Consent/legal basis snapshot for user-behavior events. |
| `payload` | Versioned event body. |
| `source_refs` | Optional transaction hash, database row id, object URI, or job id. |

## Data Layers

### `events_raw`

Append-only event envelopes as received from producers. This layer supports
replay, debugging, schema migration, and future backfills.

Retention should vary by privacy tier. Raw events with personal identifiers are
not decade-long storage by default.

### `events_clean`

Validated, normalized events with canonical field names, typed payloads, and
known-bad records quarantined. Clean events are the stable input for facts,
aggregates, and ML/agent features.

### `analytics_facts`

Long-lived analytical facts derived from clean events. Examples:

- playback fact: track, artist, completion bucket, source, country/region
  bucket, pseudonymous listener cohort
- purchase fact: listing, asset, canonical USD value, settlement asset, buyer
  cohort, seller/artist
- rights fact: upload route, evidence type, decision result, dispute outcome
- agent fact: recommendation strategy, candidate set metadata, decision result

Facts should avoid direct PII and should be suitable for multi-year retention.

### `analytics_views`

Report, export, API, and UI-ready tables: daily artist metrics, funnel metrics,
payout reports, cohort summaries, trust reports, product-health views, partner
exports, and dashboard datasets.

### `privacy_deletion_log`

Append-only records for deletion, redaction, consent withdrawal, and backfill
jobs. This is how the platform proves that downstream tables were updated.

### `analytics_quarantine`

Invalid records, malformed envelopes, or unsupported event families that cannot
be safely normalized into facts/views. Quarantined records should keep enough
raw context and reason metadata to support replay after schema fixes.

## Event Families

Initial event families should cover:

- `identity.*`: signup, auth, wallet connection, role changes.
- `catalog.*`: release creation, metadata changes, publish/unpublish.
- `ingestion.*`: upload, processing, model version, storage outcomes.
- `playback.*`: start, progress milestones, completion, skip, save.
- `commerce.*`: listing, quote, purchase intent, settlement, refund.
- `rights.*`: evidence submission, route decision, dispute, resolution.
- `agent.*`: recommendation, quote evaluation, purchase decision, feedback.
- `generation.*`: prompt, generation, publish, rate-limit state.
- `experiment.*`: assignment, exposure, conversion.
- `system.*`: job completion, import/export, pipeline health.

Product teams can add feature-specific events, but each event must map to a
family owner and schema.

## Retention Model

| Data Class | Examples | Default Retention |
| --- | --- | --- |
| Personal raw events | email-linked auth events, exact IP/device identifiers | 90 days in OLTP/log systems, 13 months in warehouse unless required for abuse/security |
| Pseudonymous raw events | hashed user/session behavior events | 24 months, extendable with documented privacy review |
| Financial/audit facts | settlements, payouts, royalty facts, dispute decisions | 7-10 years, aligned with legal/accounting needs |
| Anonymous aggregates | daily plays, funnels, revenue cohorts, regional demand buckets | Indefinite while commercially useful |
| Schema and lineage metadata | schemas, transformations, deletion job results | Indefinite |

Any retention longer than the default must document purpose, access level, and
deletion behavior.

## Consent, Privacy, And Deletion

Analytics events should carry enough metadata to answer:

- Was this event anonymous, pseudonymous, personal, or sensitive?
- Which legal basis or consent state applied when it was captured?
- Can this event be linked back to a user directly, indirectly, or not at all?
- Which downstream facts and aggregates need redaction after deletion?

Deletion should not mean corrupting financial history. Instead:

- Direct personal identifiers are deleted or tokenized.
- Pseudonymous user keys are rotated or tombstoned where required.
- Financial/audit facts keep lawful transaction records with personal fields
  minimized.
- Anonymous aggregates remain if they cannot reasonably identify a person.

## Schema Evolution

- Additive fields are allowed within the same event version.
- Breaking payload changes require a new `event_version`.
- Producers must keep old and new versions in parallel until clean transforms
  support both.
- Deprecated events remain readable for replay.
- Each schema change should include sample payloads and owner approval.

## Implementation Slices

1. **Event SDK and envelope validation**
   - Tracking issue:
     [#868](https://github.com/akoita/resonate/issues/868)
   - Shared TypeScript types, validators, sample event-family schemas,
     idempotency helper conventions, and privacy-tier requirements are
     implemented in `backend/src/modules/analytics/analytics_event.ts`.
2. **Durable ingestion**
   - Tracking issue:
     [#871](https://github.com/akoita/resonate/issues/871)
   - Raw event envelope persistence is implemented in Postgres with idempotent
     `eventId` upserts.
   - Pub/Sub or queue-backed warehouse export remains follow-up.
3. **Warehouse export**
   - Tracking issue:
     [#869](https://github.com/akoita/resonate/issues/869)
   - Export contracts for `events_raw`, `events_clean`, `analytics_facts`,
     `analytics_views`, and `analytics_quarantine` are implemented in
     `backend/src/modules/analytics/analytics_warehouse.ts`.
   - Production warehouse loading remains follow-up.
4. **Core event instrumentation**
   - Tracking issue:
     [#870](https://github.com/akoita/resonate/issues/870)
   - Producer helpers for `playback.completed`, `library.saved`,
     `commerce.settled`, `rights.route_decided`,
     `agent.recommendation_selected`, and `generation.created` are implemented
     in `backend/src/modules/analytics/analytics_instrumentation.service.ts`.
   - Wiring every domain service call site to these producers remains
     incremental follow-up work.
5. **Governance jobs**
   - Tracking issue:
     [#873](https://github.com/akoita/resonate/issues/873)
   - Retention cleanup, deletion propagation, consent withdrawal, redaction,
     and lineage logging are implemented in
     `backend/src/modules/analytics/analytics_governance.service.ts`.
   - Schema compatibility checks remain follow-up work.
6. **Reporting and dashboard migration**
   - Tracking issue:
     [#872](https://github.com/akoita/resonate/issues/872)
   - Move artist analytics, Punchline Drops funnels, and public dispute
     analytics/reporting onto facts/views instead of in-memory events.

## Open Questions

- Which warehouse and transformation stack should be the first production path:
  BigQuery plus dbt, or a cheaper interim export?
- Should local development use Postgres-only raw-event tables before warehouse
  export exists?
- What is the exact consent UX for listener behavior analytics?
- Which event families need partner/export contracts?
- Which aggregates are safe to retain indefinitely by default?

## References

- [Analytics Event Ledger feature page](../features/analytics_event_ledger.md)
- [Analytics Dashboard v0](../features/analytics_dashboard_v0.md)
- [Event Taxonomy & Domain Model](../architecture/event_taxonomy_domain_model.md)
- [Data Model & Storage Plan](../architecture/data_model_storage_plan.md)
- [Security Review + Data Retention](../compliance/security_review_data_retention.md)
