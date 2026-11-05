# Remix watermarking spike (#2572)

Throwaway harness behind [`docs/rfc/remix-watermarking.md`](../../docs/rfc/remix-watermarking.md).
Nothing here ships in a product image.

| File | Purpose |
| --- | --- |
| `build_fixtures.sh` | 10 clean 60 s renders (5 remix drafts, 3 mashups, 2 hard cases) from `web/public/help/audio/`, as 48 kHz -14 LUFS PCM, plus the never-watermarked "other music" bed |
| `build_unmarked.sh` | 15 extra never-watermarked sources for the false-positive run |
| `bench.py` | `robustness` (embed → 320k master → attack → MP3 128k → 30 s excerpts → detect) and `falsepos` (unmarked excerpts against a 10,000-token database). audiowmark and AudioSeal adapters |
| `audioseal_cost.py` | AudioSeal CPU cost from the published architectures, without the Hugging Face checkpoints |
| `make_abx_kit.py` | Blind A/B listening kit with a sealed answer key |
| `results/` | JSON behind the RFC tables (spike tokens redacted) |

Requirements: `ffmpeg`, `rubberband` CLI, Python 3 with `numpy` and
`soundfile`, an `audiowmark` 0.6.5 build (upstream
<https://github.com/swesterfeld/audiowmark>, GPL-3.0-or-later; build it
yourself, it is not vendored here). AudioSeal also needs `audioseal` and
`torch`, plus access to huggingface.co for its checkpoints. Commands are in
the RFC's *Reproduce* section.
