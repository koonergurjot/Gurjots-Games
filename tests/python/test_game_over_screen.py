from __future__ import annotations

import unittest

from ui.game_over_screen import GameOverScreen


class FakeClient:
    def __init__(self) -> None:
        self.submissions = []
        self.scores = []

    def get_top_scores(self, game_id, limit=5):
        return self.scores[:limit]

    def submit_score(self, game_id, score, *, handle=None, share=False):
        entry = {"score": score, "handle": handle, "shared": share}
        self.submissions.append(entry)
        if handle:
            entry["handle"] = handle
        self.scores.append(entry)
        self.scores.sort(key=lambda item: item["score"], reverse=True)
        return entry


class GameOverScreenTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.client = FakeClient()
        self.screen = GameOverScreen("pong", self.client)

    def test_loads_scores_and_formats(self):
        self.client.scores = [
            {"score": 50, "handle": "Zoe", "shared": False},
            {"score": 30, "handle": None, "shared": False},
        ]
        entries = self.screen.load(limit=2)
        self.assertEqual(len(entries), 2)
        formatted = list(self.screen.formatted_scores())
        self.assertEqual(formatted[0], "1. Zoe — 50")
        self.assertEqual(formatted[1], "2. Anonymous — 30")

    def test_submit_refreshes_and_prompts(self):
        self.screen.submit(99, handle="Kim", share=True)
        self.assertTrue(self.screen.share_prompt)
        self.assertEqual(self.screen.top_scores[0].score, 99)
        self.screen.dismiss_share_prompt()
        self.assertIsNone(self.screen.share_prompt)

    def test_share_disabled_suppresses_prompt(self):
        self.screen.allow_share = False
        self.screen.submit(10, handle="Max", share=True)
        self.assertIsNone(self.screen.share_prompt)

    def test_handle_disabled_hides_name(self):
        self.screen.allow_handle = False
        self.screen.submit(15, handle="Quin", share=False)
        self.assertIsNone(self.client.submissions[0]["handle"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
