# Request tracing

The backend can record **traces**: for one request, a timeline of every step
that took time, such as the incoming HTTP request, the Nest route handler, and
each outgoing call it made (AI model, bundler, chain RPC, storage). Logs and
metrics say *that* something is slow; a trace says *where*.

## How it works

- **OpenTelemetry** (`backend/src/tracing.ts`) is the open, vendor-neutral
  standard for traces. Instrumentations for `http`, Node's built-in `fetch`
  (undici), Express and NestJS create the spans automatically.
- **Sampling.** Tracing every request is wasteful. By default 10% of new
  requests start a trace (`OTEL_TRACES_SAMPLE_RATIO`). If a caller already
  decided (a `traceparent` header), that choice is kept so a trace is never
  half recorded. Health and indexer probes are never traced.
- **Export.** Spans are batched and sent with OTLP (the OpenTelemetry wire
  protocol) to Google's Telemetry API, `telemetry.googleapis.com`, which stores
  them in Cloud Trace. No collector sidecar is needed. Changing
  `OTEL_EXPORTER_OTLP_ENDPOINT` sends them anywhere else that speaks OTLP.
- **Logs joined to traces.** While a request is traced, every structured log
  line gets `logging.googleapis.com/trace` and `logging.googleapis.com/spanId`
  (`backend/src/modules/shared/trace_log_fields.ts`). Cloud Logging then links
  each entry to its trace, and Cloud Trace shows the logs of a span.
- **Privacy.** No request or response headers are recorded (they carry tokens
  and payment proofs). Span names use the route pattern, not raw ids.

## Turning it on

Set `OTEL_TRACES_ENABLED=true` and `GCP_PROJECT_ID` on the backend. The
service account needs the `roles/telemetry.tracesWriter` role and the project
needs the `telemetry.googleapis.com` and `cloudtrace.googleapis.com` APIs;
the deployment wiring lives in `resonate-iac`.

## Trying it locally

Run Jaeger (open source) and point the backend at it:

```bash
docker run --rm -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:latest
OTEL_TRACES_ENABLED=true OTEL_TRACES_SAMPLE_RATIO=1 GCP_PROJECT_ID=local \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run start:dev
```

Open http://localhost:16686 and pick the `resonate-backend` service.

## Cost

Cloud Trace includes 2.5 million spans a month at no charge. At a 10% sample
and staging traffic this stays far below it; raise the ratio while
investigating something, then lower it again.
