"""
Simple in-memory TTL cache for expensive API calls.
Not thread-safe for writes, but safe enough for single-user local use
since all background tasks run in a thread pool with GIL protection on dict ops.
"""

import time
from typing import Any

# { key: { "value": Any, "expires_at": float } }
_store: dict[str, dict] = {}

DEFAULT_TTL = 300  # 5 minutes


def get(key: str) -> Any | None:
    """Return cached value if still valid, else None."""
    entry = _store.get(key)
    if not entry:
        return None
    if time.monotonic() > entry["expires_at"]:
        _store.pop(key, None)
        return None
    return entry["value"]


def set(key: str, value: Any, ttl: int = DEFAULT_TTL):
    """Store a value with a TTL in seconds."""
    _store[key] = {
        "value":      value,
        "expires_at": time.monotonic() + ttl,
    }


def delete(key: str):
    """Explicitly invalidate a cache entry."""
    _store.pop(key, None)


def delete_prefix(prefix: str):
    """Invalidate all keys starting with a prefix."""
    keys = [k for k in _store if k.startswith(prefix)]
    for k in keys:
        _store.pop(k, None)
