# Security Best Practices Report — Remix draft versions (#1320)

_Scope: the diff on `feat/1320-remix-draft-versions` — draft-version archiving,
the `?jobId=` draft-audio parameter, and the studio versions/cost UI._

## Executive Summary

No Critical, High, or Medium findings. The slice adds one optional query
parameter to an existing owner-scoped endpoint and server-written metadata.

## Checks performed

| Check | Result |
| --- | --- |
| AuthZ | `getDraftAudio` still resolves through `loadOwnedProject` first; a `jobId` only ever matches entries in the OWNER's own `generationMetadata.previousDrafts` — no cross-project or cross-user reach, unknown ids 404 |
| Input validation | `jobId` is used solely as an exact-match lookup key against server-written entries; never interpolated into storage paths (`outputUri` comes from the archived entry the server wrote at generation time) |
| Data exposure | Archive entries contain only fields already served on the project read (provider, grounding, transform, cost, output URI already used by draft-audio); `previousDraftsFromMetadata` drops malformed entries defensively |
| Resource growth | History capped at `REMIX_PREVIOUS_DRAFTS_MAX = 3`; entries reference existing stored outputs (no new storage writes); metadata growth bounded |
| Cost honesty | Only recorded `estimatedCostUsd` values render; no client-side price fabrication |
| Hardcoded secrets / raw SQL / eval | None added |

## Findings

None. Informational: archived outputs are never deleted from storage (matching
the existing lifecycle — outputs were already retained); a storage GC policy
for fully-abandoned drafts remains a platform-level follow-up, unchanged by
this slice.
