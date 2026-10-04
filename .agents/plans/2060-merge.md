# Merge #2060 against Habit Mix main

Preserve request-first genre/mood ranking and the shared preset vocabulary from
#2059 while retaining all merged Habit Mix behavior. This is vision-neutral
quality under ADR-BM-6. No new spending, generation, or deployment authority.

1. Merge current main on the existing PR branch in an isolated worktree.
2. Worker owns only backend selector, deterministic adapter, ranking service,
   and request-ranking unit test conflicts/integration. Preserve both request
   terms and server-resolved My Mix inputs. Lane-local sessionRequest takes
   precedence over ordinary requestedTerms; apply at most one request boost.
   Use existing taste-policy multipliers so hidden/downranked signals cannot
   gain an ungoverned request boost. Test ordinary requests, lane precedence,
   policy downranking, and absence of requests. No publication authority.
3. Root reconciles the concise feature catalog, checks auto-merged callers,
   reviews security and integration, and updates PR validation details.
4. Focused ranking/adapter/My Mix unit tests; real sessions integration;
   backend lint; frontend preset/panel/vocabulary/help tests and lint. CI owns
   broader coverage. Publish conflict resolution and request merge queue after
   required CI passes. Preserve all unrelated worktrees and branches.

Maestro root Sol/medium and worker Luna/max routing preflights passed.

## Review and validation

Root reviewed the merged callers, request dispatch, preserved lane plan, policy
multipliers, preset vocabulary, guide and tests. Application/AI diff review
found no unresolved authorization, data exposure or tool/spending authority
issue. Changed-file secret-pattern scan and Markdown link checks passed.

Focused backend request/adapter/selector/My Mix checks passed (6 suites, 67
tests). Root real Testcontainer sessions, My Mix and runtime checks passed
(3 suites, 24 tests). Frontend preset/panel/guide checks passed (3 suites, 70
tests), as did changed-file ESLint and frontend TypeScript. Backend TypeScript
lint passed after local typing corrections. Fresh required CI owns full sweeps/build/E2E.
