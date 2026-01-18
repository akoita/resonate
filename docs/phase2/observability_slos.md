# Phase 2: Observability Baselines & SLOs

## Goals
- Establish consistent logging and trace identifiers across services.
- Define baseline metrics and SLO targets for MVP alpha readiness.
- Provide alert thresholds and dashboard placeholders for future wiring.

## Logging Conventions
- Emit structured JSON logs (one line per event).
- Required fields: `level`, `message`, `service`, `requestId`, `timestamp`.
- Use `requestId` from `x-request-id` header or generated server-side.
- Avoid logging PII or secrets; redact wallet addresses beyond last 6 chars.

## Trace IDs
- Accept inbound `x-request-id` and propagate to downstream calls.
- Default generation: UUID v4.
- Return the request id in response header `x-request-id`.

## Metrics (Baseline)
### API
- Request count per route
- P50/P95/P99 latency per route
- Error rate (4xx/5xx)

### Ingestion/Catalog
- Uploads queued/processed
- Stem separation duration
- Catalog update latency

### Sessions/Payments
- Session starts/stops
- License grants
- Payment initiation/settlement counts

## SLO Targets (Initial)
- API availability: 99.5% monthly
- P95 latency: < 500ms for read endpoints, < 1s for writes
- Error rate: < 1% for API endpoints

## Alerts (Stub)
- Error rate > 2% for 5 minutes
- P95 latency > 1s for 10 minutes
- Ingestion backlog > 200 items

## Dashboards (Stub)
- API overview (latency, error rate, throughput)
- Ingestion pipeline (queue depth, processing time)
- Sessions + payments (licenses, payouts)
