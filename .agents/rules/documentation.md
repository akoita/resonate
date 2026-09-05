# Documentation and feature completion

Paths in code spans are relative to the repository root.

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
   `/help` ([feature page](../../docs/features/user_manual.md); content in
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
     [feature page](../../docs/features/user_manual.md)).
   - The content-integrity test `web/src/lib/help/help.test.ts` must stay green:
     it guards unique slugs, valid related links, known categories/audiences,
     and that **every referenced screenshot file exists**.
   - Not every change needs a guide edit — pure internal, backend, infra, or
     refactor work with no user-visible effect usually does not.

6. **Use `/finish-issue` to enforce this.** The finish workflow includes the
   feature catalog **and User Guide** check alongside security scans, tests,
   commits, and PR work.


## Partial features

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
