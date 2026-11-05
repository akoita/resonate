#!/usr/bin/env python3
"""CPU cost of AudioSeal embed/detect without its checkpoints (#2572).

Builds the published 16-bit generator and detector architectures from the
model cards shipped in the `audioseal` wheel, with random weights, and times a
forward pass on N seconds of 16 kHz mono audio. Inference cost does not depend
on weight values, so this measures cost only; it says nothing about
robustness. Use it where huggingface.co (the only checkpoint host) is
unreachable.
"""
import sys
import time

import torch
from omegaconf import OmegaConf

from audioseal.builder import (AudioSealDetectorConfig, AudioSealWMConfig,
                               create_detector, create_generator)
from audioseal.loader import AudioSeal, load_local_model_config

secs = float(sys.argv[1]) if len(sys.argv) > 1 else 60.0
threads = int(sys.argv[2]) if len(sys.argv) > 2 else 1
torch.set_num_threads(threads)


def build(card, cfg_type, make):
    cfg = OmegaConf.to_container(load_local_model_config(card))
    cfg.pop("checkpoint")
    return make(AudioSeal.parse_config(cfg, config_type=cfg_type)).eval()


gen = build("audioseal_wm_16bits", AudioSealWMConfig, create_generator)
det = build("audioseal_detector_16bits", AudioSealDetectorConfig, create_detector)
x = torch.randn(1, 1, int(16000 * secs)) * 0.1
msg = torch.randint(0, 2, (1, 16))
with torch.no_grad():
    gen.get_watermark(x, 16000, message=msg)  # warm-up (same shape: torch.compile)
    t0 = time.perf_counter()
    wm = gen.get_watermark(x, 16000, message=msg)
    t_embed = time.perf_counter() - t0
    det.detect_watermark(x + wm, 16000)  # warm-up
    t0 = time.perf_counter()
    det.detect_watermark(x + wm, 16000)
    t_detect = time.perf_counter() - t0
params = sum(p.numel() for p in gen.parameters()), sum(p.numel() for p in det.parameters())
print(f"audio={secs}s threads={threads} embed={t_embed:.2f}s detect={t_detect:.2f}s "
      f"params gen={params[0]/1e6:.1f}M det={params[1]/1e6:.1f}M")
