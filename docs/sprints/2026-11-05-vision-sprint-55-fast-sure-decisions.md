# Vision Sprint 55: Fast, sure decisions

**Status:** 🟡 Approved by the owner on 2026-11-05. Follows Sprint 54, which
is still in progress.
**Milestone:** [Vision Sprint 55](https://github.com/akoita/resonate/milestone/53).
Each item is a sub-issue of epic #2580.
**Goal:** The AI DJ understands a listener's request through a structured
decision call (choice, predicate or score) that is at least as accurate as
today's model-assisted parser, faster at p95, and never fails open, with the
same deterministic fallback.

## Why this theme

- **The shape is already there.** Every model call in the backend runs behind
  a `*_STRATEGY` flag (`deterministic` or `model-assisted`), sends bounded
  JSON, validates the answer field by field and falls back to deterministic
  code. Decision models (OpenAI Decisions API, Microsoft Decision 1, Jev)
  return exactly that kind of answer, so they can be a third strategy without
  changing callers.
- **We can measure it.** `backend/src/tests/dj_filter_eval/` already holds
  parser cases, a grader and baselines (`parser_baseline.json`,
  `llm_guard_baseline.json`), and `agent_golden_eval.service.ts` covers
  recommendations. A provider only wins if it beats those numbers.
- **The value is where people wait.** DJ request parsing runs while the
  listener waits for the first track. Moderation triage is next, because a
  wrong "safe" answer costs the most there.

## Scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Technical | [#2581](https://github.com/akoita/resonate/issues/2581) Spike: decision models on the DJ parser eval | Run `dj_filter_eval` parser cases through (a) today's Gemini model-assisted parser, (b) Gemini with a constrained choice/enum schema, (c) one dedicated decision API (OpenAI Decisions or Microsoft Decision 1). Report accuracy per field, schema-failure rate, p50/p95 latency, cost per 1,000 requests, caching, and what each provider keeps of listener text. Decision written in `docs/rfc/decision-models.md` |
| 2 | P0 | Technical | [#2582](https://github.com/akoita/resonate/issues/2582) `DecisionClient` port | Provider-neutral `predicate` / `choice` / `score` interface with a Gemini implementation and a test fake. New strategy value `decision` next to `deterministic` and `model-assisted`. Same rules as today: bounded JSON input, field-by-field validation, timeout and queue cap, fixed reason codes in logs, never the text or raw output |
| 3 | P0 | User feature | [#2583](https://github.com/akoita/resonate/issues/2583) Pilot: AI DJ request parsing | `agent_session_parser` and `model_crate_request_parser` run on `DecisionClient` behind `AGENT_SESSION_PARSER_STRATEGY=decision` / `CRATE_REQUEST_PARSER_STRATEGY=decision`. Gate: equal or better than `model-assisted` on the parser eval, lower p95, and the deterministic parser still wins every field it set |
| 4 | P1 | Quality | [#2584](https://github.com/akoita/resonate/issues/2584) Moderation assist triage | `community_moderation_assist.service.ts` gets a `decision` strategy: predicate "needs human review", choice of category, score for severity. Advisory only; a human still decides. Fails closed: any error or low confidence means "needs review" |
| 5 | P2 | Technical | [#2585](https://github.com/akoita/resonate/issues/2585) Score-based rerank (stretch) | `model_assisted_recommendation.adapter.ts` scores each deterministic candidate instead of ranking in free text. Ships only if `agent_golden_eval` improves |

**Deployment half (only if the spike picks a provider other than Gemini):**
a resonate-iac issue for the provider key secret per environment and the new
env vars in both `deploy.yml` and `deploy-services.yml`. The operator writes
the secret.

## Owner decisions (open; recommendations approved with the plan)

1. **Provider.** Recommended: decide after the spike. Stay on Gemini with a
   constrained schema unless a dedicated decision API is clearly better
   (for example, ≥5 points more accurate or half the p95), since a new
   provider means a new processor of listener text, a key, and an iac change.
2. **Privacy notice.** If a new provider is picked, the privacy page must name
   it before the strategy is enabled anywhere. Recommended: yes, same release.
3. **Staging default.** Recommended: `decision` on staging for the DJ parser
   once item 3 passes the gate; production stays on today's setting.

## Exit criteria

- Spike numbers and the provider decision recorded in
  `docs/rfc/decision-models.md`.
- Items 2–4 merged with focused tests, including the eval gate run in CI or
  recorded in the PR.
- A provider error, timeout or malformed answer never blocks a DJ session and
  never marks a moderation item as safe.
- New config documented in `docs/deployment/environment.md` and the agent
  feature page.

## Not in this sprint

- Money, payouts, x402, upload rights and watermark gates. These stay
  fail-closed code (ADR-BM-4); a model can at most flag for manual review.
- Taste-edit parser, track descriptors and artist enrichment (later, once the
  port exists).
- agent-toolkit changes.

## Revenue line

ADR-BM-6: vision-neutral AI quality and cost infrastructure. No fee, price,
split or payout changes, and ADR-BM-4 is untouched.
