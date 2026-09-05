# Issue #1422 — PR 2: metered-action registry + unified /usage/summary + Usage & Billing page

Sprint 6 (production billing). Builds on PR 1 (#1441: reusable `CreditBalanceMeter` + Remix parity + RFC). Design of record: `docs/rfc/usage-billing.md`. **No live money** (Stripe deferred, #1421/#1193); artist 85%+ untouched.

## Canonical contract (both workers agree)

`GET /usage/summary` (JWT) →
```ts
{
  credits: {                       // = GenerationCreditsService.getBalance(userId), unchanged shape
    balanceCents: number;
    priceCentsPer30s: number;
    recentTransactions: { id; type; amountCents; reason; jobId; balanceAfterCents; createdAt }[];
  };
  limits: {
    kind: "lyria" | "remix_draft";
    label: string;                 // from the registry
    remaining: number;
    limit: number;
    windowSeconds: number;
    resetsAt: string | null;       // ISO; null when no requests in the window
  }[];
  plan: { tier: "free"; monthlyAllowanceCents: number | null };  // Free today; Artist Pro later
}
```

## WI-1 — Backend: registry + remix-queryable + endpoint  *(Opus-4.8-high)*
Files: new `backend/src/modules/credits/metered-actions.ts`; a new `usage` module (`usage.module.ts`, `usage.controller.ts`, `usage.service.ts`); `backend/src/modules/remix/remix-project.service.ts` (add a queryable getter); tests.

1. **Registry** `metered-actions.ts`:
   ```ts
   export type MeteredActionKind = "lyria" | "remix_draft";
   export interface MeteredAction { kind: MeteredActionKind; label: string; costUnitSeconds: number; rateLimit: { limit: number; windowMs: number; envKey: string }; }
   export const METERED_ACTIONS: Record<MeteredActionKind, MeteredAction> = {
     lyria:       { kind:"lyria",       label:"Track generation", costUnitSeconds:30, rateLimit:{ limit:50, windowMs:3_600_000, envKey:"STRIKE_RATE_LIMIT" } },
     remix_draft: { kind:"remix_draft", label:"AI remix draft",   costUnitSeconds:30, rateLimit:{ limit:10, windowMs:3_600_000, envKey:"REMIX_GENERATION_RATE_LIMIT" } },
   };
   ```
   These numbers must match the existing defaults (`generation.service.ts` DEFAULT_RATE_LIMIT=50 / STRIKE_RATE_LIMIT; `remix-project.service.ts` REMIX_GENERATION_RATE_LIMIT default 10). Keep the registry the single source but do NOT change the existing enforcement values.
2. **Remix rate-limit queryable.** Catalog already exposes `{ remaining, limit, resetsAt }` (assembled in `generation.service.ts:578-604`, surfaced by `GET /generation/analytics`). Remix (`remix-project.service.ts` `enforceRateLimit` ~392, limiter map + `rateLimitFromEnv` ~342) is enforce-only. Add a public method `getGenerationRateLimitStatus(userId): { remaining; limit; windowMs; resetsAt: Date | null }` that reads the SAME in-memory window state without mutating it (peek, don't record). Mirror how catalog computes remaining/resetsAt.
3. **UsageService + `GET /usage/summary`.** New `UsageModule` importing `CreditsModule`, `GenerationModule`, `RemixModule`; `UsageService` injects `GenerationCreditsService`, `GenerationService` (catalog rate-limit status getter), `RemixProjectService` (new getter); assembles the contract above from the registry. `UsageController` → `@Get("usage/summary")` JWT-guarded → `usageService.getSummary(req.user.userId)`. Register `UsageModule` in `app.module.ts`.
   - **CYCLE RISK (verify!):** importing Generation + Remix + Credits modules to inject their services. This class of cross-module cycle broke #1415. After wiring, run the AppModule boot check (`npx jest --config jest.integration.config.js --testPathPattern='health.integration'` with `ENCRYPTION_SECRET`/`JWT_SECRET` set, or `npm run build`) to confirm it resolves. If a cycle appears, break it: prefer reading the rate-limit status via the services' public getters only (no back-import), or move the shared limiter state behind a small provider. Do NOT introduce a cycle.
4. **Tests** (`*.integration.spec.ts`, Testcontainer Postgres, real prisma): `getSummary` returns the credits balance + both limits (with correct limit values from the registry) + `plan.tier==="free"`; remix limit getter reflects recorded generations; non-authed → 401 (controller http spec ok too). Seed a user; exercise the credit balance path.

## WI-2 — Frontend: Usage & Billing settings panel  *(Opus-4.8-high; codes against the contract above)*
Files: `web/src/lib/api.ts` (add `getUsageSummary` + types); new `web/src/components/settings/UsageBillingPanel.tsx`; `web/src/app/settings/page.tsx` (register the section); tests.

1. `api.ts`: add `UsageSummary` type (matching the contract) + `getUsageSummary(token)` → `GET /usage/summary`.
2. `UsageBillingPanel.tsx` — a settings panel (mirror the existing panel components under `web/src/components/settings/`, e.g. `NotificationPreferences`). Sections:
   - **Plan** — "Free" tier chip (+ "Artist Pro — coming soon" note).
   - **Credits** — reuse `CreditBalanceMeter` (panel variant) with the fetched balance + the operator-request affordance (reuse `requestGenerationCredits`); an "Auto-reload — coming soon" disabled affordance.
   - **Usage limits** — one row per `limits[]`: label, `remaining/limit`, a small bar, and "resets in …" from `resetsAt`.
   - **Usage history** — a table from `credits.recentTransactions` (type, reason, amount ¢, running balance, date). Keep concise; newest first.
   - Keep the two concepts (credits vs limits) visually separated per the RFC. Accessible + mobile-friendly (this is a fresh surface — apply `@media` where needed; verify no horizontal overflow at ≤400px by construction: no fixed-width rows).
3. `settings/page.tsx`: add a `"usage"` id to `SettingsSectionId` (:31), an entry to `SETTINGS_SECTIONS` (:33, label "Usage & Billing"), and a panel block (~:512) rendering `<UsageBillingPanel />` when `activeSection === "usage"`.
4. Tests (`.test.tsx`, Vitest + `renderToStaticMarkup` where possible): the panel renders plan/credits/limits/history from a mock `UsageSummary`; empty-history and zero-credit states render sanely.

## Verification (maestro runs)
- backend: `npm run lint`; `usage` integration spec; AppModule boot (no cycle).
- web: vitest for the panel + api; eslint; no new tsc errors.

## Docs
Update `docs/features/generation_credits.md` (the PR-1 "still tracked" note → shipped for registry/endpoint/page) + link. Mark the #1422 remaining items done as they land; keep Stripe deferred.
