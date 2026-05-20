# Production Observability Contract

This contract defines the app-owned log events that infrastructure dashboards
and alert policies can consume without guessing field names.

## Required Log Envelope

Backend structured logs are one JSON object per line.

Required fields:

- `timestamp`: ISO-8601 timestamp.
- `service`: `resonate-backend`.
- `level`: `debug`, `info`, `warn`, or `error`.
- `event`: stable event name.
- `message`: human-readable summary.
- `requestId`: value from `x-request-id` or a generated UUID when request-scoped.

Sensitive fields are redacted by key name before logging. This includes
authorization headers, cookies, secrets, tokens, API keys, private keys,
signatures, x402 payment proofs, emails, object URLs, and signed URLs.

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

## Infrastructure Mapping

`resonate-iac` can turn these events into Cloud Logging log-based metrics for
payment health, challenge volume, replay rejection, and request-latency
dashboards. The first infrastructure slice should create platform dashboards
and leave app log-based metrics behind explicit variables until staging log
volume confirms the final thresholds.

