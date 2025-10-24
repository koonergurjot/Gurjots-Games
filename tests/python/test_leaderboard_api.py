from __future__ import annotations

import io
import json
import multiprocessing
import os
import tempfile
import unittest
from pathlib import Path
from typing import Dict
from wsgiref.util import setup_testing_defaults

import api.routes as routes
from server import leaderboard


def _submit_concurrent_score(storage_path: str, score: int) -> None:
    os.environ["LEADERBOARD_STORAGE_PATH"] = storage_path
    from server import leaderboard as lb

    lb.configure_storage(storage_path)
    lb.submit_score("concurrent", score, handle=f"player-{score}")


class LeaderboardAPITestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        storage_path = Path(self.tempdir.name) / 'leaderboard.json'
        leaderboard.configure_storage(storage_path)
        leaderboard.clear_scores()
        self._original_rate_limiter = routes._rate_limiter
        routes._rate_limiter = routes.RateLimiter(window_seconds=60, max_requests=3)
        self.addCleanup(self._restore_rate_limiter)
        routes.reset_rate_limiter()

    def _restore_rate_limiter(self) -> None:
        routes._rate_limiter = self._original_rate_limiter
        self._original_rate_limiter.reset()

    def _start_response(self, status: str, headers: list[tuple[str, str]]):
        self.status = status
        self.headers = dict(headers)

    def _invoke(self, environ: Dict[str, object]):
        setup_testing_defaults(environ)
        environ.setdefault("REMOTE_ADDR", "test-client")
        body = b"".join(routes.application(environ, self._start_response))
        return self.status, self.headers, body

    def test_submit_and_fetch_scores(self):
        payload = json.dumps({"game": "pong", "score": 42, "handle": "Ada", "share": True}).encode()
        status, headers, body = self._invoke(
            {
                "REQUEST_METHOD": "POST",
                "PATH_INFO": "/api/leaderboard",
                "CONTENT_LENGTH": str(len(payload)),
                "wsgi.input": io.BytesIO(payload),
            }
        )
        self.assertTrue(status.startswith("201"))
        response = json.loads(body)
        self.assertIn("submitted", response)
        self.assertTrue(response["submitted"]["shared"])

        status, _, body = self._invoke(
            {
                "REQUEST_METHOD": "GET",
                "PATH_INFO": "/api/leaderboard",
                "QUERY_STRING": "game=pong&limit=5",
            }
        )
        self.assertTrue(status.startswith("200"))
        results = json.loads(body)
        self.assertEqual(len(results["scores"]), 1)
        self.assertEqual(results["scores"][0]["score"], 42)

    def test_invalid_payload_rejected(self):
        payload = json.dumps({"game": "", "score": "oops"}).encode()
        status, _, body = self._invoke(
            {
                "REQUEST_METHOD": "POST",
                "PATH_INFO": "/api/leaderboard",
                "CONTENT_LENGTH": str(len(payload)),
                "wsgi.input": io.BytesIO(payload),
            }
        )
        self.assertTrue(status.startswith("400"), body)
        message = json.loads(body)
        self.assertIn("error", message)

    def test_rate_limit_blocks_excessive_calls(self):
        environ = {
            "REQUEST_METHOD": "GET",
            "PATH_INFO": "/api/leaderboard",
            "QUERY_STRING": "game=pong",
        }
        for _ in range(routes._rate_limiter.max_requests):
            status, _, _ = self._invoke(environ)
            self.assertTrue(status.startswith("200"))
        status, _, body = self._invoke(environ)
        self.assertTrue(status.startswith("429"), body)
        payload = json.loads(body)
        self.assertIn("Rate limit exceeded", payload["error"])

    def test_post_rate_limit_is_per_game(self):
        payload_template = {"score": 1, "handle": "Tester"}
        for _ in range(routes._rate_limiter.max_requests):
            payload = json.dumps({"game": "pong", **payload_template}).encode()
            status, _, _ = self._invoke(
                {
                    "REQUEST_METHOD": "POST",
                    "PATH_INFO": "/api/leaderboard",
                    "CONTENT_LENGTH": str(len(payload)),
                    "wsgi.input": io.BytesIO(payload),
                }
            )
            self.assertTrue(status.startswith("201"), status)

        payload = json.dumps({"game": "pong", **payload_template}).encode()
        status, _, body = self._invoke(
            {
                "REQUEST_METHOD": "POST",
                "PATH_INFO": "/api/leaderboard",
                "CONTENT_LENGTH": str(len(payload)),
                "wsgi.input": io.BytesIO(payload),
            }
        )
        self.assertTrue(status.startswith("429"), body)
        response = json.loads(body)
        self.assertEqual(response.get("identifier"), "test-client:pong")

        alternate_payload = json.dumps({"game": "tetris", **payload_template}).encode()
        status, _, _ = self._invoke(
            {
                "REQUEST_METHOD": "POST",
                "PATH_INFO": "/api/leaderboard",
                "CONTENT_LENGTH": str(len(alternate_payload)),
                "wsgi.input": io.BytesIO(alternate_payload),
            }
        )
        self.assertTrue(status.startswith("201"))

    def test_concurrent_writes_preserve_scores(self):
        ctx = multiprocessing.get_context("spawn")
        storage_path = str(Path(self.tempdir.name) / "leaderboard.json")
        processes = []
        expected_scores = list(range(8))
        for score in expected_scores:
            proc = ctx.Process(target=_submit_concurrent_score, args=(storage_path, score))
            proc.start()
            processes.append(proc)

        for proc in processes:
            proc.join(timeout=10)
            self.assertFalse(proc.is_alive(), "Worker process did not terminate")
            self.assertEqual(proc.exitcode, 0)

        scores = leaderboard.get_top_scores("concurrent", limit=len(expected_scores))
        returned_scores = sorted(entry["score"] for entry in scores)
        self.assertEqual(returned_scores, expected_scores)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
