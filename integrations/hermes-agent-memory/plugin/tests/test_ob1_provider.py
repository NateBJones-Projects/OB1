"""Tests for the Hermes OB1 memory provider plugin.

Covers pure helpers, lifecycle, the OB1 v1 schema shapes (recall + writeback
request bodies), prefetch + queue_prefetch caching, sync_turn writeback,
session-end / pre-compress hooks, and the seven tool handlers.

Network is mocked at urllib.request.urlopen — tests run offline.
"""

from __future__ import annotations

import io
import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple
from unittest.mock import MagicMock, patch

import pytest

# Tests live alongside the plugin package; import the module under test.
PLUGIN_ROOT = Path(__file__).resolve().parents[1]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

# Stub the two hermes-agent modules the plugin imports.
if "agent.memory_provider" not in sys.modules:
    import types as _t
    fake_pkg = _t.ModuleType("agent")
    fake_mp = _t.ModuleType("agent.memory_provider")

    class _StubProvider:
        def initialize(self, session_id, **kwargs): pass
        def shutdown(self): pass
        def on_turn_start(self, *a, **kw): pass
        def system_prompt_block(self): return ""
        def prefetch(self, query, *, session_id=""): return ""
        def queue_prefetch(self, query, *, session_id=""): pass
        def sync_turn(self, *a, **kw): pass
        def get_tool_schemas(self): return []
        def handle_tool_call(self, *a, **kw): return ""
        def is_available(self): return False
        def get_config_schema(self): return []
        def save_config(self, *a, **kw): pass
        @property
        def name(self): return "stub"

    fake_mp.MemoryProvider = _StubProvider
    sys.modules["agent"] = fake_pkg
    sys.modules["agent.memory_provider"] = fake_mp

if "tools.registry" not in sys.modules:
    import types as _t
    fake_tools = _t.ModuleType("tools")
    fake_reg = _t.ModuleType("tools.registry")

    def _tool_error(msg: str) -> str:
        return json.dumps({"error": msg})

    fake_reg.tool_error = _tool_error
    sys.modules["tools"] = fake_tools
    sys.modules["tools.registry"] = fake_reg

