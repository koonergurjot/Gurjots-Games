from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, List, Optional

from config import get_settings

@dataclass
class LeaderboardEntry:
    score: int
    handle: Optional[str] = None
    shared: bool = False
    metadata: dict = field(default_factory=dict)


class GameOverScreen:
    """Simple façade that coordinates leaderboard display and sharing prompts."""

    def __init__(self, game_id: str, client) -> None:
        self.game_id = game_id
        self.client = client
        leaderboard_settings = get_settings().get("leaderboard", {})
        self.allow_share: bool = leaderboard_settings.get("enableSharing", True)
        self.allow_handle: bool = leaderboard_settings.get("collectUserHandle", True)
        self.top_scores: List[LeaderboardEntry] = []
        self.error: Optional[str] = None
        self.share_prompt: Optional[str] = None

    def _build_entry(self, raw: dict) -> LeaderboardEntry:
        return LeaderboardEntry(
            score=int(raw.get("score", 0)),
            handle=raw.get("handle"),
            shared=bool(raw.get("shared", False)),
            metadata=raw.get("metadata", {}),
        )

    def load(self, limit: int = 5) -> List[LeaderboardEntry]:
        try:
            raw_entries = self.client.get_top_scores(self.game_id, limit=limit)
            self.top_scores = [self._build_entry(entry) for entry in raw_entries]
            self.error = None
        except Exception as exc:  # pragma: no cover - defensive
            self.top_scores = []
            self.error = str(exc)
        return self.top_scores

    def refresh(self, limit: int = 5) -> List[LeaderboardEntry]:
        return self.load(limit)

    def submit(self, score: int, *, handle: Optional[str] = None, share: bool = False) -> None:
        final_handle = handle if self.allow_handle else None
        final_share = share if self.allow_share else False
        result = self.client.submit_score(
            self.game_id,
            score,
            handle=final_handle,
            share=final_share,
        )
        if result.get("shared"):
            self.share_prompt = "Share your score with friends!"
        else:
            self.share_prompt = None
        self.refresh()

    def dismiss_share_prompt(self) -> None:
        self.share_prompt = None

    def formatted_scores(self) -> Iterable[str]:
        for index, entry in enumerate(self.top_scores, start=1):
            handle = entry.handle or "Anonymous"
            yield f"{index}. {handle} — {entry.score}"


__all__ = ["GameOverScreen", "LeaderboardEntry"]
