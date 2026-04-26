# Security Best Practices Report

## Executive Summary

Reviewed the #424 agent runtime worker extraction. No Critical or High findings
were identified in the new worker endpoint, backend-to-worker delegation path,
runtime contract, tests, or documentation.

## Scope

- `backend/src/agent-worker.ts`
- `backend/src/modules/agents/agent_worker.module.ts`
- `backend/src/modules/agents/agent_runtime_worker.controller.ts`
- `backend/src/modules/agents/agent_runtime.contract.ts`
- `backend/src/modules/agents/agent_runtime.executor.service.ts`
- `backend/src/modules/agents/agent_runtime_remote.client.ts`
- `backend/src/modules/agents/agent_runtime.service.ts`
- `backend/src/modules/agents/agent_runtime.providers.ts`
- `backend/src/modules/agents/agent_runtime.types.ts`
- `backend/src/modules/agents/agent_negotiator.service.ts`
- `backend/src/modules/agents/agents.module.ts`
- `backend/src/tests/agent_runtime_worker.spec.ts`
- `backend/src/tests/agent_runtime.integration.spec.ts`
- `docs/architecture/agent-runtime-worker.md`
- `docs/deployment/environment.md`
- `docs/rfc/agent-platform-refactor.md`
- `docs/rfc/agent-opportunities-2026-04.md`

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None in the changed code.

## Low Findings

None in the changed code.

## Informational Notes

- The worker endpoint is internal-only when `INTERNAL_SERVICE_KEY` is
  configured, and it refuses production requests if the key is missing.
- The backend delegates to the worker only when `AGENT_RUNTIME_WORKER_URL` is
  configured. Otherwise it keeps the existing in-process runtime behavior.
- Worker failures fall back to the local executor unless
  `AGENT_RUNTIME_WORKER_REQUIRED=true`, preserving current storefront/session
  contracts by default.
- Runtime request validation rejects malformed input before invoking the
  executor. No raw SQL, unsafe deserialization, or dynamic evaluation paths were
  added.
- New configuration is environment-variable driven and documented; no secrets,
  staging URLs, or production service identifiers were introduced in source.

## Commands Run

```bash
rg 'password|secret|api_key|private_key' backend/src/modules/agents backend/src/agent-worker.ts --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/agents backend/src/agent-worker.ts
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/agents backend/src/agent-worker.ts
rg 'JSON\.parse|eval\(' backend/src/modules/agents backend/src/agent-worker.ts
rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/agents backend/src/agent-worker.ts
cd backend && npm run lint
cd backend && npm test
cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='agent_runtime.integration'
git diff --check
```
