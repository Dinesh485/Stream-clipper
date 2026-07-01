import json
import re
import google.generativeai as genai

SYSTEM_PROMPT = """You are a video clip editor assistant.
You will be given a word-level transcript of a YouTube stream as a JSON array where each element has:
- "start": word start time in seconds
- "end": word end time in seconds
- "word": the spoken word

Your job is to identify the most interesting, entertaining, or highlight-worthy moments
and suggest clip ideas.
Each clip idea may consist of one or more segments (non-contiguous parts that together
form a coherent clip when merged).

Use the precise word timestamps to set accurate segment start and end times —
align starts to the first word of a sentence and ends to the last word.

Return ONLY a valid JSON object with this exact structure:
{
  "ideas": [
    {
      "title": "Short descriptive title",
      "description": "1-2 sentence explanation of why this is clip-worthy",
      "segments": [
        { "start": 123.4, "end": 145.2 }
      ]
    }
  ]
}

Rules:
- Timestamps must be in seconds (float), aligned to word boundaries
- Each segment should be at least 5 seconds long
- Titles should be concise and engaging (under 60 chars)
- Prioritize: funny moments, hype/exciting moments, interesting discussions,
  surprising reveals, emotional moments
- Do not overlap segments within the same idea
- Return ONLY the JSON, no markdown, no explanation
"""


def get_clip_ideas(transcript: list, api_key: str, model_name: str = "gemini-2.5-flash") -> dict:
    """Send transcript to Gemini and get clip ideas JSON."""
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(model_name)

    prompt = f"{SYSTEM_PROMPT}\n\nTRANSCRIPT:\n{json.dumps(transcript, ensure_ascii=False)}"

    response = model.generate_content(prompt)
    raw = response.text.strip()

    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Gemini returned invalid JSON: {e}\nRaw response:\n{raw}")

    return data