import __init__ as ob1_module  # noqa: E402
from __init__ import (  # noqa: E402
    OB1MemoryProvider,
    _OB1Client,
    _RECALL_SCHEMA_VERSION,
    _WRITEBACK_SCHEMA_VERSION,
    _PREFETCH_TTL_SECONDS,
    _clean_text_for_capture,
    _default_config,
    _extract_findings,
    _format_recall_context,
    _format_relative_time,
    _is_trivial_message,
    _read_hermes_active_model,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for key in (
        "OPENBRAIN_KEY", "OPENBRAIN_URL", "OPENBRAIN_WORKSPACE_ID",
        "OPENBRAIN_PROJECT_ID", "HERMES_HOME",
    ):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def hermes_home(tmp_path):
    home = tmp_path / "hermes_home"
    home.mkdir()
    return home


@pytest.fixture
def configured(hermes_home, monkeypatch):
    """Provider with endpoint + key wired up but urlopen still mocked elsewhere."""
    (hermes_home / "ob1.json").write_text(json.dumps({
        "endpoint": "http://test/agent-memory-api",
        "workspace_id": "ws-test",
        "project_id": "proj-test",
        "auto_recall": True,
        "auto_capture": True,
        "max_recall_results": 5,
        "default_confidence": 0.6,
        "require_review_by_default": True,
    }))
    monkeypatch.setenv("OPENBRAIN_KEY", "test-key-123")
    return hermes_home


def _mock_urlopen_response(body: Dict[str, Any], status: int = 200):
    """Build a context-manager mock that mimics urllib's urlopen response."""
    payload = json.dumps(body).encode("utf-8")
    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=MagicMock(read=lambda: payload))
    cm.__exit__ = MagicMock(return_value=False)
    return cm


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestPureHelpers:

    def test_default_config_has_expected_keys(self):
        cfg = _default_config()
        assert cfg["workspace_id"] == "default"
        assert cfg["auto_recall"] is True
        assert cfg["auto_capture"] is True
        assert cfg["require_review_by_default"] is True
        assert 0 <= cfg["default_confidence"] <= 1

    @pytest.mark.parametrize("text,expected", [
        ("ok", True), ("OK", True), ("thanks", True),
        ("yes", True), ("nope.", True), ("k", True),
        ("Could you help with the deployment plan?", False),
        ("", False),
        ("ok this is a longer reply that is not trivial", False),
    ])
    def test_is_trivial_message(self, text, expected):
        assert _is_trivial_message(text) is expected

    def test_clean_text_strips_ob1_context(self):
        msg = "Real content.\n<ob1-context>\nrecalled stuff\n</ob1-context>\nMore content."
        cleaned = _clean_text_for_capture(msg)
        assert "ob1-context" not in cleaned
        assert "recalled stuff" not in cleaned
        assert "Real content" in cleaned
        assert "More content" in cleaned

    def test_clean_text_handles_no_wrapper(self):
        assert _clean_text_for_capture("plain text").strip() == "plain text"

    def test_format_recall_context_empty(self):
        assert _format_recall_context([], 5) == ""

    def test_format_recall_context_renders_provenance_tags(self):
        out = _format_recall_context([
            {
                "summary": "Always run migrations off-hours.",
                "use_policy": {"can_use_as_instruction": True, "requires_user_confirmation": False},
                "updated_at": "2026-05-09T10:00:00Z",
            },
            {
                "summary": "Last build took 12 minutes.",
                "use_policy": {"can_use_as_evidence": True},
            },
        ], 5)
        assert "<ob1-context>" in out
        assert "Always run migrations" in out
        assert "[instruction]" in out
        assert "[evidence]" in out

    def test_format_recall_context_truncates_to_max(self):
        items = [{"summary": f"memory {i}"} for i in range(10)]
        out = _format_recall_context(items, max_results=3)
        # Each rendered line starts with "- " (and a leading prefix space when
        # there are no provenance tags). Count occurrences of the body marker.
        assert out.count("memory ") == 3

    def test_format_relative_time_recent(self):
        from datetime import datetime, timezone, timedelta
        ts = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        assert _format_relative_time(ts) == "just now"

    def test_format_relative_time_handles_garbage(self):
        assert _format_relative_time("") == ""
        assert _format_relative_time("not-a-date") == ""


class TestExtractFindings:

    def test_extracts_decisions(self):
        msgs = [{"role": "assistant", "content": "We decided to use Postgres for the queue."}]
        findings = _extract_findings(msgs)
        assert "decisions" in findings
        assert any("Postgres" in d for d in findings["decisions"])

    def test_extracts_constraints(self):
        msgs = [{"role": "user", "content": "We must not exceed 50 RPS on this endpoint."}]
        findings = _extract_findings(msgs)
        assert "constraints" in findings

    def test_extracts_failures(self):
        msgs = [{"role": "assistant", "content": "The build failed because the schema migration broke the tests."}]
        findings = _extract_findings(msgs)
        assert "failures" in findings

    def test_skips_short_lines(self):
        msgs = [{"role": "user", "content": "Failed."}]  # <20 chars
        findings = _extract_findings(msgs)
        assert findings == {}

    def test_skips_overlong_lines(self):
        msgs = [{"role": "user", "content": "We decided to " + "x" * 500}]
        findings = _extract_findings(msgs)
        assert findings == {}

    def test_per_category_limit(self):
        msgs = [{"role": "user", "content": " ".join([
            f"We decided to do thing {i} for the project quickly." for i in range(20)
        ])}]
        findings = _extract_findings(msgs, per_category_limit=3)
        assert len(findings.get("decisions", [])) <= 3

    def test_first_match_wins(self):
        # "decided" is decisions; "next time" is lessons. Decisions wins.
        msgs = [{"role": "user", "content": "We decided to fix it next time around."}]
        findings = _extract_findings(msgs)
        assert "decisions" in findings
        assert "lessons" not in findings


