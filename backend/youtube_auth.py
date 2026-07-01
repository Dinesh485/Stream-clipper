"""
YouTube OAuth2 helpers.
Handles the OAuth flow and token persistence in the settings table.
"""

import json
from pathlib import Path
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from db import get_setting, set_setting

SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
]

# Where we tell Google to redirect after auth
REDIRECT_URI = "http://localhost:8000/api/youtube/callback"

# Settings keys
KEY_CLIENT_ID     = "yt_oauth_client_id"
KEY_CLIENT_SECRET = "yt_oauth_client_secret"
KEY_TOKEN         = "yt_oauth_token"


# ── Client credentials ────────────────────────────────────────────────────

def get_client_credentials() -> tuple[str, str]:
    """Return (client_id, client_secret) from settings, or ('', '')."""
    return (
        get_setting(KEY_CLIENT_ID)     or "",
        get_setting(KEY_CLIENT_SECRET) or "",
    )


def set_client_credentials(client_id: str, client_secret: str):
    set_setting(KEY_CLIENT_ID,     client_id)
    set_setting(KEY_CLIENT_SECRET, client_secret)


# ── Token storage ─────────────────────────────────────────────────────────

def save_token(creds: Credentials):
    token_data = {
        "token":         creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri":     creds.token_uri,
        "client_id":     creds.client_id,
        "client_secret": creds.client_secret,
        "scopes":        list(creds.scopes or []),
    }
    set_setting(KEY_TOKEN, json.dumps(token_data))


def load_token() -> Credentials | None:
    raw = get_setting(KEY_TOKEN)
    if not raw:
        return None
    try:
        d = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    return Credentials(
        token=d.get("token"),
        refresh_token=d.get("refresh_token"),
        token_uri=d.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=d.get("client_id"),
        client_secret=d.get("client_secret"),
        scopes=d.get("scopes"),
    )


def clear_token():
    set_setting(KEY_TOKEN, "")


# ── OAuth flow helpers ────────────────────────────────────────────────────

def _client_config(client_id: str, client_secret: str) -> dict:
    return {
        "web": {
            "client_id":                   client_id,
            "client_secret":               client_secret,
            "auth_uri":                    "https://accounts.google.com/o/oauth2/auth",
            "token_uri":                   "https://oauth2.googleapis.com/token",
            "redirect_uris":               [REDIRECT_URI],
        }
    }


def get_auth_url(client_id: str, client_secret: str) -> str:
    """Build and return the Google OAuth2 authorization URL."""
    flow = Flow.from_client_config(
        _client_config(client_id, client_secret),
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI,
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",  # force refresh_token to always be returned
    )
    return auth_url


def exchange_code(client_id: str, client_secret: str, code: str) -> Credentials:
    """Exchange authorization code for credentials and persist them."""
    flow = Flow.from_client_config(
        _client_config(client_id, client_secret),
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI,
    )
    flow.fetch_token(code=code)
    creds = flow.credentials
    save_token(creds)
    return creds


def get_valid_credentials() -> Credentials | None:
    """Return valid (refreshed if needed) credentials, or None."""
    creds = load_token()
    if not creds:
        return None
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            save_token(creds)
        except Exception:
            return None
    return creds if creds.valid else None
