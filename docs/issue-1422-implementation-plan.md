# Issue #1422 — Coherent, extensible Usage & Billing surface

**Sprint:** Vision Sprint 6 (production billing). **Revenue line:** (2) generation credits (ADR-BM-6). **Guardrail:** NO live fiat — Stripe buy/auto-reload deferred (blocked on #1421 pricing + #1193 Stability registration). Artist 85%+ untouched (ADR-BM-4).

## Two concepts (keep separate, per the issue)
- **Credits** — buyable USD-cent balance spent per action. `GET /credits/balance` → `{ balanceCents, priceCentsPer30s, recentTransactions[{id,type,amountCents,reason,jobId,balanceAfterCents,createdAt}] }`. Kinds: `lyria`, `remix_draft` (`generation-credits.service.ts:36`). Cost = `ceil(sec/30)·price`.
- **Usage limits** — time-window rate quotas. Catalog: 50/hr, **queryable** (`GET /generation/analytics` → `rateLimit{remaining,limit,resetsAt}`). Remix: 10/hr (`REMIX_GENERATION_RATE_LIMIT`), **enforce-only** (429, not queryable).

## Staged delivery
### PR 1 (this sprint, no new backend endpoint) — reusable meter + Remix parity + RFC
- **WI-A (maestro): RFC** `docs/rfc/usage-billing.md` — the full design (two concepts, metered-action registry, component + endpoint contract, page IA, deferred Stripe layers). Written alongside PR 1.
- **WI-B (Opus-high worker): reusable credit meter + Remix parity.** Files: `web/src/lib/credits.ts` (new), `web/src/components/credits/CreditBalanceMeter.tsx` (new), `web/src/app/create/CreatePageContent.tsx`, `web/src/components/remix/RemixStudioEditor.tsx`, tests.
  1. Extract `formatCreditCapacity` (currently `CreatePageContent.tsx:39-57`) into `web/src/lib/credits.ts` as a pure, unit-tested util (keep the exact "≈ X min · Y tracks" + empty/low semantics). Import it back into CreatePageContent (behavior-preserving).
  2. New **`CreditBalanceMeter`** component: props `{ balance: GenerationCreditBalance | null; loading?: boolean; onRequestCredits?: () => void; requesting?: boolean; variant?: "strip" | "panel" }`. Renders capacity ("≈ X min · Y tracks"), an empty/low state ("0 — top up"), a raw-cents tooltip, and — when `onRequestCredits` given and balance is empty/low — the "Request credits from an operator" affordance (lift the pattern from `CreatePageContent.tsx:546-559`). PURE presentational (takes balance as a prop) so it's testable via `renderToStaticMarkup`; the parent owns fetching.
  3. Create page: replace the hand-rolled Credits cell (`:440-456`) with `<CreditBalanceMeter variant="strip" .../>`, wiring the existing `credits` state + `handleRequestCredits`. Keep the Generations/Rate-Limit/Resets cells as-is (those are the usage-limit half; the RFC notes unifying them in PR 2). No behavior change.
  4. **Remix Studio parity:** in `RemixStudioEditor.tsx`, fetch `getCreditsBalance(token)` (on mount + after a generate completes), render `<CreditBalanceMeter variant="panel" .../>` near the Draft-status/Generate area, and — because the remix debit happens in a **worker** (no synchronous 402 reaches the studio, `remix-project.service.ts:1192`) — show the out-of-credits state proactively (balance empty → surface the request-credits affordance; optionally disable Generate when `balanceCents < a single 30s block`). Add a `credits`/`remix_draft` case to `generationErrorMessage` (`:399`) for completeness.
  5. Tests (Vitest): `credits.test.ts` for `formatCreditCapacity`; `CreditBalanceMeter.test.tsx` (renderToStaticMarkup: capacity shown, empty state + request affordance, nothing when no balance).

### PR 2 (next sprint slice, tracked) — registry + unified endpoint + dedicated page
- Backend **metered-action registry** (`kind → {label, cost model, optional rate-limit window}`) as the single source, referenced by the debit + rate-limit sites; make the **remix rate-limit queryable** (mirror catalog's `remaining/limit/resetsAt`); new **`GET /usage/summary`** aggregating credits + per-kind limits + plan tier.
- Dedicated **Usage & Billing page** — new `/usage` route (mirroring `/wallet`, kept distinct from the crypto vault) OR a `SETTINGS_SECTIONS` panel (`settings/page.tsx:33`): plan tier (Free placeholder), credits + operator-request, usage limits, ledger/history table. Read-only; buy-credits shows the operator path + "auto-reload coming soon".
- Track as a follow-up issue/checklist under #1422.

## Verification (maestro runs)
- web: `npx vitest run src/lib/credits.test.ts src/components/credits` + existing `create`/`remix` tests; eslint on changed files; no new tsc errors. Manual: Create page Credits cell unchanged; Remix Studio shows a balance.

## Change-impact
- Revenue line (2); no fee/price change (reuses `priceCentsPer30s`). No live money. New reusable component + Remix parity are additive. Feature docs (`generation_credits.md`) + the RFC updated. Analytics: reuse existing `generation.credits_*` events (no new events in PR 1).
