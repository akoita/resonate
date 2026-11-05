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

**Pick: audiowmark 0.6.5 at strength 15, run as a separate process.** The
owner's blind A/B check sets the final strength. Detection runs in three
stages: plain decode, then `--detect-speed`, then an inverse pitch/tempo
search.

Why:

1. **It is the only candidate that carries the payload the design needs.**
   128 bits, keyed with an AES-128 key, so a random per-render token fits and
   rotation works by key. AudioSeal carries 16 bits; WavMark carries 32.
2. **It meets the robustness bar on real remix and mashup renders.** At
   strength 15, the token came back from **every one of the 312 30-second
   excerpts** taken from the 8 real renders under all 13 attacks (codec,
   resample, loudness, speed, tempo, pitch, mix-under), each delivered as MP3
   128 kbit/s. Over all 10 fixtures, including two synthetic hard cases, it
   was 365/378 (96.6 %).
3. **No false positives.** 0 of 1,000 unwatermarked excerpts produced a payload
   that matched any of 10,000 database tokens. A false match needs all 128
   bits to agree with a stored token.
4. **Cheap and small.** Embedding takes about 0.3 s per minute of audio, the
   stripped binary is 0.65 MB, and it runs as a separate process like ffmpeg.
   No GPU, no Python, no model download.
