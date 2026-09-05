# x402 `refund_due` Reconciliation Runbook

This is the cold-start guide for reconciling **refunds owed on paid Punchline
moment collects** (#1506, follow-up to #1462). It is written for an operator who
has not touched this flow in months.

## What `refund_due` means

Paid Punchline moment collects settle on the x402 personal rail: the fan's
Resonate passkey wallet transfers USDC to the single payout address, the backend
verifies the on-chain transfer, and then grants the edition **and** records an
`X402Settlement` row in one transaction.

Occasionally a payment verifies on-chain but the edition can no longer be
allocated — the moment sold out or the fan already owns it, in the race window
between quote and settle. The rail then **fails closed**: no edition is granted,
and the settlement is recorded with:

- `status = "refund_due"`
- `contractSettlementReason = "paid_but_unfulfilled:<reason>"` (`sold_out` or
  `already_collected`)

The fan paid real money and received nothing, so **they are owed an out-of-band
refund**. Resonate does not move funds automatically here; refunds are a manual,
human-verified step. The `refund_due` settlement row is the durable, immutable
record of the debt.

## The alert

A watchdog sweeps for `refund_due` settlements that have sat unresolved too long
and publishes one aggregate `x402.refund_due_stale` domain event per sweep. The
notification service fans that out to every configured operator/admin wallet in
the in-app NotificationBell, with a message like:

> N paid collect(s) awaiting manual refund — oldest Xh. See the x402 refund
> runbook.

If you see this notification, work the queue below.

Tuning env vars (documented in `docs/deployment/environment.md`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `X402_REFUND_DUE_ALERT_INTERVAL_MS` | `900000` (15 min) | How often the watchdog sweeps. |
| `X402_REFUND_DUE_ALERT_AFTER_HOURS` | `2` | How old a `refund_due` row must be before it alerts. |

## List what is owed

Operator/admin JWT required (same role gate as the other money routes).

```
GET /admin/x402-refunds
```

Returns every `refund_due` settlement, oldest first, each shaped as:

| Field | Use |
| --- | --- |
| `id` | Settlement id — you pass this back to mark it refunded. |
| `receiptId` | Immutable receipt id issued to the fan. |
| `payerAddress` | The wallet to refund. |
| `paymentTransactionHash` | The original payment tx (verify the inbound USDC). |
| `settlementAmount` | Exact amount to send back (e.g. `1.50`). |
| `settlementAmountUnits` | Same amount in token base units (e.g. `1500000`). |
| `paymentAssetSymbol` | Asset to send (e.g. `USDC`). |
| `canonicalAmountUsd` | USD value for bookkeeping. |
| `momentId` / `momentTitle` | Which moment the fan tried to collect. |
| `reason` | `paid_but_unfulfilled:sold_out` or `:already_collected`. |
| `ageHours` | How long the fan has been waiting. |

### Direct psql equivalent

If you have database access instead of an operator JWT:

```sql
SELECT
  s.id,
  s."receiptId",
  s."payerAddress",
  s."paymentTransactionHash",
  s."settlementAmount",
  s."paymentAssetSymbol",
  s."canonicalAmountUsd",
  s."momentId",
  m.title AS moment_title,
  s."contractSettlementReason" AS reason,
  s."createdAt",
  ROUND(EXTRACT(EPOCH FROM (now() - s."createdAt")) / 3600, 2) AS age_hours
FROM "X402Settlement" s
LEFT JOIN "PunchlineMoment" m ON m.id = s."momentId"
WHERE s.status = 'refund_due'
ORDER BY s."createdAt" ASC;
```

## Refund procedure

For each outstanding row:

1. **Confirm the debt.** On the block explorer, confirm
   `paymentTransactionHash` shows the fan's inbound USDC transfer of
   `settlementAmount` to the x402 payout wallet. Confirm no edition was granted
   (the fail-closed path never grants).
2. **Send the refund.** From the payout wallet, send **exactly**
   `settlementAmount` of `paymentAssetSymbol` (e.g. `1.50 USDC`) back to
   `payerAddress`, on the same network as the original payment.
3. **Verify on the explorer.** Confirm the refund transfer succeeded and note
   its transaction hash.
4. **Record it.** Mark the settlement refunded with the refund tx hash:

   ```
   POST /admin/x402-refunds/:id/mark-refunded
   Content-Type: application/json

   { "refundTxHash": "0x<66-char-refund-tx-hash>" }
   ```

   This validates the hash, flips `status` from `refund_due` to `refunded`, and
   stores `refundTxHash` + `refundedAt`. It never mutates the stored `receipt`
   JSON — that stays the immutable receipt as issued. The route rejects with a
   `409` if the row is not `refund_due` (e.g. already refunded), so a
   double-submit cannot overwrite a prior refund.

Once marked, the row leaves the `refund_due` list and stops triggering the
stale-refund alert.

## Notes

- Operator/admin wallets come from `OPERATOR_ADDRESSES` / `ADMIN_ADDRESSES`. If
  neither is configured, the stale alert logs a warning and notifies nobody —
  make sure at least one is set in each deployment.
- Refund transaction hashes must be `0x`-prefixed 32-byte (66-char) hex.
- This flow is intentionally manual and low-volume: paid-but-unfulfilled races
  are rare. If the queue grows, investigate whether editions are being oversold
  upstream rather than automating refunds.
