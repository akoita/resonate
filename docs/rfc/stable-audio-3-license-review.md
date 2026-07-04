---
title: "Stable Audio 3 — License & Rights Review (adopt-gate, #1193)"
status: resolved
issues:
  - "https://github.com/akoita/resonate/issues/1193"
related:
  - docs/rfc/remix-audio-grounding-build-vs-buy.md
  - "https://github.com/akoita/resonate/issues/1182"
  - "https://github.com/akoita/resonate/issues/1164"
date: 2026-06-13
---

# Stable Audio 3 — License & Rights Review

> **Not legal advice.** This is an engineering/product position to inform the
> adopt decision for #1182 slices 4–5. The binding determinations on the two
> open items below require reading the full Community License Agreement and,
> for the threshold case, contacting Stability AI. Nothing here needs to be
> resolved before the **quality spike** (a private, non-distributing, non-
> commercial evaluation); it must be resolved before **production wiring**.

This is gate 2 of the #1193 adopt-gate. It is independent of the GPU quality
spike (gate 1) and needs no infrastructure, so it lands first.

## Question

Can Resonate self-host **`stabilityai/stable-audio-3-medium`** as the
audio-conditioned remix-generation provider, serve its outputs to users, and
build a commercial remix-licensing product on it?

## Findings

### 1. Commercial use & self-hosting — clear below the revenue threshold

Stable Audio 3 ships under the **Stability AI Community License**. Per the
license page and corroborating coverage:

- Commercial use — **including self-hosting on our own hardware** — is free
  for organizations under **USD $1M annual revenue**. Self-hosted and API
  deployments carry **identical** ownership and commercial rights; deployment
  choice affects cost/convenience, not IP.
- Above $1M annual revenue, an **Enterprise license** (contact Stability) is
  required.

