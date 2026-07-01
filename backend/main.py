import re
import json
import uuid
import asyncio
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, RedirectResponse
from pydantic import BaseModel

from db import (init_db, get_setting, set_setting, get_all_settings,
                insert_video, get_video, list_videos, delete_video, update_video,
                insert_export, get_export, list_exports, update_export, delete_export)
from downloader import get_video_info, download_video, download_thumbnail, cancel_download, DOWNLOADS_DIR
from transcriber import transcribe, read_transcript, transcribe_file, generate_srt
from gemini import get_clip_ideas
from exporter import export_clip, EXPORTS_DIR
from youtube_auth import (
    get_client_credentials, set_client_credentials,
    get_auth_url, exchange_code, get_valid_credentials, clear_token,
)
from youtube_api import list_live_broadcasts, upload_video, upload_captions
import cache as _cache

app = FastAPI(title="Stream Clipper API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Init DB on startup
@app.on_event("startup")
def startup():
    init_db()


# --- Models ---

class AddVideoRequest(BaseModel):
    url: str


class Segment(BaseModel):
    start: float
    end: float


class ExportRequest(BaseModel):
    video_id: str
    title: str
    description: str = None
    segments: List[Segment]


class CreateIdeaRequest(BaseModel):
    title: str
    description: str = ""


class UpdateIdeaRequest(BaseModel):
    title: str = None
    description: str = None
    segments: list = None


class SettingsRequest(BaseModel):
    gemini_api_key: str = None
    whisper_model: str = None
    gemini_model: str = None
    yt_client_id: str = None
    yt_client_secret: str = None


class YouTubeUploadRequest(BaseModel):
    export_id: str
    privacy_status: str = "private"


# --- Settings ---

@app.get("/api/settings")
async def get_settings():
    s = get_all_settings()
    # Never expose the full API key — mask it
    key = s.get("gemini_api_key", "")
    masked = (key[:4] + "..." + key[-4:]) if len(key) > 8 else ("*" * len(key) if key else "")
    client_id, client_secret = get_client_credentials()
    creds = get_valid_credentials()
    return {
        "gemini_api_key_set": bool(key),
        "gemini_api_key_masked": masked,
        "whisper_model": s.get("whisper_model", "medium"),
        "gemini_model": s.get("gemini_model", "gemini-2.5-flash"),
        "yt_client_id_set": bool(client_id),
        "yt_client_secret_set": bool(client_secret),
        "yt_authenticated": creds is not None,
    }


@app.put("/api/settings")
async def update_settings(req: SettingsRequest):
    if req.gemini_api_key is not None:
        set_setting("gemini_api_key", req.gemini_api_key)
    if req.whisper_model is not None:
        set_setting("whisper_model", req.whisper_model)
    if req.gemini_model is not None:
        set_setting("gemini_model", req.gemini_model)
    if req.yt_client_id is not None:
        set_client_credentials(req.yt_client_id, req.yt_client_secret or "")
    elif req.yt_client_secret is not None:
        cid, _ = get_client_credentials()
        set_client_credentials(cid, req.yt_client_secret)
    return await get_settings()


# --- YouTube OAuth ---

@app.get("/api/youtube/status")
async def youtube_status():
    """Return whether OAuth credentials are configured and valid."""
    client_id, client_secret = get_client_credentials()
    creds = get_valid_credentials()
    return {
        "client_configured": bool(client_id and client_secret),
        "authenticated": creds is not None,
    }


@app.get("/api/youtube/auth-url")
async def youtube_auth_url():
    """Return the Google OAuth authorization URL."""
    client_id, client_secret = get_client_credentials()
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=400,
            detail="YouTube OAuth client ID and secret are not configured. Add them in Settings first."
        )
    url = get_auth_url(client_id, client_secret)
    return {"url": url}


@app.get("/api/youtube/callback")
async def youtube_callback(code: str = Query(None), error: str = Query(None)):
    """OAuth2 redirect callback. Exchanges code for tokens then closes the popup."""
    if error:
        # Close popup and send error message to opener
        html = f"""<!doctype html><html><body>
        <script>
          window.opener && window.opener.postMessage({{type:'yt_auth',success:false,error:{json.dumps(error)}}}, '*');
          window.close();
        </script></body></html>"""
        from fastapi.responses import HTMLResponse
        return HTMLResponse(html)

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    client_id, client_secret = get_client_credentials()
    try:
        exchange_code(client_id, client_secret, code)
    except Exception as e:
        html = f"""<!doctype html><html><body>
        <script>
          window.opener && window.opener.postMessage({{type:'yt_auth',success:false,error:{json.dumps(str(e))}}}, '*');
          window.close();
        </script></body></html>"""
        from fastapi.responses import HTMLResponse
        return HTMLResponse(html)

    html = """<!doctype html><html><body>
    <script>
      window.opener && window.opener.postMessage({type:'yt_auth',success:true}, '*');
      window.close();
    </script></body></html>"""
    from fastapi.responses import HTMLResponse
    return HTMLResponse(html)


