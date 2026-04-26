# Agent Evals

This directory contains deterministic evaluation fixtures for the commerce-agent
runtime.

Run the current golden set from the backend workspace:

```bash
npm run eval:golden
```

The command runs `backend/src/tests/agent_golden_eval.spec.ts` and writes a JSON
artifact to:

```text
backend/eval-results/agent-golden-results.json
```

The artifact uses schema `agent-golden-eval/v1` and contains:

- aggregate pass/fail metrics
- per-category pass/fail metrics
- the deterministic rubric used by CI
- case-level expected and actual decision data
- failure messages for regressions

## Adding Cases

Add new cases to `agent_golden_set.ts`. Each case should include:

- a stable `id`
- a `category`
- concise `tags`
- deterministic input data
- expected status, reason, license type, and optional price ceiling
- rubric metadata for future LLM-judge scoring

Keep cases deterministic and credential-free. External LLM judging, hosted
dashboards, and ERC-8004 reputation publishing are follow-up work.

This slice targets 25+ cases. The roadmap target is a broader 100-200 case
benchmark once the runtime and learning-loop surfaces are more stable.
