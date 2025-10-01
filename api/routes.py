from __future__ import annotations

import json
import time
from http import HTTPStatus
from typing import Callable, Dict, Iterable, Tuple
from urllib.parse import parse_qs

from config import get_settings
from server.leaderboard import get_top_scores, submit_score

StartResponse = Callable[[str, list[Tuple[str, str]]], None]


class RateLimiter:
    def __init__(self, *, window_seconds: int, max_requests: int) -> None:
        self.window = max(window_seconds, 1)
        self.max_requests = max(max_requests, 1)
        self._hits: Dict[str, list[float]] = {}

    def check(self, key: str) -> bool:
        now = time.time()
        history = [stamp for stamp in self._hits.get(key, []) if now - stamp < self.window]
        if len(history) >= self.max_requests:
            self._hits[key] = history
            return False
        history.append(now)
        self._hits[key] = history
        return True


def _json_response(status: HTTPStatus, payload: Dict[str, object]) -> Tuple[str, list[Tuple[str, str]], bytes]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = [
        ("Content-Type", "application/json"),
        ("Content-Length", str(len(body))),
    ]
    return f"{status.value} {status.phrase}", headers, body


_settings = get_settings().get("leaderboard", {})
_rate_limiter = RateLimiter(
    window_seconds=int(_settings.get("rateLimit", {}).get("windowSeconds", 60)),
    max_requests=int(_settings.get("rateLimit", {}).get("maxRequests", 30)),
)


def reset_rate_limiter() -> None:
    """Reset rate limiter state (primarily for tests)."""
    _rate_limiter._hits.clear()


def application(environ: Dict[str, object], start_response: StartResponse) -> Iterable[bytes]:
    method = environ.get("REQUEST_METHOD", "GET").upper()
    path = environ.get("PATH_INFO", "")
    client_ip = environ.get("REMOTE_ADDR", "anonymous")

    if path != "/api/leaderboard":
        status, headers, body = _json_response(
            HTTPStatus.NOT_FOUND,
            {"error": "Not Found"},
        )
        start_response(status, headers)
        return [body]

    if not _rate_limiter.check(f"{client_ip}:{method}"):
        status, headers, body = _json_response(
            HTTPStatus.TOO_MANY_REQUESTS,
            {"error": "Rate limit exceeded"},
        )
        start_response(status, headers)
        return [body]

    try:
        if method == "GET":
            status, headers, body = _handle_get(environ)
        elif method == "POST":
            status, headers, body = _handle_post(environ)
        else:
            status, headers, body = _json_response(
                HTTPStatus.METHOD_NOT_ALLOWED,
                {"error": "Method not allowed"},
            )
    except ValueError as exc:
        status, headers, body = _json_response(
            HTTPStatus.BAD_REQUEST,
            {"error": str(exc)},
        )
    except Exception as exc:  # pragma: no cover - defensive
        status, headers, body = _json_response(
            HTTPStatus.INTERNAL_SERVER_ERROR,
            {"error": str(exc)},
        )

    start_response(status, headers)
    return [body]


def _handle_get(environ: Dict[str, object]) -> Tuple[str, list[Tuple[str, str]], bytes]:
    query = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=False)
    game_id_list = query.get("game")
    if not game_id_list or not game_id_list[0].strip():
        raise ValueError("game query parameter is required")

    limit_list = query.get("limit")
    limit = int(limit_list[0]) if limit_list else 10
    scores = get_top_scores(game_id_list[0], limit=limit)
    return _json_response(HTTPStatus.OK, {"scores": scores})


def _read_body(environ: Dict[str, object]) -> bytes:
    length = int(environ.get("CONTENT_LENGTH") or 0)
    body = environ.get("wsgi.input")
    if length <= 0 or body is None:
        return b""
    return body.read(length)


def _handle_post(environ: Dict[str, object]) -> Tuple[str, list[Tuple[str, str]], bytes]:
    raw_body = _read_body(environ)
    if not raw_body:
        raise ValueError("Request body is required")

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        raise ValueError("Request body must be valid JSON") from None

    game_id = payload.get("game")
    score = payload.get("score")
    handle = payload.get("handle")
    share = payload.get("share")

    if not isinstance(game_id, str) or not game_id.strip():
        raise ValueError("game must be a non-empty string")
    if not isinstance(score, (int, float)):
        raise ValueError("score must be numeric")
    if handle is not None and not isinstance(handle, str):
        raise ValueError("handle must be a string when provided")
    if share is not None and not isinstance(share, bool):
        raise ValueError("share must be a boolean when provided")

    entry = submit_score(game_id, score, handle=handle, shared=share)

    response: Dict[str, object] = {"submitted": entry}
    if entry.get("shared"):
        response["share"] = {"prompt": "Would you like to share your score?"}

    return _json_response(HTTPStatus.CREATED, response)


__all__ = ["application", "reset_rate_limiter"]
