"""Utilities for exporting analytics events to the metrics system."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, List, Optional


@dataclass(frozen=True)
class MetricsEvent:
    """Container describing a single analytics event."""

    name: str
    payload: Dict[str, object]


class MetricsExporter:
    """Collects analytics events and optionally forwards them to a sink."""

    def __init__(
        self,
        emitter: Optional[Callable[[MetricsEvent], None]] = None,
    ) -> None:
        self._events: List[MetricsEvent] = []
        self._emitter = emitter

    def record(self, name: str, payload: Optional[Dict[str, object]] = None) -> None:
        """Store an event and emit it if a sink is configured."""

        event = MetricsEvent(name=name, payload=dict(payload or {}))
        self._events.append(event)
        if self._emitter is not None:
            self._emitter(event)

    @property
    def events(self) -> List[MetricsEvent]:
        """Return a snapshot of the collected events."""

        return list(self._events)

    def export_counts(self) -> Dict[str, int]:
        """Aggregate counts per metric for quick assertions and summaries."""

        counts: Dict[str, int] = {}
        for event in self._events:
            tutorial = event.payload.get("tutorial")
            key = f"{event.name}:{tutorial}" if tutorial else event.name
            counts[key] = counts.get(key, 0) + 1
        return counts

    def clear(self) -> None:
        """Reset the internal event buffer."""

        self._events.clear()


__all__ = ["MetricsEvent", "MetricsExporter"]
