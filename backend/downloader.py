import subprocess
import json
import re
from pathlib import Path

DOWNLOADS_DIR = Path(__file__).parent / "downloads"
DOWNLOADS_DIR.mkdir(exist_ok=True)

YTDLP = str(Path(__file__).parent / "yt-dlp.exe")
FFMPEG = str(Path(__file__).parent / "ffmpeg.exe")
FFMPEG_DIR = str(Path(__file__).parent)

# Active download processes keyed by video_id
_active_processes: dict[str, subprocess.Popen] = {}


def get_video_info(url: str) -> dict:
    """Fetch video metadata without downloading using yt-dlp --dump-json."""
    result = subprocess.run(
        [YTDLP, "--dump-json", "--no-playlist", url],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def cancel_download(video_id: str):
    """Kill the active download process for a video."""
    proc = _active_processes.pop(video_id, None)
    if proc and proc.poll() is None:
        proc.kill()


def download_thumbnail(video_id: str, url: str) -> str:
    """Download thumbnail using yt-dlp --write-thumbnail --skip-download.
    Returns path to thumbnail jpg."""
    out_dir = DOWNLOADS_DIR / video_id
    out_dir.mkdir(parents=True, exist_ok=True)
    thumb_path = out_dir / "thumbnail.jpg"

    if thumb_path.exists():
        return str(thumb_path)

    # yt-dlp writes thumbnail with video id as stem; we use --output to fix it
    cmd = [
        YTDLP,
        "--write-thumbnail",
        "--skip-download",
        "--convert-thumbnails", "jpg",
        "--no-playlist",
        "-o", str(out_dir / "thumbnail.%(ext)s"),
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    # yt-dlp may write thumbnail.jpg or thumbnail.webp converted to jpg
    # Find any thumbnail file
    for candidate in out_dir.glob("thumbnail.*"):
        if candidate.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            if candidate != thumb_path:
                candidate.rename(thumb_path)
            return str(thumb_path)

    if thumb_path.exists():
        return str(thumb_path)

    # Non-fatal: return empty string if thumbnail download failed
    return ""


def download_video(video_id: str, url: str, progress_callback=None) -> dict:
    """
    Download video to downloads/{video_id}/video.mp4
    Then extract audio to downloads/{video_id}/audio.wav using ffmpeg.
    progress_callback(pct: float, total: str, speed: str)
    Returns dict with video_path, audio_path.
    """
    out_dir = DOWNLOADS_DIR / video_id
    out_dir.mkdir(parents=True, exist_ok=True)

    video_path = out_dir / "video.mp4"
    audio_path = out_dir / "audio.wav"

    if not video_path.exists():
        cmd = [
            YTDLP,
            "--ffmpeg-location", FFMPEG_DIR,
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", str(video_path),
            "--no-playlist",
            "--newline",
            url,
        ]

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        _active_processes[video_id] = proc

        # Parse progress lines: [download]  23.4% of   1.20GiB at   5.00MiB/s ETA 00:45
        progress_re = re.compile(
            r"\[download\]\s+([\d.]+)%\s+of\s+([\S]+(?:\s+\S+)?)\s+at\s+([\d.]+\s*\S+/s)"
        )

        for line in proc.stdout:
            line = line.strip()
            m = progress_re.search(line)
            if m and progress_callback:
                pct = float(m.group(1))
                total = m.group(2).strip()
                speed = m.group(3).strip()
                progress_callback(pct, total, speed)

        proc.wait()
        _active_processes.pop(video_id, None)

        if proc.returncode not in (0, None) and proc.returncode != -9:
            raise RuntimeError(f"yt-dlp download failed (code {proc.returncode}).")
        if proc.returncode == -9:
            raise RuntimeError("Download cancelled.")

        if not video_path.exists():
            # Try to find any mp4 in the output dir
            candidates = list(out_dir.glob("*.mp4"))
            if candidates:
                candidates[0].rename(video_path)
            else:
                raise RuntimeError("Download completed but video.mp4 not found.")

    if not audio_path.exists():
        _extract_audio(video_path, audio_path)

    return {
        "video_path": str(video_path),
        "audio_path": str(audio_path),
    }


def _extract_audio(video_path: Path, audio_path: Path):
    """Extract WAV audio from video using ffmpeg."""
    cmd = [
        FFMPEG,
        "-y",
        "-i", str(video_path),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        str(audio_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg audio extraction failed:\n{result.stderr}")
