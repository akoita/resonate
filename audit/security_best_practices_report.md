# Security Best Practices Report

## Executive Summary

Reviewed the Pub/Sub Application Default Credentials hotfix on `fix/pubsub-adc-cloud-run-init`, focusing on backend credential detection, worker handoff initialization, and result-subscriber startup. No new Critical or High security findings were introduced by the modified files.

## Scope Reviewed

- `backend/src/modules/ingestion/pubsub-runtime.ts`
- `backend/src/modules/ingestion/stem-pubsub.publisher.ts`
- `backend/src/modules/ingestion/stem-result.subscriber.ts`
- `backend/src/tests/pubsub-runtime.spec.ts`
- `backend/src/tests/stem-result.subscriber.spec.ts`
- `docs/smart-contracts/deployment.md`

## Findings

### Informational

#### SBPR-001: Pub/Sub auth detection now matches Cloud Run ADC expectations

**Files:** `backend/src/modules/ingestion/pubsub-runtime.ts`, `backend/src/modules/ingestion/stem-pubsub.publisher.ts`, `backend/src/modules/ingestion/stem-result.subscriber.ts`

**Observation:** The hotfix removes the prior requirement for `GOOGLE_APPLICATION_CREDENTIALS` in production-like environments and accepts Application Default Credentials from the runtime, which is the expected Cloud Run auth model. The new helper still fails closed when neither the emulator nor ADC is available, so it reduces false negatives without weakening the backend startup guard.

**Recommendation:** Keep Pub/Sub, GCS, and any future Google service clients aligned on the same ADC detection pattern so staging and production credential paths do not drift again.

## Notes

- Targeted grep checks for hardcoded secrets, raw SQL, unsafe deserialization, and controller/input-validation patterns did not surface any new vulnerabilities in the touched backend files beyond the intentional `JSON.parse` on Pub/Sub payloads.
- The new runtime helper does not introduce hardcoded credentials or project-specific production URLs.
- Local verification completed with `npm run lint` in `backend/` and focused Jest coverage for `pubsub-runtime.spec.ts` and `stem-result.subscriber.spec.ts`.
