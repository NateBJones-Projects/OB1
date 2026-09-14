"""Pure parsing and request-boundary helpers for the Open Brain browser."""

from __future__ import annotations

import re
from typing import Any


_RECENT_ITEM = re.compile(
    r"(?ms)^\s*(\d+)\. \[([^\]]+)\] \(([^)]+)\)\s*\n(.*?)(?=^\s*\d+\. \[|\Z)"
)
_SEARCH_BLOCK = re.compile(
    r"(?ms)^--- Result (\d+) \(([0-9.]+)% match\) ---\s*\n(.*?)(?=^--- Result |\Z)"
)


def _clean_multiline(value: str) -> str:
    lines = value.strip().splitlines()
    cleaned = [re.sub(r"^\s{0,3}", "", line).rstrip() for line in lines]
    return "\n".join(cleaned).strip()


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _clamp_int(value: Any, minimum: int, maximum: int, default: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))


def _clamp_float(value: Any, minimum: float, maximum: float, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))


def parse_list_result(raw: str) -> list[dict[str, Any]]:
    """Parse the human-readable ``list_thoughts`` MCP result into cards."""
    items: list[dict[str, Any]] = []
    for match in _RECENT_ITEM.finditer(raw or ""):
        descriptor = match.group(3).strip()
        thought_type, separator, topics_raw = descriptor.partition(" - ")
        items.append(
            {
                "index": int(match.group(1)),
                "captured": match.group(2).strip(),
                "type": thought_type.strip(),
                "topics": _csv(topics_raw) if separator else [],
                "people": [],
                "score": None,
                "content": _clean_multiline(match.group(4)),
            }
        )
    return items


def parse_search_result(raw: str) -> list[dict[str, Any]]:
    """Parse the human-readable ``search_thoughts`` MCP result into cards."""
    items: list[dict[str, Any]] = []
    for match in _SEARCH_BLOCK.finditer(raw or ""):
        block = match.group(3).strip()
        fields: dict[str, str] = {}
        content_lines: list[str] = []
        reading_content = False
        for line in block.splitlines():
            if not reading_content:
                field = re.match(r"^(Captured|Type|Topics|People):\s*(.*)$", line.strip())
                if field:
                    fields[field.group(1).lower()] = field.group(2).strip()
                    continue
                if not line.strip():
                    reading_content = True
                    continue
                reading_content = True
            content_lines.append(line)
        items.append(
            {
                "index": int(match.group(1)),
                "captured": fields.get("captured", ""),
                "type": fields.get("type", ""),
                "topics": _csv(fields.get("topics", "")),
                "people": _csv(fields.get("people", "")),
                "score": float(match.group(2)),
                "content": _clean_multiline("\n".join(content_lines)),
            }
        )
    return items


def parse_stats_result(raw: str) -> dict[str, Any]:
    """Parse ``thought_stats`` into totals and ranked dictionaries."""
    total_match = re.search(r"(?m)^Total thoughts:\s*(\d+)\s*$", raw or "")
    range_match = re.search(r"(?m)^Date range:\s*(.*?)\s*$", raw or "")
    sections: dict[str, dict[str, int]] = {"types": {}, "topics": {}, "people": {}}
    current: str | None = None
    headings = {
        "Types:": "types",
        "Top topics:": "topics",
        "People mentioned:": "people",
    }
    for line in (raw or "").splitlines():
        stripped = line.strip()
        if stripped in headings:
            current = headings[stripped]
            continue
        if not stripped:
            continue
        if current:
            entry = re.match(r"^(.*?):\s*(\d+)\s*$", stripped)
            if entry:
                sections[current][entry.group(1).strip()] = int(entry.group(2))
    return {
        "total": int(total_match.group(1)) if total_match else 0,
        "date_range": range_match.group(1).strip() if range_match else "",
        **sections,
    }


def build_tool_call(operation: str, params: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Map the three read-only browser operations to Open Brain MCP tools."""
    if operation == "stats":
        return "thought_stats", {}

    if operation == "recent":
        arguments: dict[str, Any] = {
            "limit": _clamp_int(params.get("limit"), 1, 100, 25),
        }
        for name in ("type", "topic", "person"):
            value = str(params.get(name) or "").strip()
            if value:
                arguments[name] = value
        days = params.get("days")
        if days not in (None, ""):
            arguments["days"] = _clamp_int(days, 1, 36500, 30)
        return "list_thoughts", arguments

    if operation == "search":
        query = str(params.get("query") or "").strip()
        if not query:
            raise ValueError("Search query is required")
        return "search_thoughts", {
            "query": query,
            "limit": _clamp_int(params.get("limit"), 1, 50, 25),
            "threshold": _clamp_float(params.get("threshold"), 0.0, 1.0, 0.5),
        }

    raise ValueError(f"Unsupported operation: {operation}")
