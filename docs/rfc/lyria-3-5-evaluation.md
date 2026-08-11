---
title: "Lyria 3.5 — API Availability and Source-Grounded Remix Evaluation"
status: resolved
issues:
  - "https://github.com/akoita/resonate/issues/1542"
related:
  - docs/rfc/stable-audio-3-spike-findings.md
  - docs/rfc/stable-audio-3-license-review.md
  - docs/rfc/remix-audio-grounding-build-vs-buy.md
  - "https://github.com/akoita/resonate/issues/332"
  - "https://github.com/akoita/resonate/issues/1182"
  - "https://github.com/akoita/resonate/issues/1421"
date: 2026-08-11
---

# Lyria 3.5 — API Availability and Source-Grounded Remix Evaluation

> **Decision date:** 2026-08-11. Vendor capabilities, preview model IDs,
> pricing, and terms can change. Re-run the gates in [Re-evaluation
> triggers](#re-evaluation-triggers) before changing providers.
>
> **Not legal advice.** The terms findings are an engineering/product screen.
> Counsel or a Google account representative must confirm any production
> indemnity or licensed-audio processing position.

## Decision

Choose outcome **3: no integration change yet**.

- **General music generation:** do not call the current API integration
  "Lyria 3.5" and do not change its model key. Google has launched Lyria 3.5
  in **Google Flow Music**, but has not published a distinct Lyria 3.5 API
  model ID or said that `lyria-3-pro-preview` transparently receives the 3.5
  model. Resonate should keep the honest provider identifier
  `lyria-3-pro-preview` until Google publishes a developer contract.
- **Source-grounded Remix Studio generation:** do not replace Stable Audio 3.
  The published Lyria API accepts text and images, not audio, and documents
  single-turn generation rather than source-audio editing. It cannot be
  benchmarked against Resonate stems without inventing an undocumented API.
- **Complementary provider:** the current Lyria 3 Pro path remains useful for
  prompt- or feature-conditioned full-song generation. This is existing
  behavior, not a new adoption decision.

The conclusion is an **availability and contract gate**, not a negative
quality judgment about Lyria 3.5 inside Flow. No Lyria 3.5 API output was
available to test.

## Question and evidence standard

The primary question is whether the public developer surface can listen to a
licensed full mix or stem and produce a related variation, continuation,
replacement region, or complementary layer. Server-side stem mixdown is a
separate Resonate DSP responsibility and does not prove model grounding.

This evaluation distinguishes three evidence levels:

1. **Documented:** an official request/response schema or an explicit Google
   statement supports the capability.
2. **Absent from the published schema:** official docs do not expose the
   capability. This blocks integration, but does not claim that Google's
   internal model can never support it.
3. **Unknown:** the available material cannot establish the answer.

Only official Google product, API, model, pricing, and terms pages are used for
claims about the current hosted service. Repository documents provide the
Stable Audio baseline and Resonate-specific integration facts.

## Availability and integration surface

| Item | Finding as of 2026-08-11 | Integration consequence |
| --- | --- | --- |
| Lyria 3.5 launch | Google's announcement says Lyria 3.5 is rolling out in **Flow Music**, with improvements to musicality, lyrics, vocals, prompt adherence, tempo, and duration control. | This establishes a Flow product release, not a developer API release. |
| Developer model IDs | The Gemini API publishes `lyria-3-clip-preview` and `lyria-3-pro-preview`. No distinct 3.5 model ID is published. | Preserve the current provider key; do not relabel generated provenance as 3.5. |
| Transparent upgrade | No official source found says `lyria-3-pro-preview` is an alias for or transparently serves Lyria 3.5. | Treat any such mapping as unknown, not implied by the unversioned preview alias. |
| Lifecycle | Both public Lyria 3 models are Preview. The Gemini deprecation table lists no announced shutdown date. Preview models may change and have tighter limits. | Not an acceptable basis for a silent production-provider migration. |
| Access and region | Gemini API pricing exposes Lyria only on the paid tier. Google's Agent Platform model page lists the hosted Lyria 3 models in `global`; the Gemini Developer API applies its general available-region rules. | Production use needs billing and region/terms validation for the serving path. Resonate's Lyria 3 path currently uses the Gemini API-key route, not its Vertex ADC route. |
| Quota | Numeric Gemini Developer API limits are project/tier-specific and surfaced in AI Studio. Google's hosted enterprise model page publishes a low Preview quota, but it is not evidence for Resonate's Gemini API project quota. | Measure the actual billed project before any traffic migration. Do not copy a quota between products. |
| Input | Text and up to ten images are documented. | An image can inspire a track but cannot preserve the identity of source audio. |
| Output | One mixed audio result plus lyrics/song-structure text. MP3 is the default; the Gemini guide documents WAV selection for Pro. | No documented stem, mask, or separated-track artifact enters the render pipeline. |
| Duration and control | Clip produces 30 seconds. Pro produces a couple of minutes/up to roughly three minutes; prompts and timestamps can guide duration and arrangement. | BPM, key, section, and entry/exit instructions are prompt guidance, not sample-accurate editing controls. |
| Sample rate | Current official pages conflict: the music guide/hosted model page describe 44.1 kHz while Gemini model/changelog material describes 48 kHz. | Keep this as unresolved documentation drift. Inspect actual media before changing Resonate's stored `sampleRate` assertion. |
| Safety and determinism | Safety filters apply; artist-voice and copyrighted-lyrics requests can be blocked. Repeated prompts are not deterministic. | Preserve normalized provider-rejection handling and do not promise reproducibility. |
| Watermarking | Google states that all generated Lyria audio carries imperceptible SynthID; the hosted model capability table also lists C2PA support. | Continue recording provider-declared SynthID separately from detector-verified provenance. |

### Current Resonate path

`LyriaClient` has two deliberately different routes:

- 30-second Vertex ADC generation uses `lyria-002`;
- the Gemini API-key route uses the hardcoded
  `lyria-3-pro-preview` model for 30/60/120/180-second generation.

The result types, tests, generation metadata, cost-model keys, and public
provenance all preserve those identifiers. A future model change therefore
needs an explicit migration across the API contract and durable provenance; it
must not be treated as a vendor-side cosmetic rename.

Remix Studio's Lyria provider sends a text prompt plus measured BPM/key hints.
It does **not** send source stems to Google. A later Resonate renderer can mix
the Lyria output with licensed stems, but that makes the final render
stem-containing, not the model output source-grounded.

## Source-grounding capability gate

| Required Remix Studio capability | Public Lyria developer evidence | Result |
| --- | --- | --- |
| Accept a full mix or stems as audio input | Published input modalities are text and image. No reference/source-audio field is documented. | **Blocked** |
| Preserve recognizable source identity while transforming it | Cannot be tested without source-audio input. | **Blocked** |
| Continue or extend uploaded source audio | Duration/continuation can be described in a prompt, but no uploaded-audio continuation contract is published. | **Blocked** |
| Inpaint or replace a selected region | No audio input, edit mask, or region-replacement schema is published. | **Blocked** |
| Generate an isolated complementary layer/stem | "Instrumental" produces a mixed instrumental track. No isolated-layer or stem-output contract is published. | **Blocked** |
| Exact BPM, key, timing, and section control | BPM, key, timestamp, and arrangement instructions are supported through prompting; exact adherence is not guaranteed. | **Partial — prompt guidance only** |
| Iterative/multi-turn edit | Google explicitly documents music generation as single-turn and says iterative editing/refinement is unsupported. | **Not supported** |
| Return stems, tracks, masks, or render-ready edit representation | The response schema documents a single audio block plus text. | **Absent from schema** |

### Hands-on benchmark status

The source-grounding benchmark is **blocked before sample selection**. There is
no public request field to attach licensed audio and no public Lyria 3.5 model
ID to call. Using undocumented endpoints or treating the consumer Flow product
as an API would not produce reproducible integration evidence and could put
licensed source audio outside the reviewed data-processing boundary.

Accordingly, no Resonate audio was uploaded and no quality score is fabricated.
The existing [Stable Audio 3 spike](stable-audio-3-spike-findings.md) remains
the hands-on comparison baseline: it demonstrated recognizable audio
conditioning and controllable prompt steering at draft quality, while retaining
known fidelity and cold-start limitations.

## Decision matrix

| Dimension | Lyria 3.5 in Flow | Public Lyria 3 Pro Preview API | Self-hosted Stable Audio 3 Medium |
| --- | --- | --- | --- |
| Developer availability | No published 3.5 API contract | Paid Preview API | Implemented behind Resonate provider boundary |
| Text-to-song | Announced improvements | Yes; text/image to full mixed song | Yes |
| Source-audio conditioning | Not claimed in the announcement | Not exposed in published schema | Yes; verified on a Resonate source in the existing spike |
| Inpainting / source continuation | Not claimed | Not exposed | Model API exposes inpainting/conditioning; product work remains incomplete |
| Iterative editing | Unknown for Flow | Explicitly unsupported | Resonate must orchestrate iterations itself |
| Stem/layer output | Not claimed | Not exposed | No native separated output; can generate a conditioned layer/draft for Resonate rendering |
| Quality evidence for this decision | No reproducible API sample | No 3.5 sample; existing Lyria 3 prompt path only | Draft-quality hands-on evidence; not release-master quality |
| Marginal hosted price | Consumer-product pricing is not an API quote | Clip: USD $0.04/song; Pro: USD $0.08/full song on the published paid tier | GPU cost depends on warm state, load time, and deployment utilization |
| Cold start | Hidden by hosted product | Hosted; no Resonate GPU cold start | Roughly four-minute model load is the dominant scale-to-zero cost |
| Watermark/provenance | SynthID claimed for Lyria family | SynthID on generated audio; C2PA listed on hosted model page | No SynthID; Resonate records provider and grounding provenance |
| Licensed source leaves Resonate | Unknown/consumer terms | Not applicable today because audio input is absent | No; self-hosted path processes authorized stems inside Resonate infrastructure |
| Lifecycle/support | Flow product | Preview; subject to change and tighter limits | Resonate-operated, with model/license/dependency obligations |
| Published output indemnity | Not established for Resonate API use | No Lyria-specific basis found; Lyria is Preview and absent from Google's current indemnified-model list | None at the current community tier |

## Cost, rights, privacy, and operational fit

### Cost

Google's current paid-tier price is **$0.04 per 30-second Clip request** and
**$0.08 per Pro full-song request**. This is materially different from
Resonate's existing placeholder internal estimate of $0.06 per 30 seconds.
The repository cost model intentionally keeps placeholders until billing and
telemetry are reconciled, so this spike does **not** change code, sell prices,
or the canonical credit schedule.

Stable Audio economics are not directly comparable per song: self-hosting is
dominated at low volume by the GPU model's cold load and at higher volume by
utilization. Any later provider decision needs billed-project Lyria data and
measured warm/cold Stable Audio cost on the same usage cohort.

No Lyria 3.5 API latency or reliability benchmark was possible. The public
Lyria 3 API is Preview and has no SLA in the cited developer material, so
hosted latency, failure rate, and capacity remain unknown for this decision.
Existing Resonate observations from `lyria-3-pro-preview` would describe Lyria
3, not prove Lyria 3.5 behavior. The Stable Audio baseline, by contrast,
measured fast warm inference but an approximately four-minute model load; that
cold-start tradeoff remains real until a comparable hosted API exists.

### Output and commercial use

The Gemini API terms say Google does not claim ownership over generated
content, may generate similar content for others, and leaves legal use of the
output to the customer. The current Cloud indemnified-services list covers
generally available versions of named foundation-model families and does not
list Lyria. Lyria 3 is Preview. Therefore this review found no published basis
to promise Google output indemnification for Resonate's Lyria path.

That absence is a legal/product risk distinction, not a claim that Lyria output
cannot be used commercially. Confirm the exact serving product and contract
with Google before making an indemnity statement in user-facing material.

### Data use and retention

The public Lyria API cannot currently accept source audio, so no Lyria-specific
licensed-source retention behavior can be tested. For the paid Gemini API,
Google says prompts, uploaded files, and responses are not used to improve its
products; it may log them for a limited period for abuse prevention and legal
obligations. Unpaid-service data has broader product-improvement and human-
review terms, but the published Lyria pricing has no free tier.

If audio input appears later, Resonate must separately verify:

- that the chosen paid/enterprise path and Data Processing Addendum cover
  licensed full mixes and stems;
- storage defaults for the Interactions API and any Files API upload;
- zero-data-retention eligibility and abuse-monitoring exceptions;
- regions, subprocessors, deletion timing, and whether data is ever used for
  training; and
- that the artist's license/consent permits sending audio to that processor.

### Provenance

Google states that generated Lyria audio is watermarked with SynthID and that
the mark is intended to survive common transformations such as MP3 compression,
noise, and speed changes. Resonate currently records `synthIdPresent: true`
from the provider contract; it does not independently verify each generated
file before persisting that flag. Future work must keep **provider-declared**
watermarking distinct from **detector-verified** provenance.

## Recommendations

### General Lyria generation: **NO-GO on a 3.5 upgrade; keep current Lyria 3**

Keep `lyria-3-pro-preview` configured exactly as it is until Google publishes
one of the following:

- a distinct Lyria 3.5 API model ID and lifecycle;
- an explicit statement that the existing ID serves 3.5, with compatible
  behavior and terms; or
- a generally available successor with a migration guide.

At that point, run prompt-quality, duration, language, format/sample-rate,
safety, latency, reliability, quota, and billed-cost regression tests before
changing the durable provider identifier. Do not infer a model upgrade from
Flow marketing alone.

### Stable Audio replacement in Remix Studio: **NO-GO**

Retain Stable Audio 3 for the audio-conditioned draft path. Public Lyria does
not meet the entry gate for source identity, continuation, inpainting,
complementary layers, iterative editing, or stem output because it cannot
receive source audio through its published schema.

Keep Lyria as a complementary prompt/feature-conditioned provider. Preserve
the product's honest grounding labels:

- `prompt_only` or `feature_conditioned` for Lyria, depending on whether
  measured source features shaped the prompt;
- `audio_conditioned` only when the model received authorized source audio;
- `stem_audio` for deterministic mixes with no AI grounding claim.

## Re-evaluation triggers

Re-open this decision only when at least one concrete trigger occurs:

1. Google publishes a Lyria 3.5 or successor API model ID, or explicitly maps
   `lyria-3-pro-preview` to the new model.
2. The official request schema accepts source audio, reference audio, stems,
   edit masks, or an audio continuation/inpainting input.
3. The response schema exposes isolated layers, stems, masks, or another
   render-ready representation.
4. Multi-turn editing is documented for music generation.
5. Lyria reaches GA with production quota/SLA and its indemnification position
   is explicit.
6. Paid data-processing terms explicitly cover Resonate's licensed-source
   workflow, including retention, training use, region, and deletion.

When triggered, reuse the benchmark in issue #1542: the same licensed full
mixes and sparse/dense stems, transformation prompts, duration classes, and
source-preservation rubric used for Stable Audio. Do not compare unrelated
prompt-only outputs and call that a source-grounding test.

## Business-model and change-impact check

This evaluation supports **Revenue Line 2: Artist Pro + generation credits**,
the second activation phase/order under ADR-BM-6. It changes no fee, price,
split, payout, credit balance, or billing behavior. ADR-BM-4 red lines are
untouched.

The engineering change-impact checklist was reviewed for AI evaluation,
provenance, privacy, API contracts, configuration, deployment, product docs,
and User Guide impact. This finding changes no runtime behavior or user-visible
capability, so it requires no feature-catalog, `/help`, screenshot, API, event,
environment, or deployment update. The RFC itself durably tracks the blocked
capabilities and re-evaluation gates. No implementation work is approved, so
no new implementation follow-up issue is required; the existing Lyria and
source-grounding epics remain linked in the front matter.

## Authoritative Google sources

- [Introducing Lyria 3.5 in Google Flow Music](https://blog.google/innovation-and-ai/models-and-research/google-labs/lyria-3-5/)
- [Google DeepMind — Lyria model family](https://deepmind.google/models/lyria/)
- [Gemini API — Generate music with Lyria 3](https://ai.google.dev/gemini-api/docs/music-generation)
- [Gemini API — Lyria 3 Pro Preview model](https://ai.google.dev/gemini-api/docs/models/lyria-3-pro-preview)
- [Gemini API — Lyria 3 Clip Preview model](https://ai.google.dev/gemini-api/docs/models/lyria-3-clip-preview)
- [Google hosted Lyria 3 model details](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/lyria/lyria-3)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing#lyria-3)
- [Gemini API model deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- [Gemini API available regions](https://ai.google.dev/gemini-api/docs/available-regions)
- [Gemini API zero data retention](https://ai.google.dev/gemini-api/docs/zdr)
- [Gemini API terms](https://ai.google.dev/gemini-api/terms)
- [Google Cloud Service Specific Terms](https://cloud.google.com/terms/service-terms)
- [Google Cloud Generative AI Indemnified Services](https://cloud.google.com/terms/generative-ai-indemnified-services)
- [Google DeepMind — SynthID](https://deepmind.google/models/synthid/)
