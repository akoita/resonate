# Production Observability Contract

This contract defines the app-owned log events that infrastructure dashboards
and alert policies can consume without guessing field names.

## Required Log Envelope

Backend structured logs are one JSON object per line.

Required fields:

- `timestamp`: ISO-8601 timestamp.
- `service`: `resonate-backend`.
- `level`: `debug`, `info`, `warn`, or `error`.
- `severity`: the Cloud Logging severity for `level` (`DEBUG`, `INFO`,
  `WARNING`, `ERROR`), so Cloud Logging, Error Reporting and alert policies can
  rank entries. `level` is kept for existing consumers.
- `event`: stable event name.
- `message`: human-readable summary.
- `requestId`: value from `x-request-id` or a generated UUID when request-scoped.

Sensitive fields are redacted by key name before logging. This includes
authorization headers, cookies, secrets, tokens, API keys, private keys,
signatures, x402 payment proofs, emails, object URLs, and signed URLs.

Entries at `level: "error"` that carry a stack also include the Cloud Error
Reporting fields, so Error Reporting groups them without extra wiring:

- `stack_trace`: the stack, bounded to 8000 characters.
- `@type`: `type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent`.
- `serviceContext`: `{ "service": "resonate-backend" }`.

Any entry built from a caught `Error` also carries `errorClass` (the error class
name). The error message is never copied into a separate field; `message` is the
human text chosen by the caller.

## Framework Log Events

NestJS framework and service `Logger` output (`Logger.log/warn/error/...`) is
written through the same envelope as `event: "app.log"`, with `context` set to
the Nest logger name (for example `AgentSelectorService`). Non-string messages
are summarised in `message` and the redacted payload goes under `data`. The
format is selected by `LOG_FORMAT` (`json` or `pretty`); unset means pretty on an
interactive terminal and JSON otherwise, so deployed containers emit JSON. See
[Environment Variables](../deployment/environment.md).

## HTTP Request Event

`http.request.completed`

Fields:

- `requestId`
- `method`
- `path`
- `statusCode`
- `durationMs`
- `hasAuth`
- `paymentHeaderType`: `payment-signature`, `x-payment`, or `null`

The request path excludes query-string values.

## x402 Events

These events must never include payment proofs or facilitator credentials.

- `x402.challenge.issued`
- `x402.payment.verify_failed`
- `x402.payment.settled`
- `x402.payment.replay_accepted`
- `x402.payment.replay_rejected`
- `x402.payment.error`

Common fields:

- `requestId`
- `method`
- `path`
- `stemId`
- `statusCode` when the event maps to an HTTP response.
- `reason` for failed or rejected flows.

## Shows Escrow Indexer Lease Events

The distributed indexer ownership contract uses these stable events:

- `shows.escrow_indexer.lease_acquired`
- `shows.escrow_indexer.lease_takeover`
- `shows.escrow_indexer.lease_lost`
- `shows.escrow_indexer.lease_released`

Event-dependent bounded fields include `chainId`, `contractAddress`, `ownerId`,
`leaseEpoch`, `leaseExpiresAt`, `leaseTtlMs`, `cursorBlock`, `phase`, and an
optional `reason` or `errorClass`. These events must not contain transaction
hashes, campaign ids, or RPC payloads. `ownerId` and `contractAddress` remain
JSON log fields rather than metric labels so autoscaling cannot create unbounded
metric cardinality.

Infrastructure maps any `lease_lost` event to an operator alert and monitors
repeated acquisition/takeover events for ownership churn. The companion rollout
is tracked in [`akoita/resonate-iac#209`](https://github.com/akoita/resonate-iac/issues/209).

## Degraded Fallback Events

`degraded.fallback` is emitted wherever the backend silently falls back to a
degraded path while still answering the caller (for example the AI DJ LLM
runtime failing over to the deterministic ranker). These paths are invisible to
users and to error reporting by design, so each one emits a categorical event
at `level: "warn"` (`severity: "WARNING"`).

Fields:

- `component`: closed set, one of `agent_runtime.adk`, `agent_runtime.vertex`,
  `agent_runtime.langgraph`, `agent_runtime.remote_worker`, `embeddings.vertex`,
  `embeddings.provider`, `taste_profile`, `served_history`,
  `discovery_policy_context`.
- `reason`: bounded category matching `^[a-z][a-z0-9_]{0,47}$`; anything else is
  recorded as `other`. Values in use:
  - `agent_runtime.*` adapters: `not_configured`, `timeout`, `error`.
  - `agent_runtime.remote_worker`: `error`.
  - `embeddings.vertex`: `rate_limited` (HTTP 429), `upstream_unavailable`
    (HTTP 5xx), `http_error` (other non-OK statuses), `malformed_response`,
    `timeout`, `request_failed`.
  - `embeddings.provider`: `error`.
  - `taste_profile`, `served_history`: `unavailable`.
  - `discovery_policy_context`: `context_unavailable`,
    `prior_picks_unavailable`.
- `errorClass`: the error class name, when an `Error` was caught.

These events must not contain error messages, user ids, track ids, session ids
or any other free text; the existing `Logger.warn` line next to each call site
keeps the diagnostic detail. `component` and `reason` are bounded precisely so
they can be metric labels without creating unbounded cardinality.

Infrastructure turns `degraded.fallback` into a log-based metric and an alert.
The companion rollout is tracked in
[`akoita/resonate-iac#266`](https://github.com/akoita/resonate-iac/issues/266).

## Infrastructure Mapping

`resonate-iac` can turn these events into Cloud Logging log-based metrics for
payment health, challenge volume, replay rejection, and request-latency
dashboards. The first infrastructure slice should create platform dashboards
and leave app log-based metrics behind explicit variables until staging log
volume confirms the final thresholds.
