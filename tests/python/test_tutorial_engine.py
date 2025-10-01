from __future__ import annotations

import unittest

from analytics import MetricsExporter, TutorialAnalytics
from scenes.tutorial_scene import TutorialScene
from tutorial.engine import TutorialEngine


class TutorialEngineTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.metrics = MetricsExporter()
        self.analytics = TutorialAnalytics(exporter=self.metrics)
        self.engine = TutorialEngine(analytics=self.analytics)
        self.engine.load("getting_started")

    def test_progression_and_analytics(self) -> None:
        self.assertEqual(self.engine.current_step.id, "welcome")
        self.engine.record_event("ui:start_pressed")
        self.assertEqual(self.engine.current_step.id, "movement")
        self.engine.record_event("movement:checkpoint_reached")
        self.assertEqual(self.engine.current_step.id, "jump")
        self.engine.record_event("movement:jump_success")
        self.assertTrue(self.engine.is_completed())

        counts = self.metrics.export_counts()
        self.assertEqual(counts["tutorial_started:getting_started"], 1)
        self.assertEqual(counts["tutorial_step_completed:getting_started"], 3)
        self.assertEqual(counts["tutorial_completed:getting_started"], 1)

    def test_ml_hint_generator_used(self) -> None:
        captured = {}

        def fake_generator(tutorial_id, step, context, fallback):
            captured["tutorial"] = tutorial_id
            captured["step"] = step.id
            captured["fallback"] = list(fallback)
            return ["ml hint"]

        engine = TutorialEngine(hint_generator=fake_generator, analytics=self.analytics)
        engine.load("getting_started")
        hints = engine.get_hints({"flags": []})
        self.assertEqual(hints, ["ml hint"])
        self.assertEqual(captured["tutorial"], "getting_started")
        self.assertEqual(captured["step"], "welcome")
        self.assertTrue(captured["fallback"])  # default fallback provided

    def test_fallback_hint_when_ml_unavailable(self) -> None:
        def broken_generator(*args, **kwargs):  # noqa: ANN001
            raise RuntimeError("offline")

        engine = TutorialEngine(hint_generator=broken_generator, analytics=self.analytics)
        engine.load("getting_started")
        engine.record_event("ui:start_pressed")
        engine.record_event("movement:checkpoint_reached")
        hints = engine.get_hints({"flags": ["player_hit_barrier"]})
        self.assertIn("Jump a split-second earlier", hints[0])

    def test_scene_state_and_hint_toggle(self) -> None:
        scene = TutorialScene(self.engine)
        state = scene.state()
        self.assertTrue(state.hints)
        scene.set_hints_enabled(False)
        state_disabled = scene.state()
        self.assertFalse(state_disabled.hints)
        scene.toggle_hints()
        state_enabled = scene.state()
        self.assertTrue(state_enabled.hints_enabled)
        scene.on_player_event("ui:start_pressed")
        progressed = scene.state()
        self.assertEqual(progressed.step, "movement")
        counts = self.metrics.export_counts()
        self.assertEqual(counts["tutorial_hints_toggled:getting_started"], 2)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
