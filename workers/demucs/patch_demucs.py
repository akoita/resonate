#!/usr/bin/env python3
"""
Patch demucs/audio.py for torchaudio 2.x compatibility.
Removes deprecated 'encoding' and 'bits_per_sample' params from ta.save() calls.
"""
import re
import demucs.audio

audio_file = demucs.audio.__file__
print(f"Patching {audio_file}...")

with open(audio_file, 'r') as f:
    content = f.read()

# Fix wav encoding line - remove encoding=encoding, bits_per_sample=bits_per_sample
content = re.sub(
    r'ta\.save\(str\(path\), wav, sample_rate=samplerate,\s*\n\s*encoding=encoding, bits_per_sample=bits_per_sample\)',
    'ta.save(str(path), wav, sample_rate=samplerate)',
    content
)

# Fix flac line - remove bits_per_sample=bits_per_sample
content = re.sub(
    r'ta\.save\(str\(path\), wav, sample_rate=samplerate, bits_per_sample=bits_per_sample\)',
    'ta.save(str(path), wav, sample_rate=samplerate)',
    content
)

with open(audio_file, 'w') as f:
    f.write(content)

print(f"Successfully patched {audio_file}")