class TestResolveWorkspaceId:
    """Per-agent workspace mode resolution (mirrors OpenClaw plugin's workspaceMode)."""

    def test_shared_mode_returns_fallback(self):
        from __init__ import _resolve_workspace_id
        assert _resolve_workspace_id(
            mode="shared", prefix="ignored-", agent_identity="nina", fallback="fleet",
        ) == "fleet"

    def test_per_agent_mode_uses_agent_identity(self):
        from __init__ import _resolve_workspace_id
        assert _resolve_workspace_id(
            mode="per-agent", prefix="", agent_identity="nina", fallback="fleet",
        ) == "nina"

    def test_per_agent_with_prefix(self):
        from __init__ import _resolve_workspace_id
        assert _resolve_workspace_id(
            mode="per-agent", prefix="hermes-", agent_identity="nina", fallback="fleet",
        ) == "hermes-nina"

    def test_per_agent_falls_back_when_identity_is_default(self):
        # "default" is the placeholder when no agent identity is set —
        # must fall back to the configured workspace, not "default" the literal.
        from __init__ import _resolve_workspace_id
        assert _resolve_workspace_id(
            mode="per-agent", prefix="", agent_identity="default", fallback="fleet",
        ) == "fleet"

    def test_per_agent_falls_back_when_identity_empty(self):
        from __init__ import _resolve_workspace_id
        assert _resolve_workspace_id(
            mode="per-agent", prefix="", agent_identity="", fallback="fleet",
        ) == "fleet"

    def test_unknown_mode_treated_as_shared(self):
        from __init__ import _resolve_workspace_id
        assert _resolve_workspace_id(
            mode="garbage", prefix="x-", agent_identity="nina", fallback="fleet",
        ) == "fleet"


class TestReadHermesActiveModel:
    """Regression tests for the bug where a line-scan matched stt.local.model."""

    def test_returns_empty_when_no_config(self, hermes_home):
        out = _read_hermes_active_model(str(hermes_home))
        assert out == {"model": "", "provider": ""}

    def test_reads_nested_model_default(self, hermes_home, monkeypatch):
        monkeypatch.setattr(ob1_module, "_read_hermes_active_model", _read_hermes_active_model)
        (hermes_home / "config.yaml").write_text(
            "model:\n"
            "  default: anthropic/claude-opus-4.6\n"
            "  provider: openrouter\n"
            "  base_url: https://openrouter.ai/api/v1\n"
            "stt:\n"
            "  local:\n"
            "    model: base\n"
        )
        out = _read_hermes_active_model(str(hermes_home))
        assert out["model"] == "anthropic/claude-opus-4.6"
        assert out["provider"] == "openrouter"

    def test_treats_provider_auto_as_empty(self, hermes_home):
        (hermes_home / "config.yaml").write_text(
            "model:\n"
            "  default: anthropic/claude-opus-4.6\n"
            "  provider: auto\n"
        )
        out = _read_hermes_active_model(str(hermes_home))
        assert out["provider"] == ""  # let prefix derivation pick it up

    def test_falls_back_to_top_level_default_model(self, hermes_home):
        (hermes_home / "config.yaml").write_text(
            "default_model: openai/gpt-5\n"
            "stt:\n"
            "  local:\n"
            "    model: base\n"
        )
        out = _read_hermes_active_model(str(hermes_home))
        assert out["model"] == "openai/gpt-5"

    def test_does_not_match_stt_local_model(self, hermes_home):
        # Critical regression: nested `model:` is a dict, not a value — the
        # old line-scan picked up `model: base` from stt.local.
        (hermes_home / "config.yaml").write_text(
            "stt:\n  local:\n    model: base\n"
        )
        out = _read_hermes_active_model(str(hermes_home))
        assert out["model"] != "base"


# ---------------------------------------------------------------------------
# OB1 client — schema shape on the wire
# ---------------------------------------------------------------------------


