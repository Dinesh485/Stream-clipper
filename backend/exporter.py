import subprocess
import tempfile
import os
from pathlib import Path

DOWNLOADS_DIR = Path(__file__).parent / "downloads"
EXPORTS_DIR = Path(__file__).parent / "exports"
EXPORTS_DIR.mkdir(exist_ok=True)

FFMPEG = str(Path(__file__).parent / "ffmpeg.exe")


def export_clip(video_id: str, segments: list, output_filename: str) -> str:
    """
    Cut and merge segments from downloads/{video_id}/video.mp4 using ffmpeg.
    segments: list of {"start": float, "end": float}
    Returns path to exported file.
    """
    video_path = DOWNLOADS_DIR / video_id / "video.mp4"
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    output_path = EXPORTS_DIR / output_filename

    if len(segments) == 1:
        seg = segments[0]
        _cut_segment(video_path, seg["start"], seg["end"], output_path)
    else:
        with tempfile.TemporaryDirectory() as tmpdir:
            temp_files = []
            for i, seg in enumerate(segments):
                tmp_path = Path(tmpdir) / f"seg_{i:03d}.mp4"
                _cut_segment(video_path, seg["start"], seg["end"], tmp_path)
                temp_files.append(str(tmp_path))
            _concat_segments(temp_files, output_path)

    return str(output_path)


def _cut_segment(video_path: Path, start: float, end: float, output_path: Path):
    """Cut a single segment from video."""
    duration = end - start
    cmd = [
        FFMPEG,
        "-y",
        "-ss", str(start),
        "-i", str(video_path),
        "-t", str(duration),
        "-c:v", "libx264",
        "-c:a", "aac",
        "-avoid_negative_ts", "make_zero",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg cut failed:\n{result.stderr}")


def _concat_segments(segment_paths: list, output_path: Path):
    """Concatenate multiple video segments."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, encoding="utf-8"
    ) as f:
        for path in segment_paths:
            f.write(f"file '{path.replace(os.sep, '/')}'\n")
        concat_file = f.name

    try:
        cmd = [
            FFMPEG,
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_file,
            "-c", "copy",
            str(output_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg concat failed:\n{result.stderr}")
    finally:
        os.unlink(concat_file)
