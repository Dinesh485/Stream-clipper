"""
YouTube Data API v3 helpers.
- list_live_broadcasts: fetch completed live broadcasts from the authenticated user's channel
- upload_video: upload an exported clip as a private video
"""

import os
from pathlib import Path
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google.oauth2.credentials import Credentials

YOUTUBE_API_SERVICE = "youtube"
YOUTUBE_API_VERSION = "v3"


def _yt_client(creds: Credentials):
    return build(YOUTUBE_API_SERVICE, YOUTUBE_API_VERSION, credentials=creds)


# ── Live Broadcasts ───────────────────────────────────────────────────────

def list_live_broadcasts(
    creds: Credentials,
    max_results: int = 50,
    page_token: str = None,
) -> dict:
    """
    Return a page of the authenticated user's completed live broadcasts.
    Fetches with mine=True and filters to lifeCycleStatus == 'complete'.
    """
    yt = _yt_client(creds)

    kwargs = dict(
        part="snippet,status,contentDetails",
        mine=True,
        broadcastType="event",
        maxResults=50,  # always fetch max to filter down client-side
    )
    if page_token:
        kwargs["pageToken"] = page_token

    resp      = yt.liveBroadcasts().list(**kwargs).execute()
    all_items = resp.get("items", [])
    next_page = resp.get("nextPageToken")

    # Keep only fully completed broadcasts
    items = [
        item for item in all_items
        if item.get("status", {}).get("lifeCycleStatus", "") == "complete"
    ][:max_results]

    if not items:
        return {"items": [], "nextPageToken": next_page}

    # Batch-fetch video details (duration, etc.)
    video_ids = [item["id"] for item in items]
    vid_resp = yt.videos().list(
        part="contentDetails",
        id=",".join(video_ids),
    ).execute()
    vid_map = {v["id"]: v for v in vid_resp.get("items", [])}

    result = []
    for item in items:
        snippet  = item.get("snippet", {})
        status   = item.get("status", {})
        video_id = item["id"]
        details  = vid_map.get(video_id, {}).get("contentDetails", {})

        thumbnails = snippet.get("thumbnails", {})
        thumb = (
            thumbnails.get("medium", {}).get("url")
            or thumbnails.get("default", {}).get("url")
            or ""
        )

        result.append({
            "id":             video_id,
            "videoId":        video_id,
            "title":          snippet.get("title", ""),
            "description":    snippet.get("description", ""),
            "thumbnail":      thumb,
            "actualStartTime": snippet.get("actualStartTime", ""),
            "actualEndTime":   snippet.get("actualEndTime", ""),
            "duration":       _parse_iso_duration(details.get("duration", "")),
            "privacyStatus":  status.get("privacyStatus", ""),
        })

    return {"items": result, "nextPageToken": next_page}


# ── Upload ────────────────────────────────────────────────────────────────

def upload_video(
    creds: Credentials,
    file_path: str,
    title: str,
    description: str = "",
    privacy_status: str = "private",
    progress_callback=None,
) -> dict:
    """
    Upload a local video file to YouTube.
    progress_callback(bytes_uploaded: int, total_bytes: int)
    Returns the created video resource dict.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Export file not found: {file_path}")

    yt = _yt_client(creds)

    body = {
        "snippet": {
            "title":       title[:100],   # YouTube title limit
            "description": description,
            "categoryId":  "22",          # "People & Blogs" — generic default
        },
        "status": {
            "privacyStatus":          privacy_status,
            "selfDeclaredMadeForKids": False,
        },
    }

    media = MediaFileUpload(
        file_path,
        mimetype="video/mp4",
        resumable=True,
        chunksize=5 * 1024 * 1024,  # 5 MB chunks
    )

    request = yt.videos().insert(
        part=",".join(body.keys()),
        body=body,
        media_body=media,
    )

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status and progress_callback:
            progress_callback(status.resumable_progress, status.total_size)

    return response


# ── ISO 8601 duration parser ──────────────────────────────────────────────

def _parse_iso_duration(duration: str) -> int:
    """Convert ISO 8601 duration string (PT1H2M3S) to total seconds."""
    if not duration:
        return 0
    import re
    pattern = re.compile(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")
    m = pattern.match(duration)
    if not m:
        return 0
    days, hours, minutes, seconds = (int(x or 0) for x in m.groups())
    return days * 86400 + hours * 3600 + minutes * 60 + seconds
