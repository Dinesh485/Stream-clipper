from faster_whisper import WhisperModel
import json
from pathlib import Path

DOWNLOADS_DIR = Path(__file__).parent / "downloads"


def transcribe(video_id: str, model_name: str = "medium") -> str:
    """
    Run faster-whisper on downloads/{video_id}/audio.wav.
    Saves transcript as downloads/{video_id}/transcript.json.
    Format: [{ "start": 0.0, "end": 0.5, "word": "Hello" }, ...]
    Returns path to JSON file.
    """
    audio_path = DOWNLOADS_DIR / video_id / "audio.wav"
    json_path  = DOWNLOADS_DIR / video_id / "transcript.json"

    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    # Delete existing transcript so it gets regenerated
    if json_path.exists():
        json_path.unlink()

    model = WhisperModel(model_name, device="cpu", compute_type="int8")

    segments_iter, info = model.transcribe(
        str(audio_path),
        language="en",
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,
    )

    words = []
    for seg in segments_iter:
        if seg.words:
            for w in seg.words:
                words.append({
                    "start": round(w.start, 3),
                    "end":   round(w.end, 3),
                    "word":  w.word.strip(),
                })

    json_path.write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
    return str(json_path)


def transcribe_file(audio_path: str, model_name: str = "medium") -> list:
    """
    Run faster-whisper on an arbitrary audio file.
    Returns list of segment dicts: [{ "start", "end", "text" }, ...]
    (segment-level, not word-level — better for caption generation)
    """
    model = WhisperModel(model_name, device="cpu", compute_type="int8")

    segments_iter, _ = model.transcribe(
        audio_path,
        language="en",
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,
    )

    return [
        {
            "start": round(seg.start, 3),
            "end":   round(seg.end, 3),
            "text":  seg.text.strip(),
        }
        for seg in segments_iter
        if seg.text.strip()
    ]


def generate_srt(segments: list) -> str:
    """
    Convert a list of { start, end, text } segments into SRT format string.
    """
    lines = []
    for i, seg in enumerate(segments, 1):
        lines.append(str(i))
        lines.append(f"{_fmt_srt_time(seg['start'])} --> {_fmt_srt_time(seg['end'])}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


def _fmt_srt_time(seconds: float) -> str:
    """Format seconds as SRT timestamp: HH:MM:SS,mmm"""
    ms  = int(round(seconds * 1000))
    h   = ms // 3_600_000;  ms %= 3_600_000
    m   = ms // 60_000;     ms %= 60_000
    s   = ms // 1_000;      ms %= 1_000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def read_transcript(video_id: str) -> list:
    """Read transcript JSON and return list of word entries."""
    json_path = DOWNLOADS_DIR / video_id / "transcript.json"
    if not json_path.exists():
        return []
    return json.loads(json_path.read_text(encoding="utf-8"))
