from __future__ import annotations

import json
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Iterator, List, Optional

try:  # pragma: no cover - platform specific imports
    import fcntl  # type: ignore
except ImportError:  # pragma: no cover - Windows fallback
    fcntl = None  # type: ignore

try:  # pragma: no cover - platform specific imports
    import msvcrt  # type: ignore
except ImportError:  # pragma: no cover - non-Windows
    msvcrt = None  # type: ignore

from config import get_settings

_DEFAULT_STORAGE_PATH = (
    Path(os.getenv("LEADERBOARD_STORAGE_PATH", ""))
    if os.getenv("LEADERBOARD_STORAGE_PATH")
    else Path(__file__).resolve().parent.parent / "data" / "leaderboard.json"
)

_LOCK = threading.RLock()
_STORAGE_PATH = _DEFAULT_STORAGE_PATH


def configure_storage(path: os.PathLike[str] | str) -> None:
    """Update the persistent storage location used for leaderboard data.

    This helper is primarily intended for tests, allowing them to work
    with an isolated temporary file without mutating the real data.
    """
    global _STORAGE_PATH
    with _LOCK:
        _STORAGE_PATH = Path(path)
        _STORAGE_PATH.parent.mkdir(parents=True, exist_ok=True)


def _lock_path() -> Path:
    return _STORAGE_PATH.with_suffix(".lock")


@contextmanager
def _storage_file_lock() -> Iterator[None]:
    lock_path = _lock_path()
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a+b")
    try:
        _ensure_lock_file_initialized(handle)
        _acquire_lock(handle)
        yield
    finally:
        _release_lock(handle)
        handle.close()


def _ensure_lock_file_initialized(handle) -> None:
    handle.seek(0, os.SEEK_END)
    if handle.tell() == 0:
        handle.write(b"\0")
        handle.flush()
        try:
            os.fsync(handle.fileno())
        except OSError:
            pass
    handle.seek(0)


def _acquire_lock(handle) -> None:
    if fcntl is not None:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        return
    if msvcrt is not None:  # pragma: no cover - Windows specific
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        return
    raise RuntimeError("No file locking mechanism available on this platform")


def _release_lock(handle) -> None:
    if fcntl is not None:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        return
    if msvcrt is not None:  # pragma: no cover - Windows specific
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        return
    raise RuntimeError("No file locking mechanism available on this platform")


def _load_unlocked() -> Dict[str, List[Dict[str, object]]]:
    if not _STORAGE_PATH.exists():
        return {}
    with _STORAGE_PATH.open("r", encoding="utf-8") as handle:
        try:
            data = json.load(handle)
        except json.JSONDecodeError:
            return {}
    if isinstance(data, dict):
        return data
    return {}


def _load() -> Dict[str, List[Dict[str, object]]]:
    with _storage_file_lock():
        return _load_unlocked()


def _persist(data: Dict[str, List[Dict[str, object]]]) -> None:
    with _storage_file_lock():
        _persist_unlocked(data)


def _persist_unlocked(data: Dict[str, List[Dict[str, object]]]) -> None:
    _STORAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = _STORAGE_PATH.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    tmp_path.replace(_STORAGE_PATH)


def get_top_scores(game_id: str, limit: int = 10) -> List[Dict[str, object]]:
    """Return the highest scores for ``game_id`` limited to ``limit`` entries."""
    if not isinstance(game_id, str) or not game_id.strip():
        raise ValueError("game_id must be a non-empty string")
    if not isinstance(limit, int) or limit <= 0:
        raise ValueError("limit must be a positive integer")

    with _LOCK:
        data = _load()
        entries = data.get(game_id, [])

    entries = sorted(entries, key=lambda item: item.get("score", 0), reverse=True)
    return entries[:limit]


def submit_score(
    game_id: str,
    score: int | float,
    *,
    handle: Optional[str] = None,
    shared: bool | None = None,
    metadata: Optional[Dict[str, object]] = None,
) -> Dict[str, object]:
    """Persist a score entry and return the stored representation."""
    if not isinstance(game_id, str) or not game_id.strip():
        raise ValueError("game_id must be a non-empty string")
    if not isinstance(score, (int, float)):
        raise ValueError("score must be numeric")

    settings = get_settings().get("leaderboard", {})
    allow_handles = settings.get("collectUserHandle", True)
    allow_sharing = settings.get("enableSharing", True)
    max_entries = settings.get("maxEntries", 10)

    entry: Dict[str, object] = {
        "score": int(score),
        "submittedAt": time.time(),
    }

    if metadata:
        entry["metadata"] = dict(metadata)

    if allow_handles and handle:
        if not isinstance(handle, str):
            raise ValueError("handle must be a string when enabled")
        entry["handle"] = handle.strip()[:32]

    if allow_sharing:
        entry["shared"] = bool(shared)
    else:
        entry["shared"] = False

    with _LOCK:
        with _storage_file_lock():
            data = _load_unlocked()
            entries = data.setdefault(game_id, [])
            entries.append(entry)
            entries.sort(key=lambda item: item.get("score", 0), reverse=True)
            if max_entries and isinstance(max_entries, int) and max_entries > 0:
                data[game_id] = entries[:max_entries]
            else:
                data[game_id] = entries
            _persist_unlocked(data)

    return entry


def clear_scores(game_id: Optional[str] = None) -> None:
    """Remove stored scores for ``game_id`` or all games when omitted."""
    with _LOCK:
        if game_id is None:
            with _storage_file_lock():
                if _STORAGE_PATH.exists():
                    _STORAGE_PATH.unlink(missing_ok=True)
            return

        with _storage_file_lock():
            data = _load_unlocked()
            if game_id in data:
                del data[game_id]
                _persist_unlocked(data)


__all__ = [
    "configure_storage",
    "get_top_scores",
    "submit_score",
    "clear_scores",
]
