"""Read-only FastAPI bridge from Hermes Desktop to Open Brain MCP."""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from hermes_cli.plugins import PluginContext, PluginManifest


_DATA_PATH = Path(__file__).with_name("open_brain_data.py")
_DATA_MODULE_NAME = "open_brain_browser_data"
_data_spec = importlib.util.spec_from_file_location(_DATA_MODULE_NAME, _DATA_PATH)
if _data_spec is None or _data_spec.loader is None:
    raise RuntimeError("Unable to load Open Brain browser parser")
_data = importlib.util.module_from_spec(_data_spec)
sys.modules[_DATA_MODULE_NAME] = _data
_data_spec.loader.exec_module(_data)

build_tool_call = _data.build_tool_call
parse_list_result = _data.parse_list_result
parse_search_result = _data.parse_search_result
parse_stats_result = _data.parse_stats_result

_PLUGIN_ID = "open-brain-browser"
_OPEN_BRAIN_SERVER = "open-brain"
_LOCAL_DASHBOARD_URL = "http://127.0.0.1:3049"
_LOCAL_LOGIN_URL = f"{_LOCAL_DASHBOARD_URL}/login"
_DEFAULT_LAUNCHER = (
    Path.home()
    / "GoogleDrive"
    / "cfk master"
    / "02-projects"
    / "open-brain"
    / "scripts"
    / "Open-Brain-Dashboard.ps1"
)
_context = PluginContext(
    PluginManifest(name=_PLUGIN_ID, key=_PLUGIN_ID),
    manager=None,
)

router = APIRouter()


def _dashboard_ready() -> bool:
    try:
        request = Request(_LOCAL_LOGIN_URL, method="GET")
        with urlopen(request, timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def _launch_local_dashboard() -> dict[str, str]:
    if _dashboard_ready():
        return {"status": "ready", "url": _LOCAL_DASHBOARD_URL}

    launcher = Path(os.environ.get("OPEN_BRAIN_DASHBOARD_LAUNCHER", _DEFAULT_LAUNCHER))
    if not launcher.is_file():
        raise RuntimeError("Open Brain dashboard launcher was not found")

    powershell = shutil.which("pwsh.exe") or shutil.which("powershell.exe")
    if not powershell:
        raise RuntimeError("PowerShell was not found")

    completed = subprocess.run(
        [powershell, "-NoProfile", "-File", str(launcher), "-NoBrowser"],
        capture_output=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        text=True,
        timeout=45,
    )
    if completed.returncode != 0 or not _dashboard_ready():
        raise RuntimeError("Open Brain dashboard did not start")

    return {"status": "ready", "url": _LOCAL_DASHBOARD_URL}


@router.post("/launch")
async def launch() -> dict[str, str]:
    try:
        return await run_in_threadpool(_launch_local_dashboard)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _result_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("text", "result", "content"):
            candidate = value.get(key)
            if isinstance(candidate, str):
                return candidate
        content = value.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    return item["text"]
    raise RuntimeError("Open Brain returned an unsupported response shape")


def _call_open_brain(tool: str, arguments: dict[str, Any]) -> str:
    """Call one allowlisted read-only Open Brain tool and return its text."""
    envelope = _context.call_mcp(
        _OPEN_BRAIN_SERVER,
        tool,
        arguments,
        timeout=45,
    )
    if not envelope.get("ok"):
        raise RuntimeError(str(envelope.get("error") or "Open Brain request failed"))
    return _result_text(envelope.get("result"))


async def _run(operation: str, params: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    try:
        tool, arguments = build_tool_call(operation, params)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        raw = await run_in_threadpool(_call_open_brain, tool, arguments)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return raw, arguments


@router.get("/stats")
async def stats() -> dict[str, Any]:
    raw, _ = await _run("stats", {})
    return parse_stats_result(raw)


@router.get("/thoughts")
async def thoughts(
    limit: int = Query(default=25),
    type: str = Query(default=""),
    topic: str = Query(default=""),
    person: str = Query(default=""),
    days: int | None = Query(default=None),
) -> dict[str, Any]:
    raw, arguments = await _run(
        "recent",
        {
            "limit": limit,
            "type": type,
            "topic": topic,
            "person": person,
            "days": days,
        },
    )
    return {"items": parse_list_result(raw), "query": arguments}


@router.get("/search")
async def search(
    q: str = Query(default=""),
    limit: int = Query(default=25),
    threshold: float = Query(default=0.5),
) -> dict[str, Any]:
    raw, arguments = await _run(
        "search",
        {"query": q, "limit": limit, "threshold": threshold},
    )
    return {"items": parse_search_result(raw), "query": arguments}
