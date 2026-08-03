# Resonate — AI Agent Coding Standards

> This file is read by AI coding assistants (GitHub Copilot, Gemini Code Assist, Claude, etc.)
> to enforce project-wide conventions. Keep it up to date.

## 🚨 No Hardcoded Configuration Values

**NEVER hardcode** URLs, ports, secrets, API keys, project IDs, bucket names, or any
environment-dependent values directly in source code.

### Rules

1. **Always use environment variables** with a sensible local-dev fallback:

   ```typescript
   // ✅ CORRECT
   const url = process.env.BACKEND_URL || "http://localhost:3000";

   // ❌ WRONG — hardcoded production/staging URL
   const url = "https://my-service-XXXXX.region.run.app";

   // ❌ WRONG — no env var at all
   const url = "http://localhost:3001/encryption/decrypt";
   ```

2. **Use centralized constants** — don't redeclare `API_BASE` in every file:

   ```typescript
   // ✅ Import from the canonical source
   import { API_BASE } from "@/lib/api";

   // ❌ Don't redeclare per-file
   const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
   ```

3. **Port conventions** — local dev defaults must use the correct port:
   - Backend (NestJS): `3000`
   - Frontend (Next.js): `3001`
   - Demucs Worker: `8000`
   - Anvil (local chain): `8545`
   - AA Bundler: `4337`

4. **Never commit secrets** — API keys, JWT secrets, private keys, and service account
   credentials must come from environment variables or secret managers, never from source.

### Environment Variable Naming

| Layer              | Prefix         | Example                                |
| ------------------ | -------------- | -------------------------------------- |
| Frontend (browser) | `NEXT_PUBLIC_` | `NEXT_PUBLIC_API_URL`                  |
| Frontend (server)  | none           | `BACKEND_URL`                          |
| Backend            | none           | `STORAGE_PROVIDER`, `GCS_STEMS_BUCKET` |

### Required Environment Variables

Document any new app env var in `docs/deployment/environment.md` and the
relevant deploy configuration in `resonate-iac`. Keep
`docs/smart-contracts/deployment.md` focused on contract deployment and
contract-adjacent local workflows.

---

## 🧭 Change Impact Checklist

Before finishing durable product, API, backend, frontend, analytics, protocol,
or deployment work, review `docs/engineering/change_impact_checklist.md`.

This guide captures the senior-maintainer review that prevents narrow fixes
from forgetting related product consequences: analytics/events, API contracts,
privacy and permission boundaries, moderation, lifecycle state, notifications,
feature docs, architecture docs, deploy configuration, and validation scope.

If a change adds or modifies meaningful user behavior, backend domain events,
social/community state, marketplace lifecycle state, agent-facing contracts, or
artist/listener controls, the PR summary should explicitly mention the relevant
checklist sections and any intentionally deferred follow-up.

---

## 💰 Business Model Conformance

Resonate's monetization direction is governed by **Business Model v2**:

