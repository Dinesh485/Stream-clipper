# Stream Clipper

Generate highlight clip ideas from YouTube streams using Whisper + Gemini, then edit and export them.

## Requirements

- Python 3.10+
- Node.js 18+
- [ffmpeg](https://ffmpeg.org/download.html) installed and on your PATH

## Setup

### 1. Clone and configure env

```bash
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
```

> **Note on Whisper:** `openai-whisper` runs on CPU by default on Windows with AMD GPU.
> A 1-2 hour stream takes roughly 15-40 minutes depending on model size.
> Set `WHISPER_MODEL=base` in `.env` for faster (less accurate) results.

### 3. Frontend

```bash
cd frontend
npm install
```

## Running

Open two terminals:

**Terminal 1 — Backend:**
```bash
cd backend
uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173)

## Workflow

1. Paste a YouTube video/stream URL
2. Wait for download → transcription → Gemini analysis
3. Browse clip ideas suggested by Gemini
4. Click an idea to open the segment editor
5. Adjust segment start/end times via waveform drag handles or time inputs
6. Preview individual segments
7. Click **Export MP4** to download the merged clip

## Folder structure

```
clipper/
├── backend/
│   ├── downloads/     # Downloaded videos + audio + transcripts (auto-created)
│   ├── exports/       # Exported clips (auto-created)
│   └── ...
├── frontend/
└── .env
```

## Tips

- Downloaded videos and transcripts are cached — reprocessing the same URL is fast
- The `medium` Whisper model is a good balance of speed and accuracy
- Gemini suggests 5–15 ideas; you can edit any of them before export