class TestOB1Client:

    def _capture_request(self):
        captured: Dict[str, Any] = {}

        def fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["method"] = req.get_method()
            captured["headers"] = dict(req.header_items())
            captured["body"] = json.loads(req.data.decode("utf-8")) if req.data else None
            return _mock_urlopen_response({"request_id": "req-001", "memories": []})

        return captured, fake_urlopen

    def test_recall_payload_uses_v1_schema_version(self):
        captured, fake = self._capture_request()
        client = _OB1Client("http://x", "key", 5.0)
        with patch("urllib.request.urlopen", fake):
            client.recall(
                workspace_id="ws-1", project_id="proj-1", task_type="general",
                query="hello",
            )
        body = captured["body"]
        assert body["schema_version"] == _RECALL_SCHEMA_VERSION
        assert body["workspace_id"] == "ws-1"
        assert body["project_id"] == "proj-1"
        assert body["task_type"] == "general"
        assert body["query"] == "hello"
        assert body["scope"]["project_only"] is True

    def test_recall_uses_x_brain_key_header(self):
        captured, fake = self._capture_request()
        client = _OB1Client("http://x", "secret-key", 5.0)
        with patch("urllib.request.urlopen", fake):
            client.recall(workspace_id="w", project_id=None, task_type="t", query="q")
        # urllib lowercases header keys in header_items()
        headers_lc = {k.lower(): v for k, v in captured["headers"].items()}
        assert headers_lc.get("x-brain-key") == "secret-key"
        # Critical: must NOT use Authorization Bearer
        assert "authorization" not in headers_lc

    def test_writeback_payload_shape(self):
        captured, fake = self._capture_request()
        client = _OB1Client("http://x", "k", 5.0)
        with patch("urllib.request.urlopen", fake):
            client.writeback(
                workspace_id="ws", project_id="proj",
                memory_payload={"decisions": ["chose Postgres"]},
                runtime={"name": "hermes", "version": "0.13.0"},
                models_used=[{"provider": "openrouter", "model": "anthropic/claude-opus-4.6", "role": "primary"}],
                provenance={"default_status": "generated", "confidence": 0.7, "requires_review": True},
                task_id="task-1", flow_id="flow-1",
            )
        body = captured["body"]
        assert body["schema_version"] == _WRITEBACK_SCHEMA_VERSION
        assert body["memory_payload"]["decisions"] == ["chose Postgres"]
        assert body["runtime"]["name"] == "hermes"
        # runtime must NOT include extra keys (Edge Function rejects them).
        assert set(body["runtime"].keys()) <= {"name", "version"}
        assert body["models_used"][0]["model"] == "anthropic/claude-opus-4.6"
        assert body["task_id"] == "task-1"
        assert body["flow_id"] == "flow-1"

    def test_report_usage_shape(self):
        captured, fake = self._capture_request()
        client = _OB1Client("http://x", "k", 5.0)
        with patch("urllib.request.urlopen", fake):
            client.report_usage("req-1", used=["m1", "m2"], ignored=["m3"])
        assert "/recall/req-1/usage" in captured["url"]
        body = captured["body"]
        assert body["used_memory_ids"] == ["m1", "m2"]
        assert body["ignored"] == [{"memory_id": "m3"}]

    def test_http_error_is_raised(self):
        import urllib.error
        client = _OB1Client("http://x", "k", 5.0)
        err = urllib.error.HTTPError(
            url="http://x/recall", code=400, msg="Bad",
            hdrs=None, fp=io.BytesIO(b'{"error":"nope"}'),
        )
        with patch("urllib.request.urlopen", side_effect=err):
            with pytest.raises(RuntimeError, match="HTTP 400"):
                client.recall(workspace_id="w", project_id=None, task_type="t", query="q")


# ---------------------------------------------------------------------------
# Provider lifecycle
# ---------------------------------------------------------------------------


