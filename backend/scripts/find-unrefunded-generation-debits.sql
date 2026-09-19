-- #1778: find generation-credit debits that were never refunded, so the users
-- overcharged by the broken terminal-failure path can be made whole.
--
-- Context: the catalog generation processor tested `attemptsMade` against the
-- attempt limit inside its catch block. BullMQ v5 increments that counter only
-- after a job completes or fails, so the condition was false on every attempt
-- and no terminally failed catalog generation ever refunded. Fixed in #1778;
-- this query finds the debits left behind before the fix.
--
-- WHAT THIS DOES NOT DO: the credit ledger records charges, not job outcomes,
-- so this cannot prove a job failed. It returns debits with no matching refund,
-- which is a CANDIDATE set containing three populations:
--
--   1. successful generations  — a debit with no refund is entirely correct
--   2. jobs still in flight    — excluded by the age cutoff below
--   3. terminally failed jobs  — the ones to refund
--
-- Separating (1) from (3) needs the job history, which lives in Redis/BullMQ and
-- in the worker logs, not in Postgres. Cross-check each candidate before
-- refunding: a successful generation produced a track, and a failed one did not.
-- GenerationCostRecord is written on the paths that ran, so its absence for a
-- jobId is a useful (not conclusive) signal.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v cutoff_hours=24 -v since='2026-07-01' \
--     -f backend/scripts/find-unrefunded-generation-debits.sql
--
-- `cutoff_hours` must exceed the worst-case retry window (3 attempts with
-- exponential backoff from 5s, plus job runtime). 24h is generous on purpose.
-- `since` should be the date the metered path shipped (#1334).

\set cutoff_hours :cutoff_hours
\set since :since

SELECT
  d."userId",
  d."jobId",
  d."amountCents",
  d."reason",
  d."createdAt"                                   AS debited_at,
  (cr."jobId" IS NOT NULL)                        AS cost_record_exists,
  cr."path"                                       AS generation_path
FROM "GenerationCreditTransaction" d
LEFT JOIN "GenerationCreditTransaction" r
  ON  r."userId" = d."userId"
  AND r."jobId"  = d."jobId"
  AND r."type"   = 'refund'
LEFT JOIN "GenerationCostRecord" cr
  ON  cr."jobId" = d."jobId"
WHERE d."type"   = 'debit'
  AND d."jobId" IS NOT NULL
  -- the catalog/Lyria path only. Remix generation refunds through its own
  -- processor and is not affected by this defect.
  AND d."reason" = 'lyria_generation'
  AND r."id" IS NULL
  AND d."createdAt" <  now() - (:'cutoff_hours' || ' hours')::interval
  AND d."createdAt" >= :'since'::timestamptz
ORDER BY d."createdAt";

-- Totals, for the issue's closing evidence.
SELECT
  count(*)                    AS candidate_debits,
  count(DISTINCT d."userId")  AS affected_users,
  sum(d."amountCents")        AS total_cents
FROM "GenerationCreditTransaction" d
LEFT JOIN "GenerationCreditTransaction" r
  ON  r."userId" = d."userId"
  AND r."jobId"  = d."jobId"
  AND r."type"   = 'refund'
WHERE d."type"   = 'debit'
  AND d."jobId" IS NOT NULL
  AND d."reason" = 'lyria_generation'
  AND r."id" IS NULL
  AND d."createdAt" <  now() - (:'cutoff_hours' || ' hours')::interval
  AND d."createdAt" >= :'since'::timestamptz;

-- Refunding a confirmed case goes through the reconciliation command rather
-- than SQL or the generic grant endpoint, so the ledger keeps its
-- balanceAfterCents invariant and the refund stays idempotent per jobId:
--
--   npm run credits:reconcile-generation-refunds -- --apply \
--     --confirmed-failed-job <job-id>
--
-- Live results and affected accounts are deployment information: record them
-- in the private infrastructure tracker, not in this public repository.
