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
    Returns list of caption-ready segment dicts: [{ "start", "end", "text" }, ...]

    Uses word_timestamps=True and groups words into caption lines of ~10 words
    so each caption entry has tight, accurate timing rather than one big block.
    """
    model = WhisperModel(model_name, device="cpu", compute_type="int8")

    segments_iter, _ = model.transcribe(
        audio_path,
        language="en",
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,
    )

    # Collect all words across all segments
    words = []
    for seg in segments_iter:
        if seg.words:
            for w in seg.words:
                text = w.word.strip()
                if text:
                    words.append({
                        "start": round(w.start, 3),
                        "end":   round(w.end, 3),
                        "word":  text,
                    })

    if not words:
        return []

    # Group into caption lines:
    # Start a new line when we hit MAX_WORDS, a sentence-ending punctuation,
    # or a gap of more than 1.5s between words.
    MAX_WORDS   = 10
    GAP_THRESH  = 1.5  # seconds

    captions    = []
    line_words  = []
    line_start  = words[0]["start"]

    SENTENCE_END = {".", "!", "?", "...", "…"}

    for i, w in enumerate(words):
        # Check gap from previous word
        if line_words:
            gap = w["start"] - line_words[-1]["end"]
            if gap > GAP_THRESH:
                captions.append(_make_caption(line_words, line_start))
                line_words = []
                line_start = w["start"]

        line_words.append(w)

        # Check if we should flush
        ends_sentence = any(w["word"].endswith(p) for p in SENTENCE_END)
        at_max        = len(line_words) >= MAX_WORDS

        if ends_sentence or at_max:
            captions.append(_make_caption(line_words, line_start))
            line_words = []
            if i + 1 < len(words):
                line_start = words[i + 1]["start"]

    # Flush remaining words
    if line_words:
        captions.append(_make_caption(line_words, line_start))

    return captions


def _make_caption(words: list, start: float) -> dict:
    return {
        "start": start,
        "end":   words[-1]["end"],
        "text":  " ".join(w["word"] for w in words),
    }


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