@app.post("/api/youtube/disconnect")
async def youtube_disconnect():
    """Clear stored OAuth tokens and channel video cache."""
    clear_token()
    _cache.delete_prefix("yt_channel_videos:")
    return {"ok": True}


@app.get("/api/youtube/channel-videos")
async def channel_videos(
    max_results: int = Query(default=50, ge=1, le=50),
    page_token: str = Query(default=None),
    bust: bool = Query(default=False),
):
    """List authenticated user's completed live broadcasts, with 5-minute cache."""
    creds = get_valid_credentials()
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated with YouTube. Connect your account in Settings.")

    cache_key = f"yt_channel_videos:{max_results}:{page_token or ''}"

    if not bust:
        cached = _cache.get(cache_key)
        if cached is not None:
            return {**cached, "cached": True}

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: list_live_broadcasts(creds, max_results=max_results, page_token=page_token)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"YouTube API error: {e}")

    _cache.set(cache_key, result)
    return {**result, "cached": False}


@app.get("/api/gemini/models")
async def list_gemini_models():
    """Fetch available Gemini models from the API, filtered to text-generation ones."""
    api_key = get_setting("gemini_api_key")
    if not api_key:
        raise HTTPException(status_code=400, detail="Gemini API key not configured.")

    import google.generativeai as genai
    genai.configure(api_key=api_key)

    loop = asyncio.get_event_loop()
    try:
        def _fetch():
            models = []
            for m in genai.list_models():
                # Only include models that support generateContent
                if "generateContent" not in m.supported_generation_methods:
                    continue
                # Only include gemini models, skip embedding/imagen/etc.
                if not m.name.startswith("models/gemini"):
                    continue
                models.append({
                    "id":          m.name.removeprefix("models/"),
                    "name":        m.display_name,
                    "description": getattr(m, "description", ""),
                })
            # Sort: newer versions first (2.5 before 2.0 before 1.5)
            models.sort(key=lambda x: x["id"], reverse=True)
            return models

        models = await loop.run_in_executor(None, _fetch)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch models: {e}")

    return {"models": models}
    """Upload a completed export to YouTube as a private video."""
    export = get_export(req.export_id)
    if not export:
        raise HTTPException(status_code=404, detail="Export not found")
    if export["status"] != "done":
        raise HTTPException(status_code=400, detail="Export is not ready yet")
    if not export.get("file_path") or not Path(export["file_path"]).exists():
        raise HTTPException(status_code=404, detail="Export file not found on disk")

    creds = get_valid_credentials()
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated with YouTube. Connect your account in Settings.")

    # Mark as uploading
    update_export(req.export_id, yt_upload_status="uploading", yt_video_id=None, yt_upload_error=None)

    asyncio.get_event_loop().run_in_executor(
        None,
        lambda: _run_yt_upload(req.export_id, export["file_path"], export["title"], export.get("description") or "", req.privacy_status)
    )

    return get_export(req.export_id)


# --- Static file helpers ---

@app.get("/thumbnails/{video_id}")
async def serve_thumbnail(video_id: str):
    thumb_path = DOWNLOADS_DIR / video_id / "thumbnail.jpg"
    if not thumb_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(str(thumb_path), media_type="image/jpeg")


@app.get("/video/{video_id}")
async def serve_video(video_id: str, request: Request):
    video_path = DOWNLOADS_DIR / video_id / "video.mp4"
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")
    return range_response(video_path, request, "video/mp4")


def range_response(path: Path, request: Request, media_type: str):
    """Serve a file with HTTP range request support for proper video seeking."""
    file_size = path.stat().st_size
    range_header = request.headers.get("range")

    if range_header:
        # Parse "bytes=start-end"
        range_val = range_header.strip().replace("bytes=", "")
        parts = range_val.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        end = min(end, file_size - 1)
        chunk_size = end - start + 1

        def iter_file():
            with open(path, "rb") as f:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_file(),
            status_code=206,
            media_type=media_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
            },
        )

    # No range header — serve full file but advertise range support
    def iter_full():
        with open(path, "rb") as f:
            while chunk := f.read(65536):
                yield chunk

    return StreamingResponse(
        iter_full(),
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
        },
    )


