"""Scene controller dedicated to tutorial flows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from analytics import TutorialAnalytics
from tutorial.engine import TutorialEngine, TutorialStep


@dataclass
class SceneState:
    """Serializable snapshot consumed by the UI layer."""

    tutorial: Optional[str]
    step: Optional[str]
    text: Optional[str]
    objectives: List[str]
    hints: List[str]
    completed: List[str]
    hints_enabled: bool
    is_completed: bool


class TutorialScene:
    """High-level façade that wires the tutorial engine to the UI."""

    def __init__(self, engine: Optional[TutorialEngine] = None) -> None:
        self.engine = engine or TutorialEngine()
        self.analytics: TutorialAnalytics = self.engine.analytics

    def start(self, tutorial_id: str) -> SceneState:
        self.engine.load(tutorial_id)
        return self.state()

    def state(self, context: Optional[Dict[str, object]] = None) -> SceneState:
        engine_state = self.engine.snapshot()
        step: Optional[TutorialStep] = self.engine.current_step
        hints = self.engine.get_hints(context)
        return SceneState(
            tutorial=engine_state["tutorial"],
            step=engine_state["step"],
            text=step.text if step else None,
            objectives=step.objectives if step else [],
            hints=hints,
            completed=engine_state["completed"],
            hints_enabled=engine_state["hintsEnabled"],
            is_completed=engine_state["isCompleted"],
        )

    def set_hints_enabled(self, enabled: bool) -> None:
        self.engine.set_hints_enabled(enabled)
        script = self.engine.script
        if script:
            self.analytics.track_hint_visibility(script.id, enabled)

    def on_player_event(self, event: str, context: Optional[Dict[str, object]] = None) -> SceneState:
        self.engine.record_event(event, context)
        return self.state(context)

    def toggle_hints(self) -> None:
        self.set_hints_enabled(not self.engine.hints_enabled)

    def is_completed(self) -> bool:
        return self.engine.is_completed()


__all__ = ["TutorialScene", "SceneState"]
