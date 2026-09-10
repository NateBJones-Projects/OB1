import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

DASHBOARD_DIR = pathlib.Path(__file__).parents[1] / "dashboard"
MODULE_PATH = DASHBOARD_DIR / "plugin_api.py"


def load_module():
    sys.path.insert(0, str(DASHBOARD_DIR))
    try:
        spec = importlib.util.spec_from_file_location("open_brain_browser_plugin_api", MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(DASHBOARD_DIR))


class OpenBrainApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()
        app = FastAPI()
        app.include_router(cls.module.router)
        cls.client = TestClient(app)

    def test_router_exposes_get_only_browser_routes(self):
        routes = {
            route.path: sorted(route.methods)
            for route in self.module.router.routes
            if getattr(route, "methods", None)
        }
        self.assertEqual(routes, {
            "/launch": ["POST"],
            "/stats": ["GET"],
            "/thoughts": ["GET"],
            "/search": ["GET"],
        })

    def test_launch_starts_the_fixed_dashboard_target(self):
        with patch.object(
            self.module,
            "_launch_local_dashboard",
            return_value={"status": "ready", "url": "http://127.0.0.1:3049"},
        ) as launch:
            response = self.client.post("/launch")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "status": "ready",
            "url": "http://127.0.0.1:3049",
        })
        launch.assert_called_once_with()

    def test_stats_returns_parsed_mcp_data(self):
        raw = "Total thoughts: 2\nDate range: 1/1/2026 → 1/2/2026\n\nTypes:\n  idea: 2"
        with patch.object(self.module, "_call_open_brain", return_value=raw) as call:
            response = self.client.get("/stats")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 2)
        call.assert_called_once_with("thought_stats", {})

    def test_thoughts_passes_filtered_read_request(self):
        raw = "1 recent thought(s):\n\n1. [1/2/2026] (idea - systems)\n   Body."
        with patch.object(self.module, "_call_open_brain", return_value=raw) as call:
            response = self.client.get(
                "/thoughts",
                params={"limit": 5, "type": "idea", "topic": "systems", "days": 30},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"][0]["content"], "Body.")
        call.assert_called_once_with("list_thoughts", {
            "limit": 5,
            "type": "idea",
            "topic": "systems",
            "days": 30,
        })

    def test_search_requires_nonblank_query(self):
        response = self.client.get("/search", params={"q": "   "})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Search query is required")

    def test_search_returns_parsed_results(self):
        raw = """Found 1 thought(s):

--- Result 1 (75.0% match) ---
Captured: 1/2/2026
Type: idea
Topics: systems

Body.
"""
        with patch.object(self.module, "_call_open_brain", return_value=raw) as call:
            response = self.client.get("/search", params={"q": "systems", "limit": 4})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"][0]["score"], 75.0)
        call.assert_called_once_with("search_thoughts", {
            "query": "systems",
            "limit": 4,
            "threshold": 0.5,
        })


if __name__ == "__main__":
    unittest.main()