# --- Video CRUD ---

@app.post("/api/videos")
async def add_video(req: AddVideoRequest):
    """Fetch metadata and add video to library. Does NOT start any background task."""
    loop = asyncio.get_event_loop()
    try:
        info = await loop.run_in_executor(None, lambda: get_video_info(req.url))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch video info: {e}")

    video_id = info.get("id")
    title = info.get("title", "")
    duration = int(info.get("duration", 0) or 0)

    if not video_id:
        raise HTTPException(status_code=400, detail="Could not extract video ID")

    # Return existing record if already added
    existing = get_video(video_id)
    if existing:
        return existing

    video = insert_video(video_id, req.url, title, duration)

    # Auto-start the full pipeline
    update_video(video_id, download_status="running", download_progress=0)
    asyncio.get_event_loop().run_in_executor(None, lambda: _run_download(video_id, req.url))

    return get_video(video_id)


@app.get("/api/videos")
async def list_all_videos():
    return list_videos()


@app.get("/api/videos/{video_id}")
async def get_one_video(video_id: str):
    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return video


@app.delete("/api/videos/{video_id}")
async def remove_video(video_id: str):
    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    cancel_download(video_id)
    delete_video(video_id)  # Remove from DB immediately

    # Delete files in background — file may be locked briefly if video is streaming
    vid_dir = DOWNLOADS_DIR / video_id
    asyncio.get_event_loop().run_in_executor(None, lambda: _delete_dir(vid_dir))

    return {"ok": True}


def _delete_dir(path: Path, retries: int = 5, delay: float = 1.0):
    """Delete a directory, retrying if files are locked (Windows)."""
    import shutil, time
    for attempt in range(retries):
        try:
            if path.exists():
                shutil.rmtree(path)
            return
        except Exception:
            if attempt < retries - 1:
                time.sleep(delay)
            # Last attempt — give up silently


@app.get("/api/videos/{video_id}/status")
async def get_video_status(video_id: str):
    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return {
        "id": video["id"],
        "download_status": video["download_status"],
        "download_error": video["download_error"],
        "download_progress": video["download_progress"],
        "download_total": video["download_total"],
        "download_speed": video["download_speed"],
        "transcribe_status": video["transcribe_status"],
        "transcribe_error": video["transcribe_error"],
        "ideas_status": video["ideas_status"],
        "ideas_error": video["ideas_error"],
    }


# --- Background tasks ---

@app.post("/api/videos/{video_id}/download")
async def start_download(video_id: str):
    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if video["download_status"] == "running":
        raise HTTPException(status_code=400, detail="Download already running")

    update_video(video_id, download_status="running", download_progress=0,
                 download_error=None, download_total=None, download_speed=None,
                 transcribe_status="pending", ideas_status="pending")

    asyncio.get_event_loop().run_in_executor(None, lambda: _run_download(video_id, video["url"]))
    return get_video(video_id)


@app.post("/api/videos/{video_id}/transcribe")
async def start_transcribe(video_id: str):
    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if video["download_status"] != "done":
        raise HTTPException(status_code=400, detail="Download must be completed first")
    if video["transcribe_status"] == "running":
        raise HTTPException(status_code=400, detail="Transcription already running")

    update_video(video_id, transcribe_status="running", transcribe_error=None,
                 ideas_status="pending")

    asyncio.get_event_loop().run_in_executor(None, lambda: _run_transcribe(video_id))
    return get_video(video_id)


@app.post("/api/videos/{video_id}/generate-ideas")
async def start_generate_ideas(video_id: str):
    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if video["transcribe_status"] != "done":
        raise HTTPException(status_code=400, detail="Transcription must be completed first")
    if video["ideas_status"] == "running":
        raise HTTPException(status_code=400, detail="Ideas generation already running")

    update_video(video_id, ideas_status="running", ideas_error=None)

    asyncio.get_event_loop().run_in_executor(None, lambda: _run_generate_ideas(video_id))
    return get_video(video_id)


# --- Idea management ---

@app.post("/api/videos/{video_id}/ideas")
async def create_idea(video_id: str, req: CreateIdeaRequest):
    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    existing_ideas = video.get("ideas") or []
    if not isinstance(existing_ideas, list):
        existing_ideas = []
    new_idea = {"title": req.title, "description": req.description, "segments": [], "source": "user"}
    updated_ideas = existing_ideas + [new_idea]
    update_video(video_id, ideas=json.dumps(updated_ideas))
    return updated_ideas


