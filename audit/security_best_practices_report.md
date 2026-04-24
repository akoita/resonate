# Security Best Practices Report

## Executive Summary

Reviewed the mixer, AI-generation-to-Demucs, duplicate-release consolidation,
and home spacing changes on `fix/mixer-stem-readiness-race`. No Critical or
High findings were identified.

## Scope

- `backend/src/modules/catalog/catalog.service.ts`
- `backend/src/modules/ingestion/ingestion.service.ts`
- `backend/src/modules/ingestion/stem-pubsub.publisher.ts`
- `backend/src/modules/ingestion/stems.processor.ts`
- `backend/src/tests/catalog.integration.spec.ts`
- `backend/src/tests/ingestion_metadata.spec.ts`
- `web/src/app/create/CreatePageContent.tsx`
- `web/src/app/page.tsx`
- `web/src/app/release/[id]/page.tsx`
- `web/src/components/agent/AgentSessionPresets.tsx`
- `web/src/components/player/MixerConsole.tsx`
- `web/src/styles/home-nextgen.css`

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None.

## Low Findings

None in the changed code.

## Informational Notes

- The new AI-to-Demucs flow reuses the existing authenticated
  `POST /ingestion/retry/:releaseId` path instead of submitting generated audio
  through the generic upload endpoint, preventing duplicate catalog releases.
- The retry path now distinguishes source stems (`original`, `master`) from
  separated stems before re-queuing work. It does not introduce new public write
  endpoints.
- Duplicate consolidation is limited to same-artist, same-title AI-generated
  releases where the canonical release only has source audio and the duplicate
  has separated stems.
- Raw Prisma usage found by the scan is existing parameterized maintenance or
  locking code outside this branch's changed logic.
- Existing development-only JWT fallback strings (`dev-secret`) were observed
  in auth configuration. They are not introduced or modified by this branch.
- No secrets, private keys, API keys, or credentials were found in the branch
  diff.

## Commands Run

```bash
git diff --name-only main
git diff -- . ':(exclude)package-lock.json' | rg -n "(API_KEY|SECRET|PRIVATE_KEY|PASSWORD|TOKEN|BEGIN .*PRIVATE|0x[a-fA-F0-9]{64}|AIza|sk-|xox|ghp_|pat_)" -S
rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/ | grep -v 'Guard\|Auth'
rg 'JSON\.parse|eval\(' backend/src/
rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/ | grep -v 'Pipe\|Dto\|Validation'
rg 'dangerouslySetInnerHTML|innerHTML' web/src/
rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/
rg 'document\.cookie|setCookie|httpOnly.*false' web/src/
```
