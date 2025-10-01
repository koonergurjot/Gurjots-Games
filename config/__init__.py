from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

_SETTINGS_PATH = Path(__file__).with_name("settings.json")


@lru_cache(maxsize=1)
def get_settings() -> Dict[str, Any]:
    """Return the parsed settings.json contents.

    The configuration is cached for subsequent lookups to avoid
    redundant file I/O, while still allowing tests to reset the cache by
    clearing ``get_settings.cache_clear()``.
    """
    with _SETTINGS_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


__all__ = ["get_settings"]
