"""Analytics helpers tailored to tutorial engagement."""

from __future__ import annotations

from typing import Optional

from .metrics import MetricsExporter


class TutorialAnalytics:
    """Wraps metric exports for tutorial-specific events."""

    def __init__(self, exporter: Optional[MetricsExporter] = None) -> None:
        self._exporter = exporter or MetricsExporter()

    @property
    def exporter(self) -> MetricsExporter:
        return self._exporter

    def track_tutorial_start(self, tutorial_id: str) -> None:
        self._exporter.record("tutorial_started", {"tutorial": tutorial_id})

    def track_step_engaged(self, tutorial_id: str, step_id: str) -> None:
        self._exporter.record(
            "tutorial_step_engaged",
            {"tutorial": tutorial_id, "step": step_id},
        )

    def track_step_completed(self, tutorial_id: str, step_id: str) -> None:
        self._exporter.record(
            "tutorial_step_completed",
            {"tutorial": tutorial_id, "step": step_id},
        )

    def track_tutorial_completed(self, tutorial_id: str, steps_completed: int) -> None:
        self._exporter.record(
            "tutorial_completed",
            {"tutorial": tutorial_id, "steps": steps_completed},
        )

    def track_hint_visibility(self, tutorial_id: str, enabled: bool) -> None:
        self._exporter.record(
            "tutorial_hints_toggled",
            {"tutorial": tutorial_id, "enabled": bool(enabled)},
        )


__all__ = ["TutorialAnalytics"]