@app.put("/api/videos/{video_id}/ideas/{idea_idx}")
async def update_idea(video_id: str, idea_idx: int, req: UpdateIdeaRequest):
    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    existing_ideas = video.get("ideas") or []
    if not isinstance(existing_ideas, list):
        existing_ideas = []
    if idea_idx < 0 or idea_idx >= len(existing_ideas):
        raise HTTPException(status_code=404, detail="Idea not found")
    idea = dict(existing_ideas[idea_idx])
    if req.title is not None:
        idea["title"] = req.title
    if req.description is not None:
        idea["description"] = req.description
    if req.segments is not None:
        idea["segments"] = req.segments
    existing_ideas[idea_idx] = idea
    update_video(video_id, ideas=json.dumps(existing_ideas))
    return existing_ideas


@app.delete("/api/videos/{video_id}/ideas/{idea_idx}")
async def delete_idea(video_id: str, idea_idx: int):
    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    existing_ideas = video.get("ideas") or []
    if not isinstance(existing_ideas, list):
        existing_ideas = []
    if idea_idx < 0 or idea_idx >= len(existing_ideas):
        raise HTTPException(status_code=404, detail="Idea not found")
    updated_ideas = [idea for i, idea in enumerate(existing_ideas) if i != idea_idx]
    update_video(video_id, ideas=json.dumps(updated_ideas))
    return updated_ideas


# --- Export ---

