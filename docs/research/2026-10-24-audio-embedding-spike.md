---
title: "Audio embeddings in a joint text-audio space for AI DJ retrieval (spike #2248)"
status: draft
issues:
  - "https://github.com/akoita/resonate/issues/2248"
related:
  - "https://github.com/akoita/resonate/issues/2235"
  - "https://github.com/akoita/resonate/issues/2240"
  - "https://github.com/akoita/resonate/issues/2242"
date: 2026-10-24
---

# Audio embeddings for AI DJ retrieval: spike findings

ADR-BM-6: vision-neutral infrastructure/quality. No money, payout or licensing path is touched.

## Question

AI DJ classifies a track from text only (genre, title, release title mapped to descriptor families, text embeddings of that text, plus measured tempo/energy/vocal bands). Test tracks showed that this text is sometimes wrong or thin: a West African track tagged "African" or with no genre, and rap tagged "Rap", "Hip-Hop", "Hip-hop/Rap" or "Rap français". Does an audio embedding in a joint text-audio space add genre/style evidence that text lacks, at an acceptable worker cost? The issue's rule: adopt only if it beats descriptors + hybrid on the cases that matter at acceptable cost.

## Verdict

**Do not adopt now. Record and close.** Audio embeddings are real evidence (best candidate: zero-shot family 20/26 correct with the genre tag removed), but on this 27-track set they do not beat the text descriptors where a tag exists, and they cannot be shown to beat the 90% recall@20 baseline (#2240/#2242), because the #2235 golden set is synthetic metadata with no audio, so it cannot score an audio source. The one place audio clearly helps, tracks with no or generic genre, is not yet shown to be a real share of the catalog. Re-open with the trigger at the end.

## Models and licences (gate)

| Candidate | Code | Weights | Result |
|---|---|---|---|
| `google/embeddinggemma-2` (text+audio, 744M total, 570M with audio, 768-d, MRL 128-768) | Apache-2.0 | Apache-2.0 (HF card; licence link `ai.google.dev/gemma/apache_2`). The card also asks deployments to follow the Gemma Prohibited Use Policy. | PASS, evaluated |
| `microsoft/msclap` 2023 (1024-d, 690 MB weights) | MIT (`microsoft/CLAP` LICENSE) | `ms-pl`, Microsoft Public License (HF card `huggingface.co/microsoft/msclap`) | PASS, evaluated |
| `laion/larger_clap_music_and_speech`, `laion/clap-htsat-unfused` (512-d, 194M) | Apache-2.0 | Apache-2.0 (HF cards); original checkpoints `lukewys/laion_clap` are CC0 | PASS, evaluated |
| `laion/larger_clap_music` | same | Apache-2.0 | Licence passes but the HF checkpoint is unusable: logit scales are about 0.03 and every text-audio cosine is about 0, even for "dog barking". Excluded (not a licence matter). |
| MERT | | CC-BY-NC | Rejected, non-commercial |

Caveat for all: a permissive model licence does not clear the rights in the training data (audio-text corpora of mixed provenance). Legal review of that is separate from this spike and is a precondition for adoption.

## Data and caveats

- Source: the 27 tracks of the deployed test catalog, fetched through the same public catalog stream endpoint the web player uses (`/catalog/releases/:releaseId/tracks/:trackId/stream`, range-capable, no credentials). Nothing was kept in the repo.
- One excerpt per track starting 30 s in (45 s extracted). **EmbeddingGemma 2's processor silently truncates audio to 30 s** (the card says about 327 s), so it saw 30 s; CLAP models averaged 4x10 s (LAION) or 6x7 s (MS-CLAP) windows.
- **N = 27, one excerpt each, one author-judged ground truth. Treat every number as a sketch.** "Text tag" family = the public genre string mapped by hand (Rap/Hip-Hop/Hip-hop/Rap/Rap français to rap; African/World/Musiques du monde to world; Pop/J-Pop to pop; R&B, R&B/Soul to rnb; Reggae; New Age; Alternative). This is a simplified stand-in for the descriptor mapping in `backend/src/modules/descriptors/`, not the real code.
- "Corrected" family = my belief, not verified by listening: Makoma "Butu na moyi" (tagged Pop, Congolese) is world; the Justin Timberlake interlude (Pop) is rnb. "Interesting" cases: Mawa Traore "Taama" (African), "Cono" (World), Salif Keita "N B'I Fe" (World), Makoma (Pop), Nancy Ajram (Musiques du monde, really Arabic pop), Tiken Jah Fakoly (Reggae, West African).
- The text baseline is nearly circular here: ground truth is derived from the same tags. Text therefore looks strong by construction; the honest comparison is only where tags are generic, wrong or removed.

## Results

Zero-shot text-to-audio retrieval, mean over 12 queries (6 families x 2 phrasings), recall against the corrected set:

| Model | R@5 | R@10 | zero-shot family (6 prompts, n=26) | 1-NN same family as tag |
|---|---|---|---|---|
| EmbeddingGemma 2 (30 s) | 0.48 | **0.89** | **20/26** | 16/27 |
| MS-CLAP 2023 | 0.56 | 0.78 | 14/26 | 18/27 |
| LAION music+speech | **0.65** | 0.80 | 15/26 | **19/27** |
| LAION unfused | 0.57 | 0.75 | 8/26 | 16/27 |
| (LAION larger_clap_music, broken) | 0.14 | 0.31 | 0/26 | 8/27 |

R@5 is capped near 0.56 for the 9-track rap set. Majority-class baseline for 1-NN is 9/27 (rap).

EmbeddingGemma 2 per query (first phrasing; recall vs corrected set):

| Query | relevant | R@5 | R@10 |
|---|---|---|---|
| hip hop / rap | 9 | 0.56 | 1.00 |
| west african / world music with kora or traditional instruments | 5 | 0.80 | 1.00 |
| pop ballad | 6 | 0.50 | 1.00 |
| reggae | 1 | 1.00 | 1.00 |
| R&B | 3 | 0.00 | 0.67 |
| new age / ambient | 2 | 0.50 | 0.50 |

Metadata-poor cases. West-African query rank of 27 (EmbeddingGemma 2 / MS-CLAP): Cono 1/3, Taama 2/2, Salif Keita 3/1, Makoma 5/9, Tiken Jah 4/6. With the genre tag blanked, zero-shot family for the three Mandingue tracks is "world" 3/3 for both models; Makoma (tagged Pop) is "world" only for EmbeddingGemma 2 (MS-CLAP says rap). Audio also puts all nine rap-tagged tracks in the rap family for EmbeddingGemma 2 and MS-CLAP (8/9 for LAION), with no use of the label.

Audio versus text:

- **Audio fixes a text miss** in two places: tracks with a generic or missing genre ("African", "World" or blank) get the right family; and Makoma, mis-tagged Pop, lands at rank 5 for the West-African query (one track, unverified).
- **Audio adds noise** elsewhere. Zero-shot errors (EmbeddingGemma 2): Aya Nakamura to rap, Keri Hilson (R&B) to pop, a New Age track to pop, Nancy Ajram to pop (arguably right), Tiken Jah to world (arguably right). R&B and reggae are weak (R@5 0.00/1.00 on one or two tracks, and the "reggae with offbeat guitar" phrasing misses at 5).
- Naively unioning the text set with audio top-2 keeps recall (0.91, unchanged for EmbeddingGemma 2) but drops mean precision from 0.96 to 0.71. Audio would have to enter as a weighted fusion source, not an OR.
- Audio-only neighbours cluster by family only loosely: EmbeddingGemma 2 top-3 same-family fraction 0.51 (LAION 0.57), with clear clusters for the Mandingue trio, Fabolous and Booba, and noisy pop/R&B/New Age mixing. Leakage of production style (a pop-ballad vs a pop-rap sound) dominates the label.

## Cost (CPU, this sandbox: 20-core WSL2, torch 2.14 CPU, fp32)

| Model | Dim / storage per vector | Weights | Peak RSS | Wall per excerpt (4 threads) |
|---|---|---|---|---|
| EmbeddingGemma 2 (text+audio loaded) | 768 / 3 KB (256 MRL: 1 KB) | 744M params bf16 (about 1.5 GB) | 3.8 GB | 4.1 s per 30 s window; 12 s at 1 thread (14 CPU-s) |
| MS-CLAP 2023 | 1024 / 4 KB | 690 MB | 2.1 GB | 0.8 s per 42 s |
| LAION music+speech | 512 / 2 KB | 194M params | 2.3 GB | 1.3 s per 40 s |

Per full track (about 3.5 min), covering it in windows: EmbeddingGemma 2 is about 7 windows, so roughly 30 s wall at 4 threads or 85 s at 1 thread, once per track; a 3-window sample is 12 s / 36 s. All vectors fit pgvector (`vector(768)`; indexes allow up to 2000 dims). One embedding per track, never per pick, so cost is a one-off backfill plus ingestion. Memory (about 4 GB for EmbeddingGemma 2) is the real constraint for the existing worker and must be checked against its limit in `resonate-iac`.

Text side (issue comment): EmbeddingGemma 2 loads text-only at 270M params and embeds text in the same space, which could replace the Vertex text embeddings in-house (privacy gain). That was not measured here; it needs its own comparison on the real query set.

## Decision against the issue rule

It does not beat descriptors + hybrid on the cases that matter in this evidence: where tags exist the text path is already near-perfect, audio recall is 0.5-0.9 at best, and the union costs precision. Its advantage is confined to untagged or generic-tagged tracks, whose real share in the catalog is unknown. Cost is acceptable only as a once-per-track backfill with about 4 GB headroom. So: record and close.

**Re-open when** (a) a measurement of the real catalog shows that more than a few percent of tracks end with no descriptor family, and (b) the same harness run on the #2235 golden set shows audio-as-extra-source raises mean recall@20 above 90% without a precision loss.

If re-opened, the implementation issue is: one embedding per track on the existing analysis worker (30 s windows, mean, EmbeddingGemma 2 at 256-d MRL or MS-CLAP), stored in a pgvector column with model/version; a new retrieval source in hybrid fusion with its own per-source budget (RRF weight below text); a classification evidence source used only when the descriptor has no family; legal sign-off on training-data provenance; a backfill job and a kill switch.

## How to reproduce (no data committed)

Work outside the repo; run with `python -I`. Audio is untrusted input.

1. List published tracks from the test environment's public catalog (`GET /catalog/published`, base URL = that environment's `NEXT_PUBLIC_API_URL`), then download each with `GET /catalog/releases/{releaseId}/tracks/{trackId}/stream` (no credentials).
2. Excerpt: `ffmpeg -ss 30 -t 45 -i in -ac 1 -ar 16000 out.16k.wav` (48000 for LAION, 44100 for MS-CLAP).
3. `uv venv`; install CPU `torch`, `torchaudio`, `torchvision`, `transformers`, `sentence-transformers`, `pillow`, `soundfile`. Core of the EmbeddingGemma 2 run:

```python
import numpy as np, soundfile as sf, torch
from sentence_transformers import SentenceTransformer
m = SentenceTransformer("google/embeddinggemma-2",
        config_kwargs={"vision_config": None}, model_kwargs={"torch_dtype": torch.float32})
q = m.encode(["hip hop / rap", "reggae", "pop ballad"], prompt_name="SearchQuery",
             normalize_embeddings=True)           # float16 gives NaN: use fp32/bf16
a = np.stack([m.encode({"audio": sf.read(p, dtype="float32")[0][:16000*30]},
                       normalize_embeddings=True) for p in clips])   # audio is cut at 30 s
rank = np.argsort(-(q @ a.T), axis=1)             # recall@k against your labels
```

LAION: `ClapModel.from_pretrained("laion/larger_clap_music_and_speech")`, `get_audio_features(...).pooler_output` (transformers 5) on 10 s windows. MS-CLAP: `pip install msclap`, weights `CLAP_weights_2023.pth` from `microsoft/msclap`, 7 s windows. Measure CPU with `time.process_time()` and peak memory with `resource.getrusage`.
