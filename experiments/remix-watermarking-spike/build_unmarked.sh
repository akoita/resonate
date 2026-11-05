#!/usr/bin/env bash
# Extra never-watermarked sources for the false-positive run (#2572): each demo
# render in three processed variants (offset loop, EQ tilt + reverb, half-speed
# lo-fi), 60 s, -14 LUFS. Together with build_fixtures.sh's clean set this gives
# 25 distinct sources that bench.py falsepos cycles through attacks and offsets.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO/web/public/help/audio"
OUT="${1:?usage: build_unmarked.sh <fixtures-dir>}/unmarked"
mkdir -p "$OUT"
FF=(ffmpeg -hide_banner -loglevel error -y)
NORM="loudnorm=I=-14:LRA=11:TP=-1.5,aresample=48000"
for name in original ai-bass vocal-echo slowed-reverb short-edit; do
  in="$SRC/remix-demo-$name.mp3"
  "${FF[@]}" -stream_loop -1 -ss 4.2 -i "$in" -t 60 -af "$NORM" -ac 2 "$OUT/$name-offset.wav"
  "${FF[@]}" -stream_loop -1 -i "$in" -t 60 -af "treble=g=4,bass=g=-3,aecho=0.8:0.6:90:0.3,$NORM" -ac 2 "$OUT/$name-eqverb.wav"
  "${FF[@]}" -stream_loop -1 -i "$in" -t 60 -af "asetrate=48000*0.5,aresample=48000,lowpass=f=5000,$NORM" -ac 2 "$OUT/$name-lofi.wav"
done
ls "$OUT" | wc -l
