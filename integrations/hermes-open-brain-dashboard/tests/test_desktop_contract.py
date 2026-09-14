import pathlib
import re
import unittest

PLUGIN_PATH = pathlib.Path(__file__).parents[1] / "desktop" / "plugin.js"


class DesktopPluginContractTests(unittest.TestCase):
    def setUp(self):
        self.source = PLUGIN_PATH.read_text(encoding="utf-8")

    def test_registers_open_brain_page_and_sidebar_navigation(self):
        self.assertIn("id: ID", self.source)
        self.assertIn("area: ROUTES_AREA", self.source)
        self.assertIn("path: '/open-brain'", self.source)
        self.assertIn("area: SIDEBAR_NAV_AREA", self.source)
        self.assertIn("label: 'Open Brain'", self.source)

    def test_frontend_launches_the_verified_local_dashboard(self):
        calls = re.findall(r"ctx\.rest\(([^\n]+)", self.source)
        self.assertTrue(calls)
        joined = "\n".join(calls)
        self.assertIn("/launch", joined)
        self.assertIn("method: 'POST'", self.source)
        self.assertIn("http://127.0.0.1:3049", self.source)
        self.assertIn("https://temporary-quick-boron-fefsc1w.vercel.app", self.source)
        self.assertIn("jsx('iframe'", self.source)
        self.assertNotIn("/stats", joined)
        self.assertNotIn("/thoughts", joined)
        self.assertNotIn("/search", joined)

    def test_does_not_expose_open_brain_write_actions(self):
        forbidden = (
            "capture_thought",
            "delete_thought",
            "update_thought",
            "create_thought",
        )
        for token in forbidden:
            self.assertNotIn(token, self.source)

    def test_uses_only_supported_disk_plugin_imports(self):
        imports = re.findall(r"from\s+['\"]([^'\"]+)['\"]", self.source)
        self.assertTrue(imports)
        self.assertTrue(set(imports).issubset({
            "@hermes/plugin-sdk",
            "react",
            "react/jsx-runtime",
        }))


if __name__ == "__main__":
    unittest.main()