class TestProviderLifecycle:

    def test_name_is_ob1(self):
        assert OB1MemoryProvider().name == "ob1"

    def test_inactive_without_key(self, configured, monkeypatch):
        monkeypatch.delenv("OPENBRAIN_KEY", raising=False)
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="s", hermes_home=str(configured))
        assert p._active is False

    def test_inactive_without_endpoint(self, hermes_home, monkeypatch):
        monkeypatch.setenv("OPENBRAIN_KEY", "k")
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="s", hermes_home=str(hermes_home))
        assert p._active is False

    def test_active_when_both_present(self, configured):
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={"ok": True}):
            p.initialize(session_id="s", hermes_home=str(configured))
        assert p._active is True
        assert p._workspace_id == "ws-test"
        assert p._project_id == "proj-test"

    def test_subagent_context_disables_writes(self, configured):
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="s", hermes_home=str(configured),
                         agent_context="subagent")
        assert p._write_enabled is False

    def test_health_failure_keeps_provider_active(self, configured):
        # Backend health probe failing shouldn't disable the provider —
        # the agent should still be able to attempt operations.
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", side_effect=RuntimeError("502")):
            p.initialize(session_id="s", hermes_home=str(configured))
        assert p._active is True

    def test_save_config_persists_only_known_keys(self, hermes_home):
        p = OB1MemoryProvider()
        p.save_config({
            "endpoint": "http://new/api",
            "workspace_id": "ws-2",
            "auto_recall": False,
            "max_recall_results": 12,
            "ignored_garbage_key": "should not persist",
        }, str(hermes_home))
        loaded = json.loads((hermes_home / "ob1.json").read_text())
        assert loaded["endpoint"] == "http://new/api"
        assert loaded["workspace_id"] == "ws-2"
        assert loaded["auto_recall"] is False
        assert loaded["max_recall_results"] == 12
        assert "ignored_garbage_key" not in loaded


# ---------------------------------------------------------------------------
# Per-turn hooks
# ---------------------------------------------------------------------------


class TestOnTurnStart:

    def test_caches_kwargs(self, configured):
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="s", hermes_home=str(configured))
        p.on_turn_start(3, "msg", model="anthropic/claude-opus-4.6", remaining_tokens=1200)
        assert p._last_turn_meta["model"] == "anthropic/claude-opus-4.6"
        assert p._last_turn_meta["turn_number"] == 3
        assert p._last_turn_meta["remaining_tokens"] == 1200

    def test_resolve_model_provider_uses_cached_kwargs(self, configured):
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="s", hermes_home=str(configured))
        p._last_turn_meta = {"model": "openrouter/stepfun/step-3.5-flash"}
        out = p._resolve_model_provider()
        assert out["model"] == "openrouter/stepfun/step-3.5-flash"
        # Provider derived from prefix
        assert out["provider"] == "openrouter"

    def test_resolve_model_provider_falls_back_to_config(self, configured):
        # No on_turn_start kwargs cached — should read config.yaml
        (Path(configured) / "config.yaml").write_text(
            "model:\n  default: anthropic/claude-opus-4.6\n  provider: openrouter\n"
        )
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="s", hermes_home=str(configured))
        out = p._resolve_model_provider()
        assert out["model"] == "anthropic/claude-opus-4.6"
        assert out["provider"] == "openrouter"


