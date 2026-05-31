# Change Impact Checklist

This guide is for maintainers, contributors, and agents making durable changes
to Resonate. The codebase has grown into a product platform: a small feature
change can affect analytics, privacy, moderation, docs, deployment, and future
agent surfaces. Read this before changing a feature you do not already fully
understand.

The goal is not bureaucracy. The goal is to avoid shipping local fixes that
quietly break product truth elsewhere.

## Maintainer Principles

1. Treat every durable change as cross-functional.
   Backend truth, frontend state, analytics, privacy boundaries, tests, and
   feature docs often need to move together.

2. Preserve the product contract, not only the TypeScript contract.
   A change can compile and still be wrong if the UI copy, analytics, owner
   visibility, or lifecycle semantics now tell a different story.

3. Prefer explicit state over implicit interpretation.
   If a listing expires, a room is locked, a benefit is redeemed, or a campaign
   changes status, make that state visible in the correct owner/operator/user
   surfaces instead of relying on hidden filters.

4. Keep privacy and consent ahead of growth.
   Do not expose wallet ownership, listening taste, support history, location,
   social messages, or moderation state unless the relevant feature docs and UI
   controls explicitly allow it.

5. Instrument behavior that the product will need to learn from.
   If a user or service performs a meaningful action, ask whether analytics
   should capture a compact, privacy-safe event.

6. Keep local validation focused and CI broad.
   Run the tests that prove the changed slice. Defer expensive full sweeps to
   CI unless the change touches shared foundations or production safety.

## Change Impact Review

Before finishing a branch, review the relevant sections below. In the PR body,
briefly call out the sections that were relevant and any intentionally deferred
work.

### Product And UX

Ask:

- Does this change add, remove, hide, rename, or materially alter a user-facing
  capability?
- Are loading, empty, denied, unauthenticated, success, error, and stale states
  represented?
- Does the UI explain why an action is unavailable without making dead actions
  feel primary?
- Is there a standard navigation entry point for the new surface?
- Does copy remain accurate for listeners, artists, operators, and agents?

Update when relevant:

- feature page under `docs/features/`
- `docs/features/README.md`
- route-level or component tests
- screenshots/manual QA notes for visual polish changes

### API And Client Contract

Ask:

- Is there a stable backend endpoint, schema, or response version?
- Does the frontend use a typed API helper instead of ad hoc fetch calls?
- Are authenticated and public reads clearly separated?
- Are errors actionable and safe to expose?
- Does any external agent, x402, MCP, storefront, or public API surface need the
  same state?

Update when relevant:

- backend controller/service tests
- frontend API tests
- architecture docs for new routes or data flows
- OpenAPI/API docs if the endpoint is public or agent-facing

### Analytics And Events

Ask:

- Is this a meaningful product action, lifecycle transition, or backend domain
  event?
- Should it be emitted by the backend `EventBus`, frontend product analytics, or
  both?
- If a backend domain event is emitted, is it typed in
  `backend/src/events/event_types.ts`?
- Is it bridged in
  `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts` with
  compact payload fields only?
- If frontend product analytics is used, is the event accepted by the analytics
  controller allow-list?
- Are privacy tier, consent basis, subject, actor, and source refs correct?
- Are free text, raw prompts, message bodies, wallet holdings, and private
  ownership details excluded?

Update when relevant:

- analytics bridge config and tests
- analytics controller allow-list and tests
- analytics taxonomy docs
- feature docs listing emitted events
- dashboard/reporting backlog if the event is not yet surfaced

Examples:

- Adding a community room join should emit and bridge `community.room_joined`.
- Adding a hidden profile setting should emit a visibility/settings event, not
  raw profile text.
- Adding a marketplace lifecycle state should emit state-transition events and
  keep public and owner views consistent.

### Permissions, Privacy, And Trust Boundaries

Ask:

- Who is allowed to read, create, update, delete, moderate, or redeem this
  object?
- Is the server enforcing authority rather than trusting the client?
- Are public reads redacted by default?
- Does the feature leak wallet ownership, payout addresses, support history,
  private taste signals, or room membership?
- Does an artist/operator/admin path need a different authorization rule from a
  listener path?
- Does an agent or external client get a narrower capability than the web app?

Update when relevant:

- authorization tests
- redaction tests
- security report notes
- architecture boundary docs

### Moderation, Abuse, And Removal