5. **The GPLv3 licence is fine for us** when it runs as a separate program
   (see [Licence](#licence-audiowmark-is-gplv3)).

What it does **not** do on its own: survive pitch shifts or tempo changes
that keep pitch. Plain decoding scored 0 % on both. The inverse search fixes
this for whole-semitone and whole-percent changes (27/27 each), but it only
works when the guess lands within about 0.1 semitone or 0.2 % tempo of the real
change. Arbitrary shifts need the fine grid, which is slower (see
[Pitch and tempo](#pitch-and-tempo)). That is acceptable for a detector run
by an admin, and it is the main robustness caveat to know about.

**Strength 10 versus 15.** Strength 10 (upstream default) was as good on
codecs, resampling, loudness and speed for the real renders. It recovered only
13/24 under the -6 dB music bed, against 24/24 at strength 15. Strength 15
costs about 3.5 dB more watermark residual (still about 32 dB below the
programme). If the blind check hears strength 15, use 10 and accept the
weaker mix-under result. The strength is a config value, so changing it later
needs no code change.

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

Hits out of trials (10 renders × 3 excerpts; "real" means the 8 remix and
mashup renders, without the two synthetic hard cases). Every attacked file
is delivered as MP3 128 kbit/s before cutting the excerpt. Wrong-token
matches: **0 in every run.**

| Attack | s10, all | s10, real | s15, all | s15, real | s15 + inverse search (real / sparse pad) |
| --- | --- | --- | --- | --- | --- |
| none (320k master) | 30/30 | 24/24 | 30/30 | 24/24 | – |
| MP3 128k | 30/30 | 24/24 | 30/30 | 24/24 | – |
| MP3 64k | 27/30 | 24/24 | 30/30 | 24/24 | – |
| AAC 128k | 27/30 | 24/24 | 29/30 | 24/24 | – |
| resample 48 → 44.1 kHz | 30/30 | 24/24 | 30/30 | 24/24 | – |
| -14 LUFS re-normalisation | 30/30 | 24/24 | 30/30 | 24/24 | – |
| speed +5 % | 27/30 | 24/24 | 27/30 | 24/24 | – |
| speed -5 % | 27/30 | 24/24 | 27/30 | 24/24 | – |
| tempo +5 %, pitch kept | 0/30 | 0/24 | 0/30 | 0/24 | 24/24 / 3/3 |
| tempo -5 %, pitch kept | 0/30 | 0/24 | 0/30 | 0/24 | 24/24 / 3/3 |
| pitch +2 semitones | 0/30 | 0/24 | 0/30 | 0/24 | 24/24 / 3/3 |
| pitch -2 semitones | 0/30 | 0/24 | 0/30 | 0/24 | 24/24 / 3/3 |
| under other music at -6 dB | 13/30 | 13/24 | 24/30 | 24/24 | – |

The misses in the "all" columns are the two synthetic signals. The
**electro loop** (a kick and hi-hat with near-silence between hits) lost the
mark under MP3 64k/AAC at strength 10, under ±5 % speed, and under the music
bed. The **sparse pad** lost it under the music bed: at -6 dB under another
track, its quiet mark is buried. Real music, which has more energy for the
watermark to hide in, did not fail. The inverse search was not run on the
electro loop, since it already fails the speed attack.

Speed changes (pitch moves with tempo, like a turntable) are handled by
audiowmark's own `--detect-speed`. Of the 241 strength-10 hits, 54 came from
that second pass.

#### Pitch and tempo

audiowmark hides the bits in fixed frequency bands over fixed time frames, so
a pitch shift (bands move) or a time stretch with pitch kept (frames move)
breaks decoding completely. Speed detection does not help: it corrects a
combined pitch-and-tempo change, not one alone.

The fix is on the detector side. Undo a guessed shift with `rubberband` and
decode again, likeliest guesses first: ±1 and ±2 semitones, then ±1…6 %
tempo, then (`--inverse-search full`) a 0.1-semitone / 0.2 % grid over
±2.5 semitones and ±6 %. Measured by hand, decoding still works with about
0.1 semitone of leftover pitch error and fails at 0.25. For tempo it works
with an exact undo and fails at 0.27 % off. The coarse grid recovered all
attacked excerpts in a median of 6.5 tries (maximum 15), taking 13–68 s per
excerpt on the shared container. A full-grid search over a clip with no
watermark at all costs about 140 decodes, a few minutes of CPU. That is fine
for an async admin job (#2575) and unacceptable inline.

### False positives

Detector: plain `audiowmark get` with the spike key. Database: 10,000
random 128-bit tokens. Clips: **1,000 never-watermarked 30-second
excerpts**, each a different combination of 25 sources (the 10 clean
fixtures plus 15 processed variants of the demo renders), the 13 attacks and
a random offset.

| Detector | Clips | Candidate payloads decoded | Matches in the database |
| --- | --- | --- | --- |
| plain | 1,000 | ~8,000 (every clip yields some) | **0** |
| plain → `--detect-speed` → coarse inverse search (the #2575 detector) | 200 (subset, same generator) | 4,320 | **0** |

audiowmark always prints its best guesses, even for unmarked audio, so
"decoded something" is meaningless. Only an exact database match counts,
which is why the token must be random and must be looked up. With a 128-bit
token, the chance that one junk guess equals one of N stored tokens is
N / 2¹²⁸, which is negligible at any realistic N. The extra decodes from speed
and inverse search multiply the guesses by a few hundred at most, which does
not change that.

### Audible quality

Measured on the PCM mix, before the MP3 encode. Residual is the integrated
loudness of (watermarked − original), against programme loudness of
-14 LUFS.

| Fixture group | SNR, strength 10 | Residual, strength 10 | SNR, strength 15 | Residual, strength 15 |
| --- | --- | --- | --- | --- |
| 8 real renders | 37.9–42.4 dB | -49.6 to -51.9 LUFS | 34.3–38.9 dB | -46.1 to -48.3 LUFS |
| sparse pad | 52.6 dB | -63.1 LUFS | 49.0 dB | -60.0 LUFS |
| electro loop | 42.7 dB | -57.1 LUFS | 39.1 dB | -53.6 LUFS |

audiowmark shapes the mark to the music (quieter material gets a quieter
mark), so the residual sits 32–36 dB under the programme on real renders and
about 46 dB under it on the sparse pad. That is a low level for a mark shaped to the music, and upstream describes
lower strengths as less audible and higher ones as more robust. **But SNR is
not a listening test.** The blind A/B check is still open: run `make_abx_kit.py` at strength
15 (and 10 if needed), listen on good headphones, and score. A score near
50 % passes.

### Cost and footprint

| | audiowmark 0.6.5 | AudioSeal 0.2.1 (16-bit) |
| --- | --- | --- |
| Embed, per minute of audio | **0.28–0.35 s** (wall time, shared 4 vCPU) | 9.6 s (1 thread) |
| Detect, per 30 s clip | 2.1 s median unloaded / 3.3 s under load; about 15 s more with `--detect-speed`; 13–68 s with the coarse inverse search | 2.4 s (1 thread) |
| Runtime footprint | stripped binary 0.65 MB, plus FFTW, libsndfile, libgcrypt, zita-resampler and mpg123 (13 MB of shared libraries in total including glibc; most are already in the image for ffmpeg) | PyTorch: 5.5 GB virtualenv from PyPI (CUDA build); CPU-only build not measurable here. About 94 MB of weights |
| Runs as | separate CLI process, streams stdin → stdout | Python library, so a Python service |
| Payload | 128 bits, keyed | 16 bits, unkeyed |
| Licence | GPL-3.0-or-later | MIT |

The detect times include the speed and inverse passes only when the earlier
stages found nothing. On an exported file that was not pitch- or
tempo-shifted, the plain pass answers in 2–4 s.

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
  the same way it already calls `ffmpeg`. The FSF's GPL FAQ (on "mere aggregation")
  says pipes, sockets and command-line arguments are the mechanisms normally
  used between two separate programs, so the GPL does not extend to the Node
  backend that calls it. Do **not** link `libaudiowmark`/its C++ sources into a Node
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
  (default 15, see [Decision](#decision)), and the binary path (default `audiowmark` on `PATH`). The
  backend writes the key to a 0600 file in its private temp dir at startup,
  because `--key` takes a file path. Never log it.
- **No key → no watermark.** Render metadata records `watermark: none`. If the
  binary is missing, times out or exits non-zero, log a warning, record
  `watermark: none` (with a failure reason) and ship the unwatermarked
  render. A watermark problem must never fail a render, publish or export.
- **Metadata:** record scheme `audiowmark`, version `0.6.5`, strength and key
  ID with the token row, so the detector (#2575) knows which key and settings
  to try.
- **Cost:** about 0.3 s per minute of audio per render, small
  next to the ffmpeg mix. Use a timeout well above that (e.g. 30 s per
  minute of audio) so a stuck process cannot hold a render slot.
- **Preview parity:** strength 15 adds a residual about 32–36 dB below the
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

| #2572 exit criterion | Result |
| --- | --- |
| Token recovered from ≥95 % of 30 s excerpts after the attack set at 128 kbit/s | **Met on the real renders:** 312/312 (100 %) at strength 15 with the full detector. All 10 fixtures: 365/378 (96.6 %), with the 13 misses all on the two synthetic signals and the electro loop's 12 pitch/tempo trials not run (93.6 % if all 12 count as misses). Caveat: the inverse search recovers whole-number pitch/tempo changes quickly. Arbitrary values need the slower fine grid. |
| No false positive on the unwatermarked set | **Met on the proxy set:** 0 of 1,000 excerpts from 25 sources (plain detector), and 0 of 200 with the full three-stage detector. The ≥1,000 *catalog tracks* run waits for staging access (#2575). |
| No audible difference in a blind check | **Open:** needs a human listener. Kit: `make_abx_kit.py`. Objective residual: 32–36 dB under programme at strength 15. |
| If no open-source option meets the bar, name the fallback | audiowmark meets it, apart from the human check. Fallback if the blind check fails at every usable strength, or if pitch/tempo-robustness without a detector search becomes a requirement: commercial forensic watermarking, for an owner decision. |

## Limits of this spike

- **Small, derived test set.** 10 renders, built from the five Remix Studio
  demo renders (the only real remix audio in the repository), plus two
  synthetic hard cases. The demos are 10–21 s long and were looped to 60 s.
  Genres are narrow. Before #2573 is called done, repeat the robustness table
  on 20+ real staging remix and mashup renders across genres (the harness
  takes any folder of WAVs in `clean/`).
- **False positives were measured on 1,000 excerpts from 25 sources**, not on
  1,000 distinct catalog tracks: this sandbox has no catalog access. Each
  excerpt is a different source/attack/offset combination, which exercises
  the decoder's chance of emitting a matching payload, but it is not the
  catalog-scale check #2572 asks for. #2575 should run the detector over
  ≥1,000 staging catalog tracks once the detect path exists.
- **No human listening test yet.** The blind A/B check needs ears;
  `make_abx_kit.py` builds the kit (10 randomised pairs plus a sealed answer
  key) for the owner to run. Until then, audibility rests on the residual
  measurements below.
- **AudioSeal robustness not measured** (checkpoint host unreachable from the
  sandbox). Its payload size disqualifies it for per-render tokens anyway.
- **Timings come from a shared 4-vCPU container**, with several jobs running at
  once. Treat them as order-of-magnitude figures, not benchmarks.

## Reproduce

Needs `ffmpeg`, `rubberband` (CLI), Python 3 with `numpy` and
`soundfile`, and an `audiowmark` 0.6.5 build.

```bash
experiments/remix-watermarking-spike/build_fixtures.sh /tmp/wm/fx
```

```bash
experiments/remix-watermarking-spike/build_unmarked.sh /tmp/wm/fx
```

```bash
audiowmark gen-key /tmp/wm/spike.key
```

```bash
python3 experiments/remix-watermarking-spike/bench.py robustness --scheme audiowmark \
  --key /tmp/wm/spike.key --fixtures /tmp/wm/fx --work /tmp/wm/work --out /tmp/wm/robustness.json
```

```bash
python3 experiments/remix-watermarking-spike/bench.py falsepos --scheme audiowmark \
  --key /tmp/wm/spike.key --fixtures /tmp/wm/fx --work /tmp/wm/work --out /tmp/wm/fp.json --count 1000
```

Options: `--strength 15`, `--inverse-search coarse|full`, `--no-speed`,
`--attacks <substring…>`, `--only <fixture substring…>`. The result JSON files
behind the tables are in `experiments/remix-watermarking-spike/results/`
(spike tokens redacted).