class TestPrefetchAndCache:

    def _patched(self, configured) -> OB1MemoryProvider:
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="sess", hermes_home=str(configured))
        return p

    def test_inactive_prefetch_returns_empty(self, hermes_home):
        p = OB1MemoryProvider()
        # Not initialized — should return empty without raising
        assert p.prefetch("query") == ""

    def test_cold_prefetch_does_sync_recall(self, configured):
        p = self._patched(configured)
        calls: List[str] = []

        def fake_do_recall(query, *, session_id=""):
            calls.append(query)
            return f"<ctx>{query}</ctx>", "req-1"

        p._do_recall = fake_do_recall
        out = p.prefetch("hello")
        assert "hello" in out
        assert calls == ["hello"]
        assert p._last_request_id == "req-1"

    def test_queue_prefetch_caches_result(self, configured):
        p = self._patched(configured)
        results = []

        def fake_do_recall(query, *, session_id=""):
            results.append(query)
            return f"<ctx>{query}</ctx>", "req-bg"

        p._do_recall = fake_do_recall
        p.queue_prefetch("warm-up")
        # Wait for thread (deterministic — wait on the thread itself)
        if p._prefetch_thread:
            p._prefetch_thread.join(timeout=5)
        assert p._prefetch_cache is not None
        cached_query, cached_ctx, cached_req, _ts = p._prefetch_cache
        assert cached_query == "warm-up"
        assert "warm-up" in cached_ctx
        assert cached_req == "req-bg"
        assert results == ["warm-up"]

    def test_warm_prefetch_consumes_cache_without_recall(self, configured):
        p = self._patched(configured)
        recall_calls = []

        def fake_do_recall(query, *, session_id=""):
            recall_calls.append(query)
            return f"<ctx>{query}</ctx>", "req-X"

        p._do_recall = fake_do_recall
        p.queue_prefetch("warm-up")
        if p._prefetch_thread:
            p._prefetch_thread.join(timeout=5)
        # Now prefetch with a DIFFERENT query — should still use cache.
        out = p.prefetch("totally different query")
        assert "warm-up" in out  # cached context returned
        assert len(recall_calls) == 1  # only the bg recall, no new sync recall
        assert p._prefetch_cache is None  # cache cleared after consumption

    def test_stale_cache_is_discarded(self, configured):
        p = self._patched(configured)
        recall_calls = []

        def fake_do_recall(query, *, session_id=""):
            recall_calls.append(query)
            return f"<ctx>{query}</ctx>", "req-fresh"

        p._do_recall = fake_do_recall
        # Inject stale cache
        p._prefetch_cache = ("stale-q", "<stale-ctx>", "old-req",
                             time.monotonic() - _PREFETCH_TTL_SECONDS - 10)
        out = p.prefetch("new query")
        assert "stale-ctx" not in out
        assert "new query" in out
        assert recall_calls == ["new query"]

    def test_burst_queue_prefetch_dedups(self, configured):
        p = self._patched(configured)
        slow_started = threading.Event()
        slow_release = threading.Event()
        recall_calls = []

        def slow_recall(query, *, session_id=""):
            recall_calls.append(query)
            slow_started.set()
            slow_release.wait(timeout=2)
            return "<ctx>", "req"

        p._do_recall = slow_recall
        p.queue_prefetch("first")
        slow_started.wait(timeout=2)
        # Second call while first is still running — must be a no-op.
        p.queue_prefetch("second")
        slow_release.set()
        if p._prefetch_thread:
            p._prefetch_thread.join(timeout=3)
        assert recall_calls == ["first"]

    def test_queue_prefetch_inactive_is_noop(self, hermes_home):
        p = OB1MemoryProvider()
        # Not initialized
        p.queue_prefetch("anything")
        assert p._prefetch_thread is None
        assert p._prefetch_cache is None

    def test_shutdown_joins_threads_and_clears_cache(self, configured):
        p = self._patched(configured)
        p._prefetch_cache = ("q", "ctx", "r", time.monotonic())
        p.shutdown()
        assert p._prefetch_cache is None
        assert p._prefetch_thread is None