Ask:

- Does this feature create user-generated content, social interaction, reports,
  public identity, or economic incentives?
- Can users report, remove, leave, block, pause, ban, or appeal where needed?
- Are destructive actions auditable?
- Is rate limiting needed before public launch?
- Does AI-generated or user-generated content need review policy hooks?

Update when relevant:

- moderation service/controller tests
- abuse/security notes
- feature docs with removal/reporting behavior
- analytics for reports and moderation actions

### Data Lifecycle And Operational State

Ask:

- Does this create a state that can expire, become stale, be reconciled, be
  retried, or be cancelled?
- Is there a scheduler, reconciliation path, or derived lifecycle status?
- Are public discovery surfaces and owner/operator management surfaces
  consistent?
- Should users be notified before or after a lifecycle transition?
- Does idempotency matter?

Update when relevant:

- lifecycle service tests
- notification schema/preferences
- owner/admin UI
- reconciliation jobs
- docs for state semantics

### Deployment, Configuration, And Environment

Ask:

- Did this add a URL, port, bucket, project ID, chain ID, contract address,
  feature flag, API key, or runtime mode?
- Is it configured through environment variables or centralized constants?
- Is the new env var documented?
- Does infrastructure or deploy config need the same setting?
- Does local dev still have a safe fallback?

Update when relevant:

- `docs/deployment/environment.md`
- infrastructure/deploy config
- app config tests
- `AGENTS.md` if a new project-wide convention exists

### Documentation And Roadmap Alignment

Ask:

- Does the implementation match the issue, plan, RFC, and architecture docs?
- Did the feature status change from planned to partial/in-progress/implemented?
- Does the feature catalog tell a future developer where the code, routes,
  events, tests, and docs live?
- Are TODOs explicit follow-up work rather than hidden gaps?
- If the issue acceptance criteria are narrower than a linked plan slice, has
  the remaining work been marked `partial`, `deferred`, or `planned` with a
  linked follow-up issue?

Update when relevant:

- `docs/features/README.md`
- dedicated feature page
- architecture docs
- RFC only when design intent or tradeoffs changed
- GitHub issue checklists or PR summary
- linked plan docs and follow-up issues for any intentionally deferred scope

### Tests And Validation Scope

Ask:

- Which focused tests prove the changed behavior?
- Did the change touch shared runtime behavior, auth, analytics, payment,
  contracts, migrations, or build boundaries?
- Is a full local suite useful, or should CI own the expensive sweep?
- Are slow tests caused by this change or by existing test infrastructure?

Use:

- focused unit/component/API/controller tests for the changed slice
- integration tests only for real persistence or infrastructure behavior
- `git diff --check`
- package-level lint/type/build checks when route, API, or build boundaries
  changed

Document:

- exact local commands run
- skipped expensive checks and why CI covers them
- known validation-speed issues discovered while working

## Common Change Patterns

### Adding A Community Or Social Action

Check:

- server authority for read/write/moderation
- membership and visibility redaction
- report/delete/leave/ban behavior where needed
- backend domain event and analytics bridge
- frontend product analytics only for UI-specific behavior
- docs for off-chain state and privacy boundary

### Adding A Marketplace Lifecycle State

Check:

- public discovery versus owner management behavior
- derived versus persisted state
- reconciliation or scheduler needs
- notifications and preferences
- relist/renew/cancel paths
- analytics for transitions and owner actions

### Adding A Player Or Recommendation Action

Check:

- action availability contract
- unavailable copy and disabled analytics behavior
- taste-memory or listener-control interactions
- product analytics impressions/selections
- backend effects, if any, are idempotent

### Adding An Artist-Facing Dashboard Or Control

Check:

- artist/operator authorization
- empty/no-artist/no-data states
- aggregate thresholds for analytics
- no raw listener identity leakage
- feature docs and route discoverability

### Adding An Authenticated Endpoint

Check:

- JWT guard and role/ownership checks
- public alternative, if needed, returns redacted state
- frontend API helper and tests
- controller HTTP contract tests
- analytics/security implications

## PR Summary Prompt

When opening or updating a PR, include a short impact note:

```text
Change impact:
- Product/UX: ...
- API/contract: ...
- Analytics/events: ...
- Privacy/moderation: ...
- Docs: ...
- Validation: ...
```

If a category is not relevant, say so briefly. Silence is how gaps hide.
