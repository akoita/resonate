# AI Generation — Acceptable Use (PUP flow-down)

> Status: adopted 2026-07-04 (#1193). This document is the enforceable-provision
> source required by the Gemma Terms of Use §3.1: the use restrictions of the
> [Gemma Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy)
> (incorporated into the Gemma Terms §3.2) must govern any Resonate service
> backed by Stable Audio 3 (which bundles the T5Gemma encoder). When AI
> generation ships to real users, these restrictions must appear in the
> user-facing terms with notice to users. It also serves Resonate's own
> AI-integrity posture (#1164, ADR-BM-5) independent of any vendor obligation.

## Scope

Applies to every AI-generation surface: Lyria track generation (`/create`),
Remix Studio drafts (stem-mix, variation, extension, audio-conditioned), and
any future generation provider. Vendor-hosted paths (Lyria) additionally carry
the vendor's own filters; the **self-hosted Stable Audio path has no vendor
filter — Resonate is the enforcement layer**.

## Prohibited uses (PUP-mapped) and how Resonate enforces them

| PUP category | Resonate rule | Enforcement today | Gap / follow-up |
| --- | --- | --- | --- |
| 1. Content that infringes or violates others' rights (incl. copyright) | Generation is rights-gated: remix drafts require a remix license or source ownership; consent flags (`remixConsent`, per-stem `remixable`) and rights-routing gate eligibility | `RemixEligibilityService`, upload-rights routing, ContentProtection stakes/disputes | Output-side fingerprint screening is roadmap (#408) |
| 2. Dangerous / illegal / malicious activity (incl. safety-filter circumvention) | Prompts and usage must not facilitate illegal activity or attempt to bypass safety behavior | Vendor filters on Lyria (mapped to `provider_rejected`); **prompt-safety moderation on the self-hosted path** (`PromptModerationService`, #1343) rejects safety-bypass/jailbreak + explicit-harm-instruction prompts before dispatch; audio-only output surface | Rule-based v1 (precision-first); a classifier for harder ambiguous cases is the upgrade path (#1343) |
| 3. Misinformation / deception (passing AI content off as human-made; impersonation without disclosure) | AI involvement is declared and labeled end to end; no undisclosed impersonation; voice/likeness cloning is not offered (explicitly deferred until a consent framework exists) | `ai_generated` release typing, grounding labels, AI-disclosure groundwork (#1164, ADR-BM-5 / DDEX alignment); prompt moderation rejects explicit voice-clone-a-real-person requests (#1343) | Listener-facing labels complete under #1164 |
| 4. Sexually explicit content (non-artistic) | Prompts requesting such content are rejected; **sexualization of minors is zero-tolerance** | Vendor filters (Lyria); **prompt-safety moderation on the self-hosted path** (#1343) rejects explicit-sexual and any minor-sexualization prompts before dispatch; audio-only output narrows exposure | Rule-based v1 (precision-first); classifier upgrade path (#1343) |

Also binding, from the Stability AI Community License: outputs are owned by
Resonate/users (§IV(c)(iii)) but carry **no indemnification** at the free
tier — output-IP responsibility stays with us, mitigated by fully-licensed
training data and licensed-source conditioning.

## Operator obligations (tracked in the license review)

- "Powered by Stability AI" attribution + license links before real-user
  enablement of the audio-conditioned provider.
- Stability AI commercial-use **registration** before production enablement
  and before any billing of generations (ADR-BM-3).
- Enterprise license contact at the $1M total-annual-revenue milestone (the
  Community License auto-terminates at that threshold).

Full determinations and verbatim clause citations:
`docs/rfc/stable-audio-3-license-review.md` ("Determinations (2026-07-04)").