class TestSyncTurn:

    def _patched(self, configured) -> Tuple[OB1MemoryProvider, List[Dict[str, Any]]]:
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="sess", hermes_home=str(configured))
        recorded: List[Dict[str, Any]] = []

        def fake_writeback(**kwargs):
            recorded.append(kwargs)
            return {"memory_id": "m-1"}

        p._client.writeback = fake_writeback  # type: ignore[assignment]
        return p, recorded

    def test_skips_trivial_user_message(self, configured):
        p, recorded = self._patched(configured)
        p.sync_turn("ok", "long enough assistant content here")
        time.sleep(0.1)
        assert recorded == []

    def test_skips_short_assistant(self, configured):
        p, recorded = self._patched(configured)
        p.sync_turn("Real question with enough content", "k.")
        time.sleep(0.1)
        assert recorded == []

    def test_skips_when_writes_disabled(self, configured):
        p, recorded = self._patched(configured)
        p._write_enabled = False
        p.sync_turn("Real question with enough content", "Real assistant content here")
        time.sleep(0.1)
        assert recorded == []

    def test_writeback_payload_uses_outputs_category(self, configured):
        p, recorded = self._patched(configured)
        p.sync_turn(
            "Real user question with enough content",
            "Real assistant content with enough length here",
        )
        if p._sync_thread:
            p._sync_thread.join(timeout=5)
        assert len(recorded) == 1
        body = recorded[0]
        assert "outputs" in body["memory_payload"]
        assert body["task_id"] == "sess"
        assert body["runtime"]["name"] == "hermes"
        # runtime must not have extra keys
        assert set(body["runtime"].keys()) <= {"name", "version"}

    def test_writeback_strips_ob1_context_wrapper(self, configured):
        p, recorded = self._patched(configured)
        user_with_ctx = "<ob1-context>recalled\n</ob1-context>\nReal user question with content"
        p.sync_turn(user_with_ctx, "Real assistant content with enough length")
        if p._sync_thread:
            p._sync_thread.join(timeout=5)
        body = recorded[0]
        for line in body["memory_payload"].get("outputs", []):
            assert "ob1-context" not in line
            assert "recalled" not in line


class TestSessionEnd:

    def _patched(self, configured) -> Tuple[OB1MemoryProvider, List[Dict[str, Any]]]:
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="sess", hermes_home=str(configured))
        recorded: List[Dict[str, Any]] = []

        def fake_writeback(**kwargs):
            recorded.append(kwargs)
            return {"memory_id": "m"}

        p._client.writeback = fake_writeback  # type: ignore[assignment]
        return p, recorded

    def test_extracts_findings_and_writes_synchronously(self, configured):
        p, recorded = self._patched(configured)
        msgs = [
            {"role": "user", "content": "We need to fix the slow build pipeline."},
            {"role": "assistant", "content": "We decided to switch to Bun for speed."},
            {"role": "user", "content": "TODO: write the migration scripts before friday."},
        ]
        p.on_session_end(msgs)
        # synchronous — recorded immediately
        assert len(recorded) == 1
        payload = recorded[0]["memory_payload"]
        assert any("Bun" in d for d in payload.get("decisions", []))
        assert any("TODO" in n for n in payload.get("next_steps", []))

    def test_skips_when_inactive(self, configured, monkeypatch):
        monkeypatch.delenv("OPENBRAIN_KEY", raising=False)
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="s", hermes_home=str(configured))
        # Active should be False without key
        assert p._active is False
        p.on_session_end([{"role": "user", "content": "We decided to do X."}])
        # Should not crash — no client to call


class TestPreCompress:

    def test_returns_summary_string_with_findings(self, configured):
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="sess", hermes_home=str(configured))
        recorded: List[Dict[str, Any]] = []

        def fake_writeback(**kwargs):
            recorded.append(kwargs)
            return {"memory_id": "m"}

        p._client.writeback = fake_writeback  # type: ignore[assignment]
        msgs = [
            {"role": "assistant", "content": "We decided to use Postgres for the queue."},
        ]
        out = p.on_pre_compress(msgs)
        assert "Decisions" in out
        assert "Postgres" in out
        # Background writeback should fire
        if p._sync_thread:
            p._sync_thread.join(timeout=5)
        assert len(recorded) == 1

    def test_returns_empty_when_no_findings(self, configured):
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="s", hermes_home=str(configured))
        # Trivial messages with no extractable findings
        out = p.on_pre_compress([{"role": "user", "content": "ok"}])
        assert out == ""


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


