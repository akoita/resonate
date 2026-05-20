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
- See [Production Observability Contract](./production_observability_contract.md)
  for stable event names consumed by infrastructure dashboards and alerts.

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
- Uploads queued/processed (BullMQ `stems` queue depth)
- Stem separation duration (Demucs worker processing time)
- Catalog update latency

### Demucs Worker
- `/health` endpoint response time
- Separation job duration (by hardware: CPU vs GPU)
- Memory/GPU utilization during processing
- Job success/failure rate
- Model load time (first request after cold start)

### Sessions/Payments
- Session starts/stops
- License grants
- Payment initiation/settlement counts

### Public x402 Validation Window

Track these during any approved public registry-validation or launch-readiness
window:

- Unpaid x402 challenges issued by route, stem id, network, and response status
- Paid retries by proof header (`PAYMENT-SIGNATURE` or legacy `X-PAYMENT`)
- Facilitator verify and settle attempts by result
- x402 receipt issuance count and failure count
- Storefront seed availability for `GET /api/storefront/stems?limit=1`
- Rate-limit decisions for `/.well-known/*`, `/openapi.json`, storefront, MCP,
  and x402 purchase routes
- Scanner-origin traffic volume when identifiable from request metadata

## SLO Targets (Initial)
- API availability: 99.5% monthly
- P95 latency: < 500ms for read endpoints, < 1s for writes
- Error rate: < 1% for API endpoints

## Alerts (Stub)
- Error rate > 2% for 5 minutes
- P95 latency > 1s for 10 minutes
- Ingestion backlog > 200 items
- Demucs worker unhealthy (health check failing)
- Stem separation duration > 15 minutes (CPU) or > 2 minutes (GPU)
- During public x402 validation: x402 challenge route 5xx rate > 1% for
  5 minutes
- During public x402 validation: storefront seed check returns zero purchasable
  stems for 2 consecutive probes
- During public x402 validation: facilitator verify/settle failure rate > 5%
  for 5 minutes, excluding expected unpaid probes and invalid proofs

## Dashboards (Stub)
- API overview (latency, error rate, throughput)
- Ingestion pipeline (queue depth, processing time)
- Sessions + payments (licenses, payouts)
