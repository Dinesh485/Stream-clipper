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

    # word_timestamps=True gives per-word start/end times
    # vad_filter removes silence — critical for long audio to prevent hallucinations
    # language="en" prevents wrong language detection mid-stream (change if needed)
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


def read_transcript(video_id: str) -> list:
    """Read transcript JSON and return list of word entries."""
    json_path = DOWNLOADS_DIR / video_id / "transcript.json"
    if not json_path.exists():
        return []
    return json.loads(json_path.read_text(encoding="utf-8"))