> **Correction to the build-vs-buy study (PR #1183):** that study hedged that
> "self-hosting for commercial applications requires a separate agreement
> [even below the threshold]." The actual Community License terms do not —
> below $1M, self-hosted commercial use is free with the same rights as the
> API. The real gate is the **$1M revenue threshold**, which Resonate is far
> below.

**For Resonate today (pre-revenue): GREEN.** No payment, no separate
agreement, full self-host rights.

### 2. Output ownership — the decisive advantage over hosted vendors

> *"You own outputs generated from the Core Models or Derivative Works … and
> therefore can use those outputs at your discretion, so long as you do so in
> compliance with applicable law."*

This is the property that makes Stable Audio viable where Suno/Udio are not:
**we own the generated audio outright** and can license/route them through the
marketplace. Suno's terms keep the vendor as "author" and restrict remixes to
personal, non-commercial use (see build-vs-buy study §2b) — incompatible with
a commercial remix-licensing product. Stable Audio's ownership model is
compatible by construction.

### 3. Training-data provenance — aligned with AI Music Integrity (#1164)

Stable Audio 3 is trained on **fully licensed data** (AudioSparx licensed +
Freesound CC, with third-party-verified removal of copyrighted material).
Relative to Suno/Udio (active training-data litigation), this materially
lowers the risk of a generated output reproducing protected material, and it
is consistent with the honest-provenance posture Resonate already ships
(grounding labels #1181/#1194, AI-disclosure groundwork #1164). It does **not**
eliminate output-IP risk (see §5).

### 4. Gemma text encoder (T5Gemma) — the one genuine open item

Stable Audio 3 bundles a **T5Gemma** text encoder. T5Gemma derives from a
**pre-Gemma-4 Gemma**, which is governed by the custom **Gemma Terms of Use**
(not Apache-2.0; Gemma 4 moved to Apache-2.0 in April 2026, but T5Gemma
predates it). The custom terms carry:

- a **Prohibited Use Policy** that **flows down** to downstream users;
- redistribution-notice obligations (provide the terms, mark modifications);
- a unilateral termination right.

What this means for Resonate, and what must be confirmed:

- We **self-host and serve outputs** — we do **not redistribute the model
  weights**. The redistribution-notice obligations are therefore light/likely
  not triggered, but **this must be confirmed against the actual terms.**
- The **Prohibited-Use-Policy flow-down** most plausibly obliges us to reflect
  equivalent acceptable-use restrictions in Resonate's own ToS/AUP for
  AI-generation features. We largely already do (no CSAM, no infrastructure
  attacks, etc.), but the remix-AUP should be cross-checked against the Gemma
  PUP before launch.
- **Open question to resolve before production:** does serving Stable Audio 3
  *outputs* (not weights) trigger any Gemma obligation beyond reflecting the
  PUP? Confirm whether Stability's packaging of T5Gemma carries the Gemma
  obligations through to a downstream output-serving deployer, or absorbs
  them at the Stable Audio license layer.

This is a **manageable obligation, not a blocker** — it shapes ToS language,
not whether we can adopt.

### 5. Indemnification — none at the free tier; mitigated, not eliminated

The Community (free) tier offers **no IP indemnification**; indemnification, if
any, is an Enterprise-tier feature. Pre-revenue, we **bear output-IP risk
ourselves**, mitigated (not removed) by the fully-licensed training data (§3)
and by the fact that stem-mix renders (#1189) contain only licensed source
audio. Acceptable at pre-revenue scale; revisit at the Enterprise threshold.

### 6. Attribution / notice — read the full agreement

The Community License historically carries an attribution/notice obligation
(e.g. a "Powered by Stability AI"-style notice and a copy of the license in
distributions). For an output-serving deployment this is typically a minor UI/
docs notice rather than a per-output watermark, but the exact wording must be
read from the full **Community License Agreement** (the license page is a
summary). Track as a small pre-launch task, not a blocker.

## Verdict

**GO to the quality spike, and GO for a pre-revenue production adoption on
license grounds** — conditional on closing two tracked obligations before
production wiring (neither blocks the spike):

| Item | Type | Blocks spike? | Blocks pre-revenue launch? |
| --- | --- | --- | --- |
| $1M revenue → Enterprise license | Forward budget item | No | No (we're far below) |
| Read full Community License Agreement: attribution/notice + confirm self-host terms | Pre-launch task | No | Must complete |
| Resolve Gemma/T5Gemma PUP flow-down into Resonate AUP; confirm output-serving obligations | Pre-launch task | No | Must complete |
| No free-tier indemnification | Accepted risk | No | Accepted (mitigated by §3) |

**Recommendation:** proceed with the spike. In parallel, (a) read the full
Community License Agreement and capture the exact attribution/notice wording,
(b) cross-check the Gemma Prohibited Use Policy against Resonate's AI-feature
AUP, and (c) note the Stability Enterprise contact as a threshold milestone so
the $1M transition is planned, not scrambled.

## Determinations (2026-07-04) — full license texts read, open items resolved

The full **Stability AI Community License Agreement** (stability.ai, "Last
Updated: July 5, 2024"), the **Gemma Terms of Use** (ai.google.dev, "Last
modified: April 1, 2026" — T5Gemma is expressly listed in its Appendix), and
the **Gemma Prohibited Use Policy** were retrieved and read verbatim. The
stable-audio-3-medium HF repo physically redistributes the T5Gemma encoder
(`t5gemma-b-b-ul2/`, `LICENSE_GEMMA.md`, `NOTICE`), and its click-through gate
binds the downloader to the Gemma Terms including §3.2. Determinations:

### D1 — Attribution applies to the hosted service (broader than assumed)

Community License §IV(a) triggers on distributing the materials **"or a
product or service that uses any portion of them"** — a hosted remix service
is captured. Obligations: (i) make the Agreement available to users (link in
product docs), (ii) keep the required NOTICE text with our copies, and (iii)
**"prominently display 'Powered by Stability AI' on a related website, user
interface, blogpost, about page, or product documentation."** → Pre-launch
task: attribution in the Remix Studio UI + feature docs (tracked below).

### D2 — Commercial use requires registration with Stability (new finding)

§III: *"If You are using or distributing the Stability AI Materials for a
Commercial Purpose, You must register with Stability AI."* "Commercial
Purpose" expressly includes hosted services. → **Register with Stability AI
before enabling the provider in production, and unambiguously before billing
generations (ADR-BM-3 dependency).** Registration is free below the threshold.

### D3 — The $1M threshold is TOTAL revenue and auto-terminates

§III: crossing **USD $1M annual revenue — "regardless of whether that revenue
is generated directly or indirectly from the Stability AI Materials"** —
terminates the license automatically; an Enterprise license is then at
Stability's discretion. The license is also expressly **revocable** and
terminates on litigation against Stability. → Keep "Stability Enterprise
agreement" as a hard revenue-milestone task; treat the provider as a
replaceable boundary (fallbacks #1190/#1192 already shipped).

### D4 — Gemma flow-down resolved: one real obligation

- Gemma Terms §1.1(b): a **Hosted Service is a Distribution** — serving SA3
  generations (which use Gemma's text-conditioning functionality) is captured.
- §1.1(e)+(f): **Outputs are not Model Derivatives**; §3.3: *"Google claims no
  rights in Outputs"* — our users receive Outputs only, so the
  copy-of-agreement duty for recipients of "Gemma or Model Derivatives" is not
  triggered by serving audio.
- §3.1: the NOTICE-file duty is **expressly carved out for Hosted Services**.
- The one binding flow-down: §3.1 requires the **§3.2 use restrictions (the
  Prohibited Use Policy) as an enforceable provision in the terms governing
  the service**, with notice to users. → Resolved by
  `docs/compliance/ai_generation_acceptable_use.md` (PUP-mapped AUP), which
  must be reflected in the user-facing terms when AI generation ships to real
  users. Google retains remote-restriction and update rights — same
  replaceable-boundary posture as D3.

### D5 — Output ownership confirmed at both layers

Community License §IV(c)(iii): we own Model outputs. Gemma §3.3: Google claims
no rights in Outputs. → The marketplace/licensing chain for AI-assisted drafts
is built on owned outputs. (We remain responsible for outputs — the PUP's
first category is rights-infringing content, aligning with the
rights-gated-remix design and #1164.)

### Final go/no-go

**GO — adoption stands** (provider shipped behind `REMIX_GENERATION_PROVIDER_KIND`,
default off in prod). Pre-launch obligations, all tracked:

| # | Obligation | Owner | When |
| --- | --- | --- | --- |
| 1 | "Powered by Stability AI" in Remix Studio UI + docs; link Community License; keep NOTICE | [#1342](https://github.com/akoita/resonate/issues/1342) | before enabling provider for real users |
| 2 | Register with Stability AI (free, §III) | operator (@akoita), tracked in #1342 | before prod enable; hard-required before billing (ADR-BM-3) |
| 3 | PUP-mapped AUP enforceable in user-facing terms | `docs/compliance/ai_generation_acceptable_use.md` → ToS task under #1164 | before real-user launch |
| 4 | Prompt-safety moderation for the self-hosted path (no vendor filter, unlike Lyria) | [#1343](https://github.com/akoita/resonate/issues/1343) (under #1164) | before real-user launch |
| 5 | Stability Enterprise contact at the $1M revenue milestone | operator | revenue milestone |

## Sources

- [Stability AI License page](https://stability.ai/license) and [Community License update](https://stability.ai/news-updates/license-update)
- [Stable Diffusion commercial license & output rights analysis (Terms.Law)](https://terms.law/ai-output-rights/stable-diffusion/)
- [stabilityai/stable-audio-3-medium model card](https://huggingface.co/stabilityai/stable-audio-3-medium)
- [Gemma Terms of Use](https://ai.google.dev/gemma/terms) and [Gemma license risk analysis (WCR.legal)](https://wcr.legal/google-gemma-license-risks/)
- [Gemma 4 → Apache 2.0 (Slashdot)](https://tech.slashdot.org/story/26/04/02/1735238/google-announces-gemma-4-open-ai-models-switches-to-apache-20-license)
- Build-vs-buy study: `docs/rfc/remix-audio-grounding-build-vs-buy.md`
