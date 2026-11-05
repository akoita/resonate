---
title: "RFC: Remix render watermarking — scheme choice (spike, #2572)"
status: draft
author: "@akoita"
created: "2026-11-05"
issues:
  - "https://github.com/akoita/resonate/issues/2572"
  - "https://github.com/akoita/resonate/issues/2566"
related:
  - "./remix-studio.md"
  - "./remix-mashups.md"
  - "./content-protection-architecture.md"
  - "../features/remix_studio.md"
  - "../../experiments/remix-watermarking-spike/"
---

# RFC: Remix render watermarking — scheme choice

Slice 1 of [#2566](https://github.com/akoita/resonate/issues/2566) (Vision
Sprint 54, milestone 52), spike [#2572](https://github.com/akoita/resonate/issues/2572).
No product change. This RFC records which watermarking library goes into
`StemAudioMixer` in [#2573](https://github.com/akoita/resonate/issues/2573),
the measurements behind that choice, the licence position, and what the deploy
half (resonate-iac#333) must provision. The design itself (token table,
detection flow, evidence semantics) lives in #2566 and is not repeated here.

**Revenue line (ADR-BM-6):** vision-neutral rights-protection infrastructure.
It protects the licensing revenue that remix licences feed (line 3,
marketplace take-rate; line 5, B2B/agent licensing). No fee, split, price or
payout change. ADR-BM-4: no effect.

## Decision

**Pick: audiowmark 0.6.5, default strength 10, run as a separate process.**

<!-- DECISION-DETAIL -->

## What was measured

Harness: [`experiments/remix-watermarking-spike/`](../../experiments/remix-watermarking-spike/)
(`build_fixtures.sh`, `build_unmarked.sh`, `bench.py`, `audioseal_cost.py`,
`make_abx_kit.py`). Everything ran on a 4-vCPU Linux container, CPU only.

**Test set (10 renders, 60 s each).** The PCM mix exactly as `StemAudioMixer`
holds it before its final encode: 48 kHz stereo, `loudnorm` to -14 LUFS /
TP -1.5 (`REMIX_RENDER_AUDIO_POLICY`).

- 5 remix drafts: the Remix Studio demo renders in `web/public/help/audio/`
  (`original`, `ai-bass`, `vocal-echo`, `slowed-reverb`, `short-edit`),
  looped to 60 s.
- 3 mashups: two different demo renders summed with an offset and a level
  ratio (`orig-x-slowed`, `vocal-x-bass`, `edit-x-slowed`), the way a mashup
  project sums two artists' stems.
- 2 hard cases: a sparse tremolo pad with a pink-noise floor (where any
  added noise is easiest to hear) and a synthetic kick/hat loop (mostly
  near-silence between transients).

The repository has no larger audio corpus: the demo renders are the only real
remix audio checked in. See [Limits of this spike](#limits-of-this-spike).

**Pipeline per trial.** Embed a fresh random 128-bit token in the PCM mix →
encode the 320 kbit/s MP3 master the mixer ships → apply one attack → deliver
it as MP3 128 kbit/s (unless the attack is the codec step itself) → cut a
30-second excerpt at 0 s, 11.3 s and 24.9 s → detect. A trial succeeds only
when a decoded payload **equals** the embedded token (the database-lookup rule
#2575 will use). 10 renders × 3 excerpts = 30 trials per attack.

**Detector.** `audiowmark get` first; if nothing matches the token database,
retry with `--detect-speed`. The optional third stage (`--inverse-search`)
tries undoing a pitch shift or a pitch-preserving tempo change with
`rubberband` before giving up (see [Pitch and tempo](#pitch-and-tempo)).

**Attack set** (from #2572): MP3 128 and 64 kbit/s, AAC 128 kbit/s,
48 → 44.1 kHz resample, -14 LUFS re-normalisation (after a -9 dB drop),
±5 % speed (resample-style, pitch moves with it), ±5 % tempo with pitch kept,
±2 semitone pitch shift with tempo kept (`rubberband`), and mixed at -6 dB
under other, never-watermarked music.

## Results

### Robustness: token recovered from 30-second excerpts

<!-- RESULTS-TABLE -->

### False positives

<!-- FP -->

### Audible quality

<!-- QUALITY -->

### Cost and footprint

<!-- COST -->

## AudioSeal

**Not picked. Robustness on our music was not measured; the payload rules it
out regardless.**

- **Payload: 16 bits (65,536 values).** #2566 requires an opaque random
  128-bit token per render, looked up in `RemixRenderWatermark`. With 16
  bits, two renders share a value with 50 % probability after about 300
  renders (birthday bound), so a detected value cannot identify a render.
  At best it is a presence bit ("Resonate rendered this"), and audiowmark
  already gives that with a full token.
- **Robustness on music is unproven.** AudioSeal was trained on and its
  headline results are reported for speech. The model works on 16 kHz mono,
  so on a 48 kHz stereo mix the watermark can only live below 8 kHz as a
  residual added to the full-band mix (that is how `bench.py --scheme
  audioseal` embeds it).
- **Why no robustness numbers here.** The `audioseal` 0.2.1 wheel installs
  from PyPI, but its model cards load the checkpoints only from
  `huggingface.co`, which this spike's sandbox network does not reach. The
  harness has an AudioSeal adapter, so the same attack table can be produced
  anywhere Hugging Face is reachable:
  `bench.py robustness --scheme audioseal --fixtures … --work … --out …`.
  It would not change the decision, because of the payload.
- **Cost, measured** with `audioseal_cost.py`: the published 16-bit generator
  and detector architectures (14.7 M and 8.6 M parameters, about 94 MB of
  fp32 weights), built from the wheel's model cards with random weights.
  Inference cost does not depend on weight values. One CPU thread:
  **embed 9.6 s per minute of audio** (about 30 times audiowmark),
  **detect 2.4 s per 30-second clip**.
- **Footprint, measured:** `pip install audioseal` from PyPI pulled the
  default CUDA build of PyTorch, and the virtualenv came to **5.5 GB** (torch
  1.2 GB, NVIDIA CUDA libraries 3.0 GB, triton 1.0 GB). A CPU-only torch build
  is much smaller, but the PyTorch CPU index was also unreachable here, so its
  size was not measured. Either way the backend is Node, so AudioSeal means a
  Python service or worker next to it, not a binary in the backend image.
- **Licence:** MIT for code and weights. No licence obstacle.

WavMark (optional in #2572) was not run: 32 bits has the same collision
problem for per-render tokens, and its weights are also hosted on Hugging Face.

## Licence: audiowmark is GPLv3

audiowmark is **GPL-3.0-or-later** (upstream `COPYING`). Our use is fine
when we keep it a separate program:

- **Separate process, no linking.** The backend calls the `audiowmark`
  executable with `execFile`, passing audio through files or stdin/stdout,
  the same way it already calls `ffmpeg`. The FSF's GPL FAQ treats programs
  that communicate through pipes, files and command-line arguments as
  separate works ("aggregate"), so the GPL does not extend to the Node
  backend. Do **not** link `libaudiowmark`/its C++ sources into a Node
  native addon, and do not vendor its source into this repository.
- **Running it on our servers is not distribution.** GPLv3 (unlike AGPL)
  attaches no obligation to running the program as a network service. The
  backend image is pulled only by our own deploys.
- **If we ever distribute an image or binary that contains it** (a public
  container image, a self-host bundle, the desktop app), we must ship the
  GPLv3 text and offer the corresponding source of that exact audiowmark
  build. Building from a pinned upstream release tag makes that trivial:
  the offer points at the tag.
- **Record it.** #2573 adds an audiowmark entry to `NOTICE` (name, version,
  licence, upstream URL, "invoked as a separate program") next to the
  existing third-party entries.
- The watermark **key** is ours and is not covered by the GPL; it stays in
  Secret Manager.

This is the engineering reading of the licence, not legal advice. Nothing in
it is unusual (it is the standard position for calling GPL command-line tools
from proprietary code), but the owner can ask counsel to confirm before
#2573 ships.

## What this means for #2573 (embed)

- **Where:** in `FfmpegStemAudioMixer`, after the ffmpeg graph has produced the
  48 kHz PCM mix and before the `libmp3lame` 320k encode. Today one ffmpeg
  process mixes and encodes in one go (`pushOutputArgs`). With a key set,
  split it: ffmpeg writes the PCM mix (temp WAV, or raw float on stdout) →
  `audiowmark add --key <file> - - <token>` → ffmpeg encodes the MP3. audiowmark
  streams stdin to stdout (`-` for both ends, `--format raw` for raw PCM), so
  no extra temp files are needed. With **no key, keep today's single-process
  path byte-identical**, so existing renders and parity fixtures do not move.
- **Stem taps (Pro stems zip):** embed the same token in each rendered stem
  FLAC (stem index in the token row). Each stem is embedded separately, so
  each stem carries a readable mark on its own.
- **DJ extended:** it re-renders the stored 320k master. The spike shows the
  mark survives a re-encode of that master and 30-second cuts of it, but #2573
  still needs the export-survival test on a real DJ extended render.
- **Config (names are #2573's to choose, documented in
  `docs/deployment/environment.md`):** the active key (the audiowmark key-file
  text: `key <32 hex chars>`, plus a `name`), a key ID recorded in the token
  row, an optional retired key for detection after rotation, the strength
  (default 10), and the binary path (default `audiowmark` on `PATH`). The
  backend writes the key to a 0600 file in its private temp dir at startup,
  because `--key` takes a file path. Never log it.
- **No key → no watermark.** Render metadata records `watermark: none`. If the
  binary is missing, times out or exits non-zero, log a warning, record
  `watermark: none` (with a failure reason) and ship the unwatermarked
  render. A watermark problem must never fail a render, publish or export.
- **Metadata:** record scheme `audiowmark`, version `0.6.5`, strength and key
  ID with the token row, so the detector (#2575) knows which key and settings
  to try.
- **Cost:** about 0.3 s per minute of audio per render on one core, small
  next to the ffmpeg mix. Use a timeout well above that (e.g. 30 s per
  minute of audio) so a stuck process cannot hold a render slot.
- **Preview parity:** strength 10 adds a residual about 36 dB below the
  programme loudness (see [Audible quality](#audible-quality)). The parity
  tests compare against the browser preview within tolerance, so check them
  with the mark on; if a tolerance trips, compare against the pre-watermark
  PCM instead of the encoded master.
- **For #2575 (detect):** run `audiowmark get` with `--key` for the active and
  retired keys (it accepts the option more than once), retry with
  `--detect-speed`, and treat only an exact database match as a hit. The
  inverse pitch/tempo search is an optional extra stage. Detection takes
  3–4 s per 30-second clip, about 20 s with speed search, so run it as an
  async admin job, not in the request.

## What this means for resonate-iac#333 (deploy)

resonate-iac#333 needs, for the **backend image** (not a Python worker):

1. **The `audiowmark` binary**, built from the pinned upstream release
   (0.6.5) in a builder stage, with only the binary copied into the runtime
   stage. Build dependencies (Debian names): `build-essential autoconf
   automake libtool pkg-config libfftw3-dev libsndfile1-dev libgcrypt20-dev
   libzita-resampler-dev libmpg123-dev`. Runtime libraries:
   `libfftw3-single3 libsndfile1 libgcrypt20 libzita-resampler1 libmpg123-0`
   (most of the codec libraries are already present for ffmpeg). If the base
   image's distribution ships an `audiowmark` package of the same version,
   installing that is simpler; check it at implementation time. Measured
   footprint: the stripped binary is **0.65 MB**; its shared libraries total
   about 13 MB including glibc/libstdc++, and the new ones on top of the
   current image (FFTW single precision, zita-resampler, possibly libgcrypt)
   add only a few MB. The build takes under a minute.
2. **The watermark key secret** per environment, with a slot for a retired
   key, exposed to the backend service through the env var names #2573
   documents. The key is generated with `audiowmark gen-key` by the operator
   and written to Secret Manager by the operator (agents cannot write secret
   values). No default; an environment without the secret renders without a
   watermark.
3. Wire the env vars into **both** apply workflows so a services-only roll
   does not drop them.
4. Optional: the strength as a plain (non-secret) env var if we ever want to
   change it per environment.

No GPU, no Python worker and no model download are needed.

## Exit criteria check

<!-- EXIT -->

## Limits of this spike

<!-- LIMITS -->

## Reproduce

<!-- REPRO -->
