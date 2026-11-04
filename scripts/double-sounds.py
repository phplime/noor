"""Notification sounds ring twice (so a prayer alert isn't missed).

Reads public/sounds/*.wav (single, used in the app) and writes
src-tauri/sounds/*.wav = sound + short pause + sound. iOS allows up to 30 s.
"""
import glob
import os
import wave

root = os.path.join(os.path.dirname(__file__), '..')
out_dir = os.path.join(root, 'src-tauri', 'sounds')
os.makedirs(out_dir, exist_ok=True)
for src in sorted(glob.glob(os.path.join(root, 'public', 'sounds', '*.wav'))):
    with wave.open(src) as w:
        params = w.getparams()
        frames = w.readframes(w.getnframes())
    secs = params.nframes / params.framerate
    gap = 0.25 if secs < 0.6 else 0.7
    silence = b'\x00' * int(params.framerate * gap) * params.sampwidth * params.nchannels
    data = frames + silence + frames
    total = len(data) / (params.framerate * params.sampwidth * params.nchannels)
    assert total < 29, src
    dst = os.path.join(out_dir, os.path.basename(src))
    with wave.open(dst, 'wb') as o:
        o.setnchannels(params.nchannels)
        o.setsampwidth(params.sampwidth)
        o.setframerate(params.framerate)
        o.writeframes(data)
    print(f'{os.path.basename(src)}: {secs:.1f}s → {total:.1f}s')