@app.post("/api/export")
async def export_video(req: ExportRequest):
    video = get_video(req.video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    export_id = str(uuid.uuid4())
    safe_title = re.sub(r"[^\w\- ]", "", req.title).strip().replace(" ", "_")[:50]
    output_filename = f"{export_id}_{safe_title}.mp4"

    insert_export(export_id, req.video_id, req.title, req.description)

    # Run export in background
    asyncio.get_event_loop().run_in_executor(
        None,
        lambda: _run_export(export_id, req.video_id, [s.dict() for s in req.segments], output_filename)
    )

    return get_export(export_id)


@app.get("/api/exports")
async def get_exports():
    return list_exports()


@app.get("/api/exports/{export_id}/download")
async def download_export(export_id: str):
    export = get_export(export_id)
    if not export:
        raise HTTPException(status_code=404, detail="Export not found")
    if export["status"] != "done":
        raise HTTPException(status_code=400, detail="Export not ready")
    path = Path(export["file_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Export file missing")
    safe_title = re.sub(r"[^\w\- ]", "", export["title"] or "clip").strip().replace(" ", "_")[:50]
    return FileResponse(str(path), media_type="video/mp4", filename=f"{safe_title}.mp4")


@app.delete("/api/exports/{export_id}")
async def remove_export(export_id: str):
    export = get_export(export_id)
    if not export:
        raise HTTPException(status_code=404, detail="Export not found")
    if export.get("file_path"):
        Path(export["file_path"]).unlink(missing_ok=True)
    delete_export(export_id)
    return {"ok": True}


def _run_export(export_id: str, video_id: str, segments: list, output_filename: str):
    try:
        update_export(export_id, status="running")
        output_path = export_clip(video_id, segments, output_filename)
        update_export(export_id, status="done", file_path=output_path)
        # Auto-chain: upload to YouTube if authenticated
        creds = get_valid_credentials()
        if creds:
            export = get_export(export_id)
            update_export(export_id, yt_upload_status="uploading", yt_video_id=None, yt_upload_error=None)
            _run_yt_upload(
                export_id,
                output_path,
                export.get("title") or "Clip",
                export.get("description") or "",
                "private",
            )
    except Exception as e:
        update_export(export_id, status="error", error=str(e))


# --- Waveform ---

@app.get("/api/transcript/{video_id}")
async def get_transcript(video_id: str):
    """Return word-level transcript as JSON array of {start, end, word}."""
    words = read_transcript(video_id)
    if not words:
        raise HTTPException(status_code=404, detail="Transcript not found")
    return words
async def get_waveform(video_id: str):
    audio_path = DOWNLOADS_DIR / video_id / "audio.wav"
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(str(audio_path), media_type="audio/wav")


# --- Sync worker functions (run in executor) ---

def _run_download(video_id: str, url: str):
    try:
        # Download thumbnail first
        try:
            thumb_path = download_thumbnail(video_id, url)
            if thumb_path:
                update_video(video_id, thumbnail_path=thumb_path)
        except Exception:
            pass  # Thumbnail failure is non-fatal

        def on_progress(pct: float, total: str, speed: str):
            update_video(
                video_id,
                download_progress=pct,
                download_total=total,
                download_speed=speed,
            )

        download_video(video_id, url, on_progress)
        update_video(
            video_id,
            download_status="done",
            download_progress=100,
            download_speed=None,
        )
        # Auto-chain: start transcription
        update_video(video_id, transcribe_status="running", transcribe_error=None)
        _run_transcribe(video_id)
    except Exception as e:
        update_video(video_id, download_status="error", download_error=str(e))


def _run_transcribe(video_id: str):
    try:
        whisper_model = get_setting("whisper_model") or "medium"
        transcribe(video_id, whisper_model)
        update_video(video_id, transcribe_status="done")
        # Auto-chain: generate ideas
        api_key = get_setting("gemini_api_key")
        if api_key:
            update_video(video_id, ideas_status="running", ideas_error=None)
            _run_generate_ideas(video_id)
    except Exception as e:
        update_video(video_id, transcribe_status="error", transcribe_error=str(e))


def _run_generate_ideas(video_id: str):
    try:
        api_key = get_setting("gemini_api_key")
        if not api_key:
            raise ValueError("Gemini API key not configured. Go to Settings to add it.")

        gemini_model = get_setting("gemini_model") or "gemini-2.5-flash"
        segments = read_transcript(video_id)
        if not segments:
            raise FileNotFoundError("transcript.json not found or empty")

        ideas_data = get_clip_ideas(segments, api_key, gemini_model)
        new_ai_ideas = ideas_data.get("ideas", [])
        for idea in new_ai_ideas:
            idea["source"] = "ai"

        # Keep user ideas, replace AI ideas
        video = get_video(video_id)
        existing_ideas = video.get("ideas") or []
        if not isinstance(existing_ideas, list):
            existing_ideas = []
        user_ideas = [i for i in existing_ideas if i.get("source") != "ai"]
        merged_ideas = user_ideas + new_ai_ideas

        update_video(video_id, ideas_status="done", ideas=json.dumps(merged_ideas))
    except Exception as e:
        update_video(video_id, ideas_status="error", ideas_error=str(e))


def _run_yt_upload(export_id: str, file_path: str, title: str, description: str, privacy_status: str):
    try:
        from youtube_auth import get_valid_credentials
        creds = get_valid_credentials()
        if not creds:
            raise RuntimeError("YouTube credentials are no longer valid. Please reconnect in Settings.")

        # Step 1: transcribe the exported clip
        update_export(export_id, yt_caption_status="transcribing")
        whisper_model = get_setting("whisper_model") or "medium"

        # Extract audio from the export file first
        import subprocess, tempfile
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_audio = tmp.name

        ffmpeg = str(Path(__file__).parent / "ffmpeg.exe")
        result = subprocess.run(
            [ffmpeg, "-y", "-i", file_path, "-vn",
             "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", tmp_audio],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Audio extraction failed: {result.stderr}")

        try:
            segments = transcribe_file(tmp_audio, whisper_model)
            srt_content = generate_srt(segments)
        finally:
            import os as _os
            _os.unlink(tmp_audio)

        # Step 2: upload video
        update_export(export_id, yt_upload_status="uploading", yt_caption_status="pending",
                      yt_video_id=None, yt_upload_error=None)

        def on_progress(uploaded: int, total: int):
            pct = round((uploaded / total) * 100, 1) if total else 0
            update_export(export_id, yt_upload_progress=pct)

        upload_result = upload_video(creds, file_path, title, description, privacy_status, on_progress)
        yt_video_id = upload_result.get("id", "")
        yt_url = f"https://www.youtube.com/watch?v={yt_video_id}" if yt_video_id else ""
        update_export(export_id, yt_upload_status="done", yt_video_id=yt_video_id,
                      yt_video_url=yt_url, yt_upload_progress=100)

        # Step 3: upload captions
        if yt_video_id and srt_content:
            update_export(export_id, yt_caption_status="uploading")
            try:
                upload_captions(creds, yt_video_id, srt_content)
                update_export(export_id, yt_caption_status="done")
            except Exception as cap_err:
                # Caption failure is non-fatal — video is already uploaded
                update_export(export_id, yt_caption_status="error",
                              yt_caption_error=str(cap_err))

    except Exception as e:
        update_export(export_id, yt_upload_status="error", yt_upload_error=str(e),
                      yt_caption_status="idle")
