"""Tutorial engine for coordinating scripted onboarding flows."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence

from analytics import TutorialAnalytics

SCRIPTS_PATH = Path(__file__).with_name("scripts")


@dataclass(frozen=True)
class HintBranch:
    """A conditional hint variant selected when the context matches."""

    when: Sequence[str]
    hints: List[str]


@dataclass(frozen=True)
class StepHints:
    """Collection of hints for a tutorial step."""

    default: List[str] = field(default_factory=list)
    branches: List[HintBranch] = field(default_factory=list)


@dataclass(frozen=True)
class TutorialStep:
    """Single step from a tutorial script."""

    id: str
    text: str
    objectives: List[str]
    complete_events: List[str]
    next_step: Optional[str]
    hints: StepHints = field(default_factory=StepHints)


@dataclass(frozen=True)
class TutorialScript:
    """Parsed representation of a tutorial script."""

    id: str
    title: str
    description: str
    steps: Dict[str, TutorialStep]
    order: List[str]
    completion: Dict[str, object] = field(default_factory=dict)


class ScriptLoader:
    """Abstract loader for tutorial scripts."""

    def load(self, script_id: str) -> Dict[str, object]:  # pragma: no cover - interface
        raise NotImplementedError


class FileSystemScriptLoader(ScriptLoader):
    """Loads tutorial definitions from ``tutorial/scripts``."""

    def __init__(self, base_path: Path = SCRIPTS_PATH) -> None:
        self._base_path = base_path

    def load(self, script_id: str) -> Dict[str, object]:
        path = self._base_path / f"{script_id}.json"
        if not path.exists():
            raise FileNotFoundError(f"Tutorial script '{script_id}' not found at {path}")
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)


class DefaultHintStrategy:
    """Deterministic hint selection using scripted branches."""

    def __call__(self, step: TutorialStep, context: Optional[Dict[str, object]] = None) -> List[str]:
        if not step.hints.default and not step.hints.branches:
            return []
        context = context or {}
        flags = set(context.get("flags", []))
        for branch in step.hints.branches:
            if set(branch.when).issubset(flags):
                return list(branch.hints)
        return list(step.hints.default)


class TutorialEngine:
    """Coordinates tutorial state progression and hint generation."""

    def __init__(
        self,
        script_loader: Optional[ScriptLoader] = None,
        *,
        hint_generator: Optional[
            Callable[[str, TutorialStep, Dict[str, object], List[str]], Optional[Iterable[str]]]
        ] = None,
        analytics: Optional[TutorialAnalytics] = None,
        fallback_hint_strategy: Optional[Callable[[TutorialStep, Optional[Dict[str, object]]], List[str]]] = None,
    ) -> None:
        self._loader = script_loader or FileSystemScriptLoader()
        self._hint_generator = hint_generator
        self._analytics = analytics or TutorialAnalytics()
        self._hint_strategy = fallback_hint_strategy or DefaultHintStrategy()
        self._script: Optional[TutorialScript] = None
        self._current_step_id: Optional[str] = None
        self._completed_steps: List[str] = []
        self._completed_lookup: set[str] = set()
        self._hints_enabled: bool = True

    @property
    def analytics(self) -> TutorialAnalytics:
        return self._analytics

    @property
    def script(self) -> Optional[TutorialScript]:
        return self._script

    @property
    def current_step(self) -> Optional[TutorialStep]:
        if not self._script or not self._current_step_id:
            return None
        return self._script.steps.get(self._current_step_id)

    @property
    def completed_steps(self) -> List[str]:
        return list(self._completed_steps)

    @property
    def hints_enabled(self) -> bool:
        return self._hints_enabled

    def set_hints_enabled(self, enabled: bool) -> None:
        self._hints_enabled = bool(enabled)

    def load(self, script_id: str) -> TutorialScript:
        raw = self._loader.load(script_id)
        script = self._parse_script(raw)
        self._script = script
        self._completed_steps = []
        self._completed_lookup = set()
        self._current_step_id = script.order[0] if script.order else None
        self._analytics.track_tutorial_start(script.id)
        if self._current_step_id:
            self._analytics.track_step_engaged(script.id, self._current_step_id)
        return script

    def _parse_script(self, raw: Dict[str, object]) -> TutorialScript:
        steps: Dict[str, TutorialStep] = {}
        order: List[str] = []
        for entry in raw.get("steps", []):
            step = self._parse_step(entry)
            steps[step.id] = step
            order.append(step.id)
        return TutorialScript(
            id=raw.get("id", ""),
            title=raw.get("title", ""),
            description=raw.get("description", ""),
            steps=steps,
            order=order,
            completion=raw.get("completion", {}),
        )

    def _parse_step(self, raw: Dict[str, object]) -> TutorialStep:
        hints_raw = raw.get("hints", {})
        branches = [
            HintBranch(
                when=list(branch.get("when", [])),
                hints=list(branch.get("hints", [])),
            )
            for branch in hints_raw.get("branches", [])
        ]
        hints = StepHints(
            default=list(hints_raw.get("default", [])),
            branches=branches,
        )
        return TutorialStep(
            id=raw.get("id", ""),
            text=raw.get("text", ""),
            objectives=list(raw.get("objectives", [])),
            complete_events=list(raw.get("completeEvents", [])),
            next_step=raw.get("next"),
            hints=hints,
        )

    def is_completed(self) -> bool:
        return bool(self._script) and self._current_step_id is None

    def record_event(self, event: str, context: Optional[Dict[str, object]] = None) -> bool:
        step = self.current_step
        if not self._script or not step or step.id in self._completed_lookup:
            return False
        if event not in step.complete_events:
            return False
        self._completed_lookup.add(step.id)
        self._completed_steps.append(step.id)
        self._analytics.track_step_completed(self._script.id, step.id)
        if step.next_step:
            self._current_step_id = step.next_step
            self._analytics.track_step_engaged(self._script.id, step.next_step)
        else:
            self._current_step_id = None
            self._analytics.track_tutorial_completed(self._script.id, len(self._completed_steps))
        return True

    def get_hints(self, context: Optional[Dict[str, object]] = None) -> List[str]:
        if not self._hints_enabled:
            return []
        step = self.current_step
        if not step:
            return []
        fallback = list(self._hint_strategy(step, context))
        if self._hint_generator is None:
            return fallback
        try:
            generated = self._hint_generator(
                self._script.id if self._script else "",
                step,
                context or {},
                list(fallback),
            )
        except Exception:
            return fallback
        if not generated:
            return fallback
        return list(generated)

    def snapshot(self) -> Dict[str, object]:
        step = self.current_step
        return {
            "tutorial": self._script.id if self._script else None,
            "step": step.id if step else None,
            "objectives": list(step.objectives) if step else [],
            "completed": list(self._completed_steps),
            "isCompleted": self.is_completed(),
            "hintsEnabled": self._hints_enabled,
        }


__all__ = [
    "TutorialEngine",
    "TutorialScript",
    "TutorialStep",
    "ScriptLoader",
    "FileSystemScriptLoader",
]
