import os
from faster_whisper import WhisperModel
import json
from pathlib import Path

DOWNLOADS_DIR = Path(__file__).parent / "downloads"

_CPU_CORES = os.cpu_count() or 4


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

    # Skip if already transcribed
    if json_path.exists():
        return str(json_path)

    model = WhisperModel(
        model_name,
        device="cpu",
        compute_type="int8",
        cpu_threads=_CPU_CORES,
        num_workers=2,
    )

    segments_iter, _ = model.transcribe(
        str(audio_path),
        beam_size=5,
        word_timestamps=True,
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


def read_transcript(video_id: str) -> list:
    """Read transcript JSON and return list of word entries."""
    json_path = DOWNLOADS_DIR / video_id / "transcript.json"
    if not json_path.exists():
        return []
    return json.loads(json_path.read_text(encoding="utf-8"))
