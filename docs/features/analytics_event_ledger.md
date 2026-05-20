---
title: "Analytics Event Ledger"
status: partial
owner: "@akoita"
issue: 867
---

# Analytics Event Ledger

## Status

`partial`

The backend now has a shared analytics event envelope, runtime validation, and
sample event-family schemas in
`backend/src/modules/analytics/analytics_event.ts`. Raw event envelopes are
persisted through the Postgres-backed `AnalyticsEvent` ledger model via
`backend/src/modules/analytics/analytics_event_store.ts`, with an in-memory
fallback only for direct unit-test construction outside Nest dependency
injection. The first warehouse export contract is available through
`backend/src/modules/analytics/analytics_warehouse.ts`; it emits raw, clean,
fact, view, and quarantine layers from stored events. Core producer helpers for
playback, library, commerce, rights, agent, and generation events are available
in `backend/src/modules/analytics/analytics_instrumentation.service.ts`.
Retention cleanup, deletion propagation, consent withdrawal, and governance
lineage are available in
`backend/src/modules/analytics/analytics_governance.service.ts`, and the admin
retention endpoint invokes analytics cleanup. A first operational warehouse
loader is available in
`backend/src/modules/analytics/analytics_warehouse_loader.ts`; it can backfill
stored events into idempotent JSONL layer files outside process memory and
quarantines unsupported event versions before they reach clean/fact/view layers.
Deployed environments can set `ANALYTICS_WAREHOUSE_TARGET=bigquery_insert_all`
to stream those layers into the configured BigQuery dataset through Google ADC.
Current artist analytics endpoints consume the generated fact/view layers
instead of aggregating directly from raw in-memory events.

## Who It Is For

- Product and growth teams measuring adoption, funnels, retention, demand, and
  feature health.
- Artists understanding plays, purchases, payouts, and fan behavior in
  aggregate.
- Operators producing rights, disputes, commerce, abuse, marketplace, and
  compliance reports.
- Agents and recommendation systems learning from replayable product events.
- Developers adding instrumentation without inventing one-off report shapes.

## Value

The ledger keeps Resonate from losing product memory. New features should emit
stable domain events as they happen, even when no current screen or report uses
them yet. Years later, the team can build cohorts, funnels, payout reports,
agent-learning datasets, trust metrics, marketplace analysis, audit exports,
artist statements, and reports for features we have not imagined yet from
historical facts instead of guessing.

Long-term usefulness comes from governed pseudonymous facts and anonymous
aggregates, not from retaining raw personal data forever.

## How To Use Today

- Read the RFC:
  [Long-Term Analytics Event Ledger](../rfc/analytics-event-ledger.md).
- Use the event taxonomy:
  [Event Taxonomy & Domain Model](../architecture/event_taxonomy_domain_model.md).
- For the current artist dashboard/reporting surface, see:
  [Analytics Dashboard v0](analytics_dashboard_v0.md).
- Backend producers should use the shared event contract:
  `backend/src/modules/analytics/analytics_event.ts`.
- Current prototype API surfaces:
  - `POST /analytics/ingest`
  - `GET /analytics/artist/:id`
  - `GET /analytics/artist/:id/v1`
  - `GET /analytics/rollup/daily`
  - `GET /analytics/export/layers`
- Admin/operator warehouse load surfaces:
  - `POST /admin/analytics/warehouse/load`
  - `POST /admin/analytics/warehouse/backfill`

## Expected Platform Surfaces

| Surface | Purpose |
| --- | --- |
| Analytics event SDK | Implemented in `backend/src/modules/analytics/analytics_event.ts`: shared event envelope, validators, schema examples, privacy tiers, and idempotency helper conventions. |
| Durable ingestion | Implemented for local/backend runtime with the Postgres `AnalyticsEvent` raw ledger and idempotent `eventId` upserts. |
| `events_raw` | Implemented export layer for append-only received events used for replay and backfill. |
| `events_clean` | Implemented export layer for validated, normalized event records. |
| `analytics_facts` | Implemented export layer for long-lived pseudonymous product, commerce, rights, and agent facts. |
| `analytics_views` | Implemented export layer for report/API/export/UI-ready aggregates. |
| `analytics_quarantine` | Implemented export layer for invalid or unsupported records that must not be silently dropped. |
| Warehouse loading/backfill | Implemented through `ANALYTICS_WAREHOUSE_TARGET=local_json` for idempotent JSONL files and `ANALYTICS_WAREHOUSE_TARGET=bigquery_insert_all` for BigQuery streaming inserts across raw, clean, fact, view, and quarantine layers. Dataflow-style managed transforms remain future infrastructure scope. |
| Current artist reports | Implemented for `GET /analytics/artist/:id` and `GET /analytics/artist/:id/v1`; reports read generated analytics facts and fact dimensions while preserving response compatibility. |
| Core producer helpers | Implemented in `backend/src/modules/analytics/analytics_instrumentation.service.ts` for playback, library, commerce, rights, agent, and generation events. |
| Retention/deletion jobs | Implemented in `backend/src/modules/analytics/analytics_governance.service.ts`: retention cleanup, deletion propagation, consent withdrawal, redaction, and lineage audit. |

## Event Families

Implemented producer helper event names:

- `playback.completed`
- `library.saved`
- `commerce.settled`
- `rights.route_decided`
- `agent.recommendation_selected`
- `generation.created`

The planned ledger should also cover:

- identity and wallet events
- catalog and ingestion events
- additional playback and library events
- additional commerce, settlement, and payout events
- additional rights, curation, and dispute events
- additional agent decision and recommendation events
- additional generation events
- experiment exposure and conversion events
- pipeline/system health events

## Verification

Current verification:

- New durable features should identify the event family they emit into.
- Feature docs should list important analytics events.
- Privacy-sensitive events should declare retention and deletion behavior.
- Event envelope validation is covered by
  `backend/src/tests/analytics_event.spec.ts`.
- Warehouse export transforms and quarantine behavior are covered by
  `backend/src/tests/analytics_warehouse.spec.ts`.
- Warehouse loader idempotency, schema quarantine, and event-version parsing are
  covered by `backend/src/tests/analytics_warehouse_loader.spec.ts`.
- Durable backfill scoping is covered by
  `backend/src/tests/analytics_warehouse_loader.integration.spec.ts`.
- Core producer helper behavior is covered by
  `backend/src/tests/analytics_instrumentation.spec.ts` and
  `backend/src/tests/analytics_instrumentation.integration.spec.ts`.
- Retention/deletion/consent governance behavior is covered by
  `backend/src/tests/analytics_governance.spec.ts` and
  `backend/src/tests/analytics_governance.integration.spec.ts`.
- Future implementation PRs should include tests for durable ingestion,
  idempotency enforcement, and additional downstream report/fact behavior.

## Follow-Up Work

- [#879](https://github.com/akoita/resonate/issues/879) — add operational
  warehouse loading/backfill. JSONL and BigQuery insert-all targets are
  implemented; remaining future work is a managed Dataflow-style transform once
  that infrastructure dependency is chosen.
