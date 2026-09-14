import importlib.util
import pathlib
import unittest

MODULE_PATH = pathlib.Path(__file__).parents[1] / "dashboard" / "open_brain_data.py"


def load_module():
    spec = importlib.util.spec_from_file_location("open_brain_data", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class OpenBrainDataTests(unittest.TestCase):
    def test_parse_recent_thoughts(self):
        module = load_module()
        raw = """2 recent thought(s):

1. [9/3/2026] (observation - daily-status, Hermes, gateway)
   [memory:semantic] [project:counsel] First thought body.

2. [9/2/2026] (task - automation)
   Second thought body across
   two lines.
"""
        result = module.parse_list_result(raw)

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["captured"], "9/3/2026")
        self.assertEqual(result[0]["type"], "observation")
        self.assertEqual(result[0]["topics"], ["daily-status", "Hermes", "gateway"])
        self.assertEqual(result[0]["content"], "[memory:semantic] [project:counsel] First thought body.")
        self.assertEqual(result[1]["type"], "task")
        self.assertEqual(result[1]["content"], "Second thought body across\ntwo lines.")

    def test_parse_semantic_search_results(self):
        module = load_module()
        raw = """Found 1 thought(s):

--- Result 1 (66.2% match) ---
Captured: 6/13/2026
Type: observation
Topics: Vector Control Center, operational checklist
People: cfklein

A searchable thought body.
"""
        result = module.parse_search_result(raw)

        self.assertEqual(result, [{
            "index": 1,
            "captured": "6/13/2026",
            "type": "observation",
            "topics": ["Vector Control Center", "operational checklist"],
            "people": ["cfklein"],
            "score": 66.2,
            "content": "A searchable thought body.",
        }])

    def test_parse_stats(self):
        module = load_module()
        raw = """Total thoughts: 1277
Date range: 3/9/2026 → 9/3/2026

Types:
  observation: 638
  task: 335

Top topics:
  daily: 59
  automation: 26

People mentioned:
  Chuck: 389
  Vector: 16
"""
        result = module.parse_stats_result(raw)

        self.assertEqual(result["total"], 1277)
        self.assertEqual(result["date_range"], "3/9/2026 → 9/3/2026")
        self.assertEqual(result["types"], {"observation": 638, "task": 335})
        self.assertEqual(result["topics"], {"daily": 59, "automation": 26})
        self.assertEqual(result["people"], {"Chuck": 389, "Vector": 16})

    def test_build_recent_call_filters_and_clamps(self):
        module = load_module()
        tool, arguments = module.build_tool_call("recent", {
            "limit": 500,
            "type": " observation ",
            "topic": "daily",
            "person": "",
            "days": 7,
        })

        self.assertEqual(tool, "list_thoughts")
        self.assertEqual(arguments, {
            "limit": 100,
            "type": "observation",
            "topic": "daily",
            "days": 7,
        })

    def test_build_search_call_requires_query(self):
        module = load_module()
        with self.assertRaisesRegex(ValueError, "Search query is required"):
            module.build_tool_call("search", {"query": "   "})

    def test_build_search_call_clamps_values(self):
        module = load_module()
        tool, arguments = module.build_tool_call("search", {
            "query": "  control center  ",
            "limit": 0,
            "threshold": 2,
        })

        self.assertEqual(tool, "search_thoughts")
        self.assertEqual(arguments, {
            "query": "control center",
            "limit": 1,
            "threshold": 1.0,
        })

    def test_stats_call_has_no_arguments(self):
        module = load_module()
        self.assertEqual(module.build_tool_call("stats", {}), ("thought_stats", {}))

    def test_unknown_operation_is_rejected(self):
        module = load_module()
        with self.assertRaisesRegex(ValueError, "Unsupported operation"):
            module.build_tool_call("capture", {"content": "must remain read-only"})


if __name__ == "__main__":
    unittest.main()
