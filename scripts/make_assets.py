"""Cut the test fixtures and bundled hen clips from the original xeno-canto recordings.

Usage:  python scripts/make_assets.py <source_dir> <repo_root>

One-time setup (numpy and soundfile are not part of the app; install them into a
throwaway folder with a SHORT path, because long paths break the DLL load on Windows):

    python -m pip install -q --target C:/Users/Jimmy/AppData/Local/Temp/dct/lib numpy soundfile
    PYTHONPATH=C:/Users/Jimmy/AppData/Local/Temp/dct/lib \
        python scripts/make_assets.py downloads/hens .
    rm -rf C:/Users/Jimmy/AppData/Local/Temp/dct

<source_dir> holds the original files (XC964309.wav, XC11494.mp3, ...). They are
treated as untrusted data: this script only reads them, as audio, via libsndfile.

Outputs under <repo_root>:
  tests/fixtures/*.wav   16-bit mono WAV at the source sample rate, original level.
  public/clips/*.mp3     128 kbps mono MP3, normalized to -1 dBFS peak.

Recordings with a no-derivatives (ND) license are deliberately absent (see CREDITS.md).
"""

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

# (output name, source file, start s, end s)
FIXTURES = [
    ("hail_a.wav", "XC964309.wav", 99.3, 102.1),
    ("chuckle_a.wav", "XC964309.wav", 23.5, 29.5),
    ("quacks_4.wav", "XC11494.mp3", 5.1, 6.7),
    ("steady_quacks.wav", "XC692779.mp3", 2.4, 12.0),
    ("hail_b.wav", "XC840246.mp3", 2.9, 4.6),
]

CLIPS = [
    ("hail.mp3", "XC964309.wav", 99.3, 102.1),
    ("quack.mp3", "XC692779.mp3", 2.4, 4.0),
    ("chuckle.mp3", "XC964309.wav", 23.5, 29.5),
]

CLIP_PEAK_DBFS = -1.0
MP3_BITRATE_KBPS = 128
# libsndfile maps this onto a CBR bitrate: 0.65 gives 128 kbps (0.6 gives 160, 0.7 gives 112).
MP3_COMPRESSION_LEVEL = 0.65


def read_mono_window(path: Path, start_s: float, end_s: float):
    """Return (mono float64 samples in [-1, 1], sample rate) for the window."""
    with sf.SoundFile(path) as src:
        rate = src.samplerate
        first = round(start_s * rate)
        last = round(end_s * rate)
        if last > src.frames:
            raise ValueError(f"{path.name}: window {start_s}-{end_s} s is past the end")
        src.seek(first)
        block = src.read(last - first, dtype="float64", always_2d=True)
    return block.mean(axis=1), rate


def normalize_peak(samples: np.ndarray, target_dbfs: float) -> np.ndarray:
    peak = float(np.max(np.abs(samples)))
    if peak == 0.0:
        raise ValueError("clip is silent")
    return samples * (10.0 ** (target_dbfs / 20.0) / peak)


def write_fixture(out_path: Path, samples: np.ndarray, rate: int) -> None:
    sf.write(out_path, np.clip(samples, -1.0, 1.0), rate, subtype="PCM_16", format="WAV")


def write_clip(out_path: Path, samples: np.ndarray, rate: int) -> None:
    # In CBR mode libsndfile maps compression_level (0 = best quality) onto a bitrate.
    sf.write(
        out_path,
        normalize_peak(samples, CLIP_PEAK_DBFS),
        rate,
        format="MP3",
        bitrate_mode="CONSTANT",
        compression_level=MP3_COMPRESSION_LEVEL,
    )


def main(source_dir: Path, repo_root: Path) -> None:
    fixtures_dir = repo_root / "tests" / "fixtures"
    clips_dir = repo_root / "public" / "clips"
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)

    for name, source, start_s, end_s in FIXTURES:
        samples, rate = read_mono_window(source_dir / source, start_s, end_s)
        write_fixture(fixtures_dir / name, samples, rate)
        print(f"fixture {name}: {len(samples) / rate:.2f} s at {rate} Hz")

    for name, source, start_s, end_s in CLIPS:
        samples, rate = read_mono_window(source_dir / source, start_s, end_s)
        out_path = clips_dir / name
        write_clip(out_path, samples, rate)
        kbps = out_path.stat().st_size * 8 / (len(samples) / rate) / 1000
        print(f"clip {name}: {len(samples) / rate:.2f} s, ~{kbps:.0f} kbps")
        if not MP3_BITRATE_KBPS * 0.9 <= kbps <= MP3_BITRATE_KBPS * 1.15:
            raise ValueError(f"{name}: expected about {MP3_BITRATE_KBPS} kbps, got {kbps:.0f}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
