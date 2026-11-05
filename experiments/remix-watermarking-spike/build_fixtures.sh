#!/usr/bin/env bash
# Build the spike test set (#2572) from the repo's remix demo renders.
# Output: 48 kHz stereo 24-bit WAV, -14 LUFS, 60 s each — the PCM mix that
# StemAudioMixer holds just before its final libmp3lame 320k encode.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO/web/public/help/audio"
OUT="${1:?usage: build_fixtures.sh <out-dir>}"
mkdir -p "$OUT/clean" "$OUT/other"
FF=(ffmpeg -hide_banner -loglevel error -y)
NORM="loudnorm=I=-14:LRA=11:TP=-1.5,aresample=48000"
DUR=60

# Remix drafts: each demo render looped to 60 s, re-normalised.
for name in original ai-bass vocal-echo slowed-reverb short-edit; do
  "${FF[@]}" -stream_loop -1 -i "$SRC/remix-demo-$name.mp3" -t $DUR \
    -af "$NORM" -ar 48000 -ac 2 -c:a pcm_s24le "$OUT/clean/remix-$name.wav"
done

# Mashups: two different renders mixed (second one offset and level-matched),
# the way a mashup project sums two artists' stems.
mash() { # out a b offset_s weight_b
  "${FF[@]}" -stream_loop -1 -i "$SRC/remix-demo-$2.mp3" \
    -stream_loop -1 -ss "$4" -i "$SRC/remix-demo-$3.mp3" \
    -filter_complex "[0:a][1:a]amix=inputs=2:weights='1 $5':normalize=0,$NORM[m]" \
    -map "[m]" -t $DUR -ac 2 -c:a pcm_s24le "$OUT/clean/mashup-$1.wav"
}
mash orig-x-slowed original slowed-reverb 3.1 0.8
mash vocal-x-bass vocal-echo ai-bass 1.7 1.0
mash edit-x-slowed short-edit slowed-reverb 5.3 0.7

# Hard cases for audibility: sparse/quiet material.
"${FF[@]}" -f lavfi -i "sine=f=220:d=$DUR,volume=0.5" -f lavfi -i "sine=f=330:d=$DUR,volume=0.3" \
  -f lavfi -i "anoisesrc=d=$DUR:c=pink:a=0.01" \
  -filter_complex "[0][1][2]amix=inputs=3:normalize=0,tremolo=f=0.5:d=0.9,$NORM[m]" \
  -map "[m]" -ac 2 -c:a pcm_s24le "$OUT/clean/sparse-pad.wav"
"${FF[@]}" -f lavfi -i "sine=f=55:d=$DUR,volume=0.8" -f lavfi -i "anoisesrc=d=$DUR:c=white:a=0.3" \
  -filter_complex "[1]highpass=f=6000,volume=enable='lt(mod(t,0.5),0.04)':volume=1,volume=enable='gte(mod(t,0.5),0.04)':volume=0[h];[0]volume=enable='gte(mod(t,0.5),0.15)':volume=0.1[k];[k][h]amix=inputs=2:normalize=0,$NORM[m]" \
  -map "[m]" -ac 2 -c:a pcm_s24le "$OUT/clean/electro-loop.wav"

# "Other music" bed for the mix-under attack: a different render, never watermarked.
"${FF[@]}" -stream_loop -1 -ss 2 -i "$SRC/remix-demo-short-edit.mp3" -t $DUR \
  -af "aecho=0.8:0.7:60:0.4,asetrate=48000*1.12,aresample=48000,$NORM" -ac 2 -c:a pcm_s24le "$OUT/other/bed.wav"
ls -1 "$OUT/clean"