class TestTools:

    @pytest.fixture
    def active(self, configured) -> OB1MemoryProvider:
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="sess", hermes_home=str(configured))
        return p

    def test_returns_seven_schemas(self, active):
        names = {s["name"] for s in active.get_tool_schemas()}
        expected = {
            "ob1_recall", "ob1_writeback", "ob1_search",
            "ob1_report_usage", "ob1_list_review_queue",
            "ob1_review_memory", "ob1_get_recall_trace",
        }
        assert names == expected

    def test_unknown_tool_returns_error(self, active):
        out = active.handle_tool_call("ob1_nonsense", {})
        assert "Unknown tool" in out

    def test_tool_call_when_inactive_returns_error(self, hermes_home):
        p = OB1MemoryProvider()
        out = p.handle_tool_call("ob1_recall", {"query": "x"})
        assert "not configured" in out

    def test_recall_routes_to_client(self, active):
        with patch.object(active._client, "recall", return_value={"request_id": "r1", "memories": []}) as mock:
            out = active.handle_tool_call("ob1_recall", {"query": "find me"})
        assert mock.called
        kwargs = mock.call_args.kwargs
        assert kwargs["query"] == "find me"
        assert kwargs["task_type"] == "general"
        assert active._last_request_id == "r1"
        assert json.loads(out)["request_id"] == "r1"

    def test_recall_requires_query(self, active):
        out = active.handle_tool_call("ob1_recall", {})
        assert "query is required" in out

    def test_writeback_maps_memory_type_to_category(self, active):
        with patch.object(active._client, "writeback", return_value={"memory_id": "m1"}) as mock:
            active.handle_tool_call("ob1_writeback", {
                "summary": "Avoid mocking Postgres in tests.",
                "memory_type": "lesson",
            })
        body = mock.call_args.kwargs
        assert "lessons" in body["memory_payload"]
        assert body["memory_payload"]["lessons"]

    def test_writeback_default_to_outputs(self, active):
        with patch.object(active._client, "writeback", return_value={"memory_id": "m"}) as mock:
            active.handle_tool_call("ob1_writeback", {"summary": "Some summary content."})
        body = mock.call_args.kwargs
        # default memory_type is "lesson" so it maps to lessons
        assert "lessons" in body["memory_payload"]

    def test_writeback_unknown_type_falls_back_to_outputs(self, active):
        with patch.object(active._client, "writeback", return_value={"memory_id": "m"}) as mock:
            active.handle_tool_call("ob1_writeback", {
                "summary": "Some summary.",
                "memory_type": "completely_unknown_type",
            })
        body = mock.call_args.kwargs
        assert "outputs" in body["memory_payload"]

    def test_writeback_requires_summary_or_content(self, active):
        out = active.handle_tool_call("ob1_writeback", {})
        assert "summary or content is required" in out

    def test_report_usage_uses_last_request_id_when_omitted(self, active):
        active._last_request_id = "req-cached"
        with patch.object(active._client, "report_usage", return_value={"ok": True}) as mock:
            active.handle_tool_call("ob1_report_usage", {"used": ["m1"], "ignored": ["m2"]})
        assert mock.call_args.args[0] == "req-cached"

    def test_review_memory_validates_action(self, active):
        out = active.handle_tool_call("ob1_review_memory", {"memory_id": "m", "action": "bogus"})
        assert "Invalid action" in out

    def test_review_memory_passes_through(self, active):
        with patch.object(active._client, "review_memory", return_value={"ok": True}) as mock:
            active.handle_tool_call("ob1_review_memory", {
                "memory_id": "m1", "action": "confirm", "notes": "looks good",
            })
        assert mock.call_args.args[0] == "m1"
        kwargs = mock.call_args.kwargs
        assert kwargs["action"] == "confirm"
        assert kwargs["notes"] == "looks good"


# ---------------------------------------------------------------------------
# system_prompt_block
# ---------------------------------------------------------------------------


class TestSystemPromptBlock:

    def test_empty_when_inactive(self, hermes_home):
        p = OB1MemoryProvider()
        assert p.system_prompt_block() == ""

    def test_lists_tools_and_workspace_when_active(self, configured):
        p = OB1MemoryProvider()
        with patch.object(_OB1Client, "health", return_value={}):
            p.initialize(session_id="s", hermes_home=str(configured))
        block = p.system_prompt_block()
        assert "OpenBrain" in block
        assert "ws-test" in block
        assert "ob1_recall" in block
        assert "ob1_writeback" in block
