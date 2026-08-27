# Resonate — AI Agent Coding Standards

Keep this root file limited to project-wide invariants. Load detailed procedures
from the named skills and directory-specific standards only when they apply.

## Configuration and secrets

- Never commit credentials, API keys, tokens, private keys, or service-account
  material. Secrets must come from environment variables or a secret manager and
  must not have source-code defaults.
- Deployment-specific URLs, ports, project IDs, bucket names, and similar values
  must come from centralized configuration. Documented localhost defaults are
  allowed for local development.
- Reuse canonical configuration constants; do not redeclare values such as
  `API_BASE` in individual files.
- Browser variables use `NEXT_PUBLIC_`; server and backend variables do not.
- Local defaults: backend `3000`, frontend `3001`, Demucs `8000`, Anvil `8545`,
  AA bundler `4337`.
- Document new application variables in `docs/deployment/environment.md` and the
  corresponding deploy configuration in `resonate-iac`. Keep
  `docs/smart-contracts/deployment.md` contract-focused.

## Business Model v2

Use these canonical sources:

- Strategy and sequencing: `docs/strategy/business-model-review-2026-07.md`
- Decisions ADR-BM-1…6: `docs/strategy/business-model-phase0-decisions.md`
- Fees, splits, and prices: `docs/rfc/business-model.md`

Never violate ADR-BM-4: no fan royalty-yield/income-share products; no
platform-subsidized payouts for free listening; listener payouts are pre-funded
and user-centric; artists receive at least 85% of each transaction, without
recoupment or minimum thresholds.

Any issue, RFC, PR, or implementation touching money, payouts, ingestion trust,
AI billing, collectibles, or licensing must state its ADR-BM-6 revenue line and
phase, or state that it is vision-neutral infrastructure/quality. Reconcile all
fee changes with the canonical RFC. New issues require `vision:core` or
`vision:keep`; challenge work that fits neither.

## Change completeness and documentation

- Before finishing a durable change, review
  `docs/engineering/change_impact_checklist.md` and report relevant effects or
  intentional deferrals in the PR.
- Durable feature changes must update `docs/features/README.md` and the relevant
  page under `docs/features/` in the same branch.
- User-visible changes must update the in-app User Guide when applicable. The
  frontend-specific instructions live in `web/AGENTS.md`.
- Partial delivery must leave durable tracking in an open parent issue, linked
  follow-up issues, a plan/roadmap, or a feature page marked `partial` or
  `in-progress`. Do not close a parent feature until it works end to end or all
  remaining slices are explicitly tracked.
- PR summaries for partial work must distinguish what shipped from what remains
  and explain the reason for deferral.

The `finish-issue` skill contains the complete documentation, validation, and
partial-delivery checklist; do not duplicate that procedure here.

## Git authorization and workflows

- Never commit or push directly to `main`; use a branch and PR targeting `main`.
- Never force-push to or delete `main`.
- Merge only after the developer explicitly says `merge` or equivalent.
- Keep related refinements on the current feature branch and PR until the user
  asks to finish or merge.

Use these project skills:

- New issue or durable task: `.agents/skills/start-issue/SKILL.md`
- Finish, verify, commit, push, PR, merge, and cleanup:
  `.agents/skills/finish-issue/SKILL.md`
- Milestone or sprint planning: use the `plan-milestone` skill from
  `codex-utilities@agent-toolkit`; never create or reassign milestone scope
  before explicit approval.
- Any security request: `.agents/skills/auditing-resonate-security/SKILL.md`

Skill architecture and runtime setup are documented in
`docs/engineering/agent-skills.md`.

## Validation and scoped standards

- Run focused tests and lint for touched packages. Use the risk-based validation
  policy in `finish-issue` before committing or publishing; do not run unrelated
  full suites by default.
- Backend testing and Prisma rules: `backend/AGENTS.md`
- Frontend UI, help content, and screenshot rules: `web/AGENTS.md`
- Smart-contract testing, verification, and deployment handoff:
  `contracts/AGENTS.md`
