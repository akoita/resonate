# Security Best Practices Report

## Executive Summary

Reviewed the Langfuse-compatible observability and golden-set eval work on
`feat/677-langfuse-golden-evals`. No Critical or High findings were identified
in the changed backend code.

## Scope

- `backend/src/evals/agent_golden_set.ts`
- `backend/src/modules/agents/agent_observability.service.ts`
- `backend/src/modules/agents/agent_golden_eval.service.ts`
- `backend/src/modules/agents/agent_evaluation.service.ts`
- `backend/src/modules/agents/agent_runner.service.ts`
- `backend/src/modules/agents/tools/tool_registry.ts`
- `backend/src/modules/agents/agents.controller.ts`
- `backend/src/modules/agents/agents.module.ts`
- `backend/src/modules/mcp/mcp.service.ts`
- `backend/src/modules/mcp/mcp.module.ts`
- `backend/src/tests/agent_observability.spec.ts`
- `backend/src/tests/agent_golden_eval.spec.ts`
- `backend/src/tests/tool_registry_observability.spec.ts`
- Related documentation updates in `docs/rfc/agent-opportunities-2026-04.md`
  and `docs/smart-contracts/deployment.md`

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None in the changed code.

## Low Findings

None in the changed code.

## Informational Notes

- Langfuse trace export is disabled unless `LANGFUSE_ENABLED=true` and
  `LANGFUSE_BASE_URL` (or legacy `LANGFUSE_HOST`), `LANGFUSE_PUBLIC_KEY`, and
  `LANGFUSE_SECRET_KEY` are all configured.
- Langfuse credentials are read only from environment variables and are never
  logged or returned in API responses.
- Tool and eval inputs/outputs are sanitized before export. Sensitive key names
  such as `authorization`, `token`, `secret`, `apiKey`, and `privateKey` are
  replaced with `[redacted]`.
- The outbound trace host is environment-configured; no production or staging
  Langfuse URL is hardcoded.
- The new golden eval command is deterministic and does not call external LLMs
  or network services.
- Existing scan output still reports pre-existing development fallbacks such as
  `dev-secret` and unrelated route/input-validation patterns outside this
  branch scope; no new secrets, private keys, API keys, or hardcoded production
  URLs were introduced.

## Commands Run

```bash
rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/ | grep -v 'Guard\|Auth'
rg 'JSON\.parse|eval\(' backend/src/
rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/ | grep -v 'Pipe\|Dto\|Validation'
git status --ignored --short
```
