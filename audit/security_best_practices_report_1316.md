# Security Best Practices Report — Remix per-stem AI transforms (#1316)

_Scope: the diff on `feat/1316-remix-stem-transforms` vs `origin/main` — the
`stemTransform` generation option, prompt framing, bed scoping, and the studio
AI-target selector._

## Executive Summary

No Critical, High, or Medium findings. The slice adds one optional field to an
existing owner-scoped endpoint. All security-relevant inputs are validated
server-side before any provider work.

## Checks performed

| Check | Result |
| --- | --- |
| Input validation | `validateStemTransform` runs in the service before eligibility/provider work: kind whitelist, variation-mode-only, target must be a project stem, replacing the only unmuted stem rejected. The controller forwards only the two documented fields (kind, stemId) — extra body fields are dropped |
| Prompt injection surface | Unchanged: the user prompt was already free text sent to providers; the transform adds a fixed server-built lead sentence around it. The `stemLabel` in prompts comes from the catalog stem type/title (server data), not the request |
| AuthZ / decrypt boundary | Unchanged endpoint auth; the render authorization set now derives from the **bed** — a strict subset of the previously authorized stems (the replaced target is excluded, never additionally exposed) |
| Rights policy | Worker-time eligibility re-check still covers all project stems; grounding provenance unchanged and honest; publish lineage records the transform verbatim from server-written metadata |
| Cost control | Generation rate limits unchanged; transforms use the same single-job-per-project lifecycle |
| Hardcoded secrets / raw SQL / eval | None added |

## Findings

None. Informational: whole-track generation without a transform is
byte-identical to pre-#1316 (the field is absent from input and metadata).