- Vision, sequencing & roadmap: `docs/strategy/business-model-review-2026-07.md`
- Decisions ADR-BM-1…6: `docs/strategy/business-model-phase0-decisions.md`
  (tracked by epic [#1332](https://github.com/akoita/resonate/issues/1332))
- Canonical fee/split numbers: `docs/rfc/business-model.md`

### Rules

1. **Red lines (ADR-BM-4) — never violate in any issue, RFC, or PR:**
   - no royalty-yield or income-share products for fans (securities/Howey);
   - no platform-subsidized payouts on free listening (there is no pro-rata
     pool to drain, so stream fraud is unprofitable — keep it that way);
   - listener-side payouts are pre-funded and user-centric only;
   - artist receives 85%+ of every transaction; no recoupment, no minimum
     thresholds.

2. **State the revenue line and phase.** Any new issue, RFC, or PR touching
   money, fees, payouts, upload/ingestion trust, AI-generation billing,
   collectibles, or licensing must state which revenue line it serves —
   (1) Shows campaign fees, (2) Artist Pro + generation credits,
   (3) marketplace take-rate, (4) Listener Pro, (5) B2B/agent licensing — and
   its phase per ADR-BM-6, or explicitly state that it is vision-neutral
   (infra/quality).

3. **Fee numbers live in one place.** Once an ADR is accepted,
   `docs/rfc/business-model.md` is the single canonical source for fees,
   splits, and prices. Never introduce a new fee, split, or price in code or
   docs without reconciling it there.

4. **Vision labels.** Open issues carry `vision:core` (directly serves a
   revenue line) or `vision:keep` (conformant / vision-neutral) from the
   2026-07 triage (`docs/strategy/issue-triage-2026-07.md`). Label new issues
   on creation; an issue that fits neither label should be challenged before
   work starts.

---

## 📚 Feature Catalog & Documentation Updates

`docs/features/README.md` is the canonical human-readable catalog of Resonate
features. Developers and agents should be able to discover what exists, what is
partial/planned/retired, who it is for, and how to use or test it without
reading the whole codebase.

### Rules

1. **Update the feature catalog for durable feature work.** When adding,
   materially changing, exposing, hiding, or removing a user-facing,
   developer-facing, API-facing, agent-facing, or protocol-facing feature:
   - Update `docs/features/README.md`
   - Add or update the feature's dedicated page under `docs/features/`

2. **Feature pages must be practical.** A feature page should include:
   - current status (`implemented`, `partial`, `in-progress`, `planned`, or `retired`)
   - who the feature is for
   - what value it provides
   - how to use it as an end user, developer, or agent/API consumer
   - relevant UI routes, API endpoints, env vars, events, services, and tests
   - links to deeper RFCs, architecture docs, issues, PRs, and code references

3. **Keep RFCs and feature docs distinct.**
   - RFCs explain design intent, alternatives, and future architecture.
   - Feature pages explain the current product/platform capability and how to
     use or verify it today.

4. **Update docs in the same branch as code.** Do not leave feature catalog
   updates for a later cleanup PR unless the user explicitly scopes the work to
   code only.

5. **Update the in-app User Guide for user-facing changes.** The User Guide at
   `/help` ([feature page](docs/features/user_manual.md); content in
   `web/src/lib/help/content.ts`) is the end-user manual. When a change adds,
   materially changes, exposes, hides, or removes something a **listener,
   artist, producer, curator, or operator can see or do**, update or add the
   matching article **in the same branch**:
   - Write in plain language — no contract names, API routes, or DB details.
   - Keep `keywords`, `appLinks` (in-app deep links), `related`, and `status`
     accurate; mark `partial`/`coming-soon` honestly.
   - Illustrate with a screenshot when a public or signed-in screen exists, and
     refresh images via `web/scripts/capture-help-screenshots.mjs` (it captures
     public surfaces from staging and signed-in shells via mock auth — see the
     [feature page](docs/features/user_manual.md)).
   - The content-integrity test `web/src/lib/help/help.test.ts` must stay green:
     it guards unique slugs, valid related links, known categories/audiences,
     and that **every referenced screenshot file exists**.
   - Not every change needs a guide edit — pure internal, backend, infra, or
     refactor work with no user-visible effect usually does not.

6. **Use `/finish-issue` to enforce this.** The finish workflow includes the
   feature catalog **and User Guide** check alongside security scans, tests,
   commits, and PR work.

---

## 🧩 No Silent Partial Features

Resonate can ship large features in slices, but unfinished work must never live
only in memory, chat history, or vague PR prose.

### Rules

1. **A partial implementation must leave durable tracking.** Before finishing a
   PR that implements only part of a feature, make sure the remaining work is
   captured in at least one durable place:
   - the parent GitHub issue remains open with an explicit remaining-work
     checklist;
   - separate follow-up issues are created and linked from the parent issue/PR;
   - a feature plan or roadmap doc lists remaining slices with statuses;
   - the feature catalog marks the capability as `partial` or `in-progress` and
     links to the tracking source.

2. **Do not close or claim completion for a parent feature unless it is actually
   usable end to end.** If the PR only ships a backend contract, data model,
   UI shell, analytics foundation, or operator-only slice, describe it as a
   slice and keep the full feature tracked.

3. **PR summaries must distinguish shipped behavior from remaining work.** Use
   clear language such as "Implemented in this PR" and "Remaining / deferred",
   with issue links when follow-ups exist.

4. **Deferred work needs an owner-visible reason.** Acceptable reasons include
   risk reduction, dependency ordering, CI/runtime cost, product sequencing, or
   explicit developer scope. Avoid vague deferrals like "later" without a
   linked checklist or issue.

5. **Apply this especially to complex systems.** Community/social features,
   analytics, recommendations, marketplace lifecycle, protocol/contracts,
   deployment, moderation, permissions, and artist/listener controls should all
   have visible completion boundaries and follow-up tracking.

---

## 🚨 Git Workflow — Branch & PR Only

**NEVER push directly to `main`.** All changes must go through a feature branch and Pull Request.

### Rules

1. **Always work on a branch** — use the naming conventions:
   - `feat/<issue-number>-<short-description>` for features
   - `fix/<issue-number>-<short-description>` for bug fixes
   - `docs/<issue-number>-<short-description>` for documentation

2. **Submit a Pull Request** targeting `main` — include a clear description and reference the issue (`Closes #N`).

3. **Merge only on explicit developer request** — never merge a PR autonomously. Wait for the developer to say "merge", "you can merge", or equivalent.

4. **Never force-push to `main`** — only force-push on feature branches if absolutely necessary.

5. **Clean up after merge** — delete the feature branch (local + remote) and align local `main`.

6. **Use the `/start-issue` workflow** when beginning work on any issue or task (features, fixes, improvements, etc.). Run the steps in `.agents/skills/start-issue/SKILL.md` to create the branch, track work, and open the PR scaffold.

7. **Use the `/finish-issue` workflow** when completing work on an issue. Run the steps in `.agents/skills/finish-issue/SKILL.md` to verify, test, commit, push, create PR, merge, and clean up. This ensures security scans are executed and no steps are skipped.

---

## 🧰 Agent Skills & Workflows

Everything an agent can invoke is a skill: `.agents/skills/<name>/SKILL.md`, where
`<name>` is kebab-case and **must equal** the `name:` field
([Agent Skills spec](https://agentskills.io/specification)). That includes the
`start-issue` and `finish-issue` procedures. There is one source per skill; each
runtime reaches it differently:

- **Claude Code** — `.claude/skills` symlinks `.agents/skills`, so skills auto-load.
- **Codex** — no project-skill auto-discovery. `AGENTS.md` is the file Codex always
  reads, so it must name the skill path: for any security request, read
  `.agents/skills/auditing-resonate-security/SKILL.md` first and follow its routing.
- **Gemini / Antigravity** — `.gemini/commands/*.toml` `@{...}`-include the same files.

`CLAUDE.md` and `GEMINI.md` are symlinks to this file.

Security methodology is **not** kept in this repo: it lives in the shared
[`agent-toolkit`](https://github.com/akoita/agent-toolkit) security plugin
(`security@agent-toolkit` on Claude Code, `codex-security@agent-toolkit` on Codex).
Start from `.agents/skills/auditing-resonate-security/`,
which carries the Resonate stack, threat surface, and house rules and routes to the
right upstream skill.

Full model, install commands, and the local/CI lifecycle:
[`docs/engineering/agent-skills.md`](docs/engineering/agent-skills.md).

---

## Scoped Standards

Standards that only apply inside one directory live there, so they load when
an agent works in that directory instead of in every session. Each follows the
same convention as this file: `AGENTS.md` is the real file, with `CLAUDE.md`
alongside it as a symlink.

- Backend testing standards (Testcontainers, file naming, seeding rules):
  [`backend/AGENTS.md`](backend/AGENTS.md).
- Smart contract testing, verification, and deployment-handoff standards:
  [`contracts/AGENTS.md`](contracts/AGENTS.md).

---

## Code Quality

- Run `npm run lint` in both `backend/` and `web/` before committing
- Prisma schema changes require `npx prisma generate` and migration
- Use `window.confirm()` sparingly — prefer `ConfirmDialog` React component for UX consistency
- Test files go in `backend/src/tests/` — use `.integration.spec.ts` for DB-dependent tests, `.controller.http.spec.ts` for HTTP contract tests, `.spec.ts` for pure unit tests
