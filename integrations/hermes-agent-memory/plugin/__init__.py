"""OB1 (OpenBrain) memory provider for Hermes Agent.

Connects Hermes agents to Nate Jones' OpenBrain governed memory system.
The backend is a Supabase Edge Function ("agent-memory-api") that exposes
the OB1 v1 memory contract: recall, writeback, review queue, recall traces,
usage reporting, inspection.

Provides:
- Auto-recall before every LLM turn (via `prefetch`)
- Auto-writeback after every turn (via `sync_turn`)
- Token / model / agent tracking via `on_turn_start` kwargs
- Six explicit tools for direct memory ops (search, store, recall_trace, ...)
- Setup-wizard support via get_config_schema / save_config

Config:
- $HERMES_HOME/ob1.json — non-secret (endpoint, workspace_id, project_id, options)
- env var OPENBRAIN_KEY — the OB1 access key (x-brain-key header)
- env var OPENBRAIN_URL — optional override for endpoint

Install:
- $HERMES_HOME/plugins/ob1/__init__.py — this file
- $HERMES_HOME/plugins/ob1/plugin.yaml — Hermes plugin metadata
- Then: hermes config set memory.provider ob1
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from agent.memory_provider import MemoryProvider
from tools.registry import tool_error

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DEFAULT_WORKSPACE_ID = "default"
_DEFAULT_PROJECT_ID: Optional[str] = None  # null in payloads when unset
_DEFAULT_MAX_RECALL_RESULTS = 10
_DEFAULT_API_TIMEOUT = 8.0
_MIN_CAPTURE_LENGTH = 10
_DEFAULT_CONFIDENCE = 0.7
# How long a queue_prefetch result is considered fresh before prefetch()
# falls back to a sync recall. Hermes turns are typically <60s.
_PREFETCH_TTL_SECONDS = 90.0

# OB1 Edge Function accepts two schema_version literals per endpoint —
# we use the generic "agent_memory" variants since this is a Hermes runtime
# (not OpenClaw). See integrations/agent-memory-api/index.ts.
_RECALL_SCHEMA_VERSION = "openbrain.agent_memory.recall.v1"
_WRITEBACK_SCHEMA_VERSION = "openbrain.agent_memory.writeback.v1"

# Trivial messages we should not write back as memory turns.
_TRIVIAL_RE = re.compile(
    r"^(ok|okay|thanks|thank you|got it|sure|yes|no|yep|nope|k|ty|thx|np)\.?$",
    re.IGNORECASE,
)

# Strip our own injected recall context before capturing the turn — otherwise
# every writeback recursively re-stores the previous prefetch.
_OB1_CONTEXT_STRIP_RE = re.compile(
    r"<ob1-context>[\s\S]*?</ob1-context>\s*", re.DOTALL
)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def _default_config() -> dict:
    return {
        "endpoint": "",
        "workspace_id": _DEFAULT_WORKSPACE_ID,
        "project_id": _DEFAULT_PROJECT_ID,
        "auto_recall": True,
        "auto_capture": True,
        "max_recall_results": _DEFAULT_MAX_RECALL_RESULTS,
        "api_timeout": _DEFAULT_API_TIMEOUT,
        "default_confidence": _DEFAULT_CONFIDENCE,
        # Default-on: an agent's own writes land as review_status="pending" by
        # default (governance); recall must include unconfirmed or the agent
        # never sees its own prior memories. Pending memories are still ranked
        # lower than confirmed ones via the Edge Function's scoring.
        "include_unconfirmed_recall": True,
        "require_review_by_default": True,
        # Multi-tenant per-agent workspace (mirrors the OpenClaw plugin's
        # workspaceMode option for symmetry across runtimes). When "shared",
        # every Hermes session uses workspace_id from config. When
        # "per-agent", workspace_id = workspace_prefix + agent_identity, so
        # each Hermes agent identity gets its own isolated OB1 workspace.
        "workspace_mode": "shared",
        "workspace_prefix": "",
    }


def _as_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "1", "yes", "y", "on"):
            return True
        if lowered in ("false", "0", "no", "n", "off"):
            return False
    return default


def _load_ob1_config(hermes_home: str) -> dict:
    """Load non-secret config from $HERMES_HOME/ob1.json with env-var overrides."""
    config = _default_config()
    config_path = Path(hermes_home) / "ob1.json"
    if config_path.exists():
        try:
            raw = json.loads(config_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                config.update({k: v for k, v in raw.items() if v is not None})
        except Exception:
            logger.debug("Failed to parse %s", config_path, exc_info=True)

    # Env vars override file config.
    env_url = os.environ.get("OPENBRAIN_URL", "").strip()
    if env_url:
        config["endpoint"] = env_url

    env_workspace = os.environ.get("OPENBRAIN_WORKSPACE_ID", "").strip()
    if env_workspace:
        config["workspace_id"] = env_workspace

    env_project = os.environ.get("OPENBRAIN_PROJECT_ID", "").strip()
    if env_project:
        config["project_id"] = env_project

    env_mode = os.environ.get("OPENBRAIN_WORKSPACE_MODE", "").strip()
    if env_mode:
        config["workspace_mode"] = env_mode

    env_prefix = os.environ.get("OPENBRAIN_WORKSPACE_PREFIX", "").strip()
    if env_prefix:
        config["workspace_prefix"] = env_prefix

    config["endpoint"] = str(config.get("endpoint") or "").rstrip("/")
    config["workspace_id"] = str(config.get("workspace_id") or _DEFAULT_WORKSPACE_ID)
    project_id = config.get("project_id")
    config["project_id"] = str(project_id) if project_id else None
    config["auto_recall"] = _as_bool(config.get("auto_recall"), True)
    config["auto_capture"] = _as_bool(config.get("auto_capture"), True)
    config["include_unconfirmed_recall"] = _as_bool(config.get("include_unconfirmed_recall"), True)
    config["require_review_by_default"] = _as_bool(config.get("require_review_by_default"), True)
    mode = str(config.get("workspace_mode") or "shared").strip().lower()
    config["workspace_mode"] = mode if mode in ("shared", "per-agent") else "shared"
    config["workspace_prefix"] = str(config.get("workspace_prefix") or "")

    try:
        config["max_recall_results"] = max(1, min(50, int(config.get("max_recall_results", _DEFAULT_MAX_RECALL_RESULTS))))
    except Exception:
        config["max_recall_results"] = _DEFAULT_MAX_RECALL_RESULTS

    try:
        config["api_timeout"] = max(1.0, min(30.0, float(config.get("api_timeout", _DEFAULT_API_TIMEOUT))))
    except Exception:
        config["api_timeout"] = _DEFAULT_API_TIMEOUT

    try:
        config["default_confidence"] = max(0.0, min(1.0, float(config.get("default_confidence", _DEFAULT_CONFIDENCE))))
    except Exception:
        config["default_confidence"] = _DEFAULT_CONFIDENCE

    return config


def _resolve_workspace_id(*, mode: str, prefix: str, agent_identity: str, fallback: str) -> str:
    """Return the OB1 workspace_id to use, applying workspaceMode rules.

    "shared" (default) → fallback (the configured workspace_id).
    "per-agent" → prefix + agent_identity, unless the agent identity is empty
    or the placeholder "default", in which case fall back to the configured
    workspace so we never send an empty workspace_id.
    """
    fb = str(fallback or _DEFAULT_WORKSPACE_ID)
    if str(mode).lower() != "per-agent":
        return fb
    ident = str(agent_identity or "").strip()
    if not ident or ident == "default":
        return fb
    return f"{str(prefix or '')}{ident}"


def _save_ob1_config(values: dict, hermes_home: str) -> None:
    """Persist non-secret config to $HERMES_HOME/ob1.json (merges with existing)."""
    config_path = Path(hermes_home) / "ob1.json"
    existing: dict = {}
    if config_path.exists():
        try:
            raw = json.loads(config_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                existing = raw
        except Exception:
            existing = {}
    existing.update(values)
    config_path.write_text(json.dumps(existing, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _clean_text_for_capture(text: str) -> str:
    """Strip our own ob1-context wrapper before capturing the turn."""
    return _OB1_CONTEXT_STRIP_RE.sub("", text or "").strip()


def _is_trivial_message(text: str) -> bool:
    return bool(_TRIVIAL_RE.match((text or "").strip()))


# Heuristic patterns for structured-finding extraction at session end /
# pre-compress. Conservative: under-extract is better than over-extract since
# governance keeps everything as evidence-only by default until reviewed.
_DECISION_PATTERNS = (
    re.compile(r"\b(decided|let'?s use|going with|we'?ll go with|chose|picked)\b", re.IGNORECASE),
    re.compile(r"\b(decision|conclusion):\s", re.IGNORECASE),
)
_LESSON_PATTERNS = (
    re.compile(r"\b(lesson learned|next time|going forward|takeaway|note to self|gotcha)\b", re.IGNORECASE),
    re.compile(r"\b(don'?t|do not|never|avoid)\s+\w+\s+\w+", re.IGNORECASE),
)
_CONSTRAINT_PATTERNS = (
    re.compile(r"\b(must not|cannot|can'?t|limited to|capped at|max(imum)? \d|min(imum)? \d)\b", re.IGNORECASE),
    re.compile(r"\b(constraint|requirement):\s", re.IGNORECASE),
)
_NEXT_STEP_PATTERNS = (
    re.compile(r"\b(TODO|FIXME|next step|follow up|action item)\b", re.IGNORECASE),
    re.compile(r"\b(I'?ll|we'?ll|need to|should)\s+(start|finish|fix|add|remove|update|review|check|build|write|test)\b", re.IGNORECASE),
)
_QUESTION_PATTERNS = (
    re.compile(r"\b(unclear|not sure|unknown|to be determined|TBD|undecided)\b", re.IGNORECASE),
    re.compile(r"\?\s*$"),  # ends with a question mark
)
_FAILURE_PATTERNS = (
    re.compile(r"\b(failed|error|exception|broke|crashed|didn'?t work)\b", re.IGNORECASE),
    re.compile(r"\b(workaround|hack|temporary fix)\b", re.IGNORECASE),
)


def _extract_findings(messages: List[Dict[str, Any]], *, per_category_limit: int = 5) -> Dict[str, List[str]]:
    """Heuristically extract structured findings from a conversation.

    Returns a dict matching OB1 memory_payload categories. Empty arrays for
    categories with no matches. Conservative: each line goes into at most
    ONE category (first match wins) so we don't double-count.

    Lines under 20 chars and over 400 chars are skipped (likely noise or
    bulk content the LLM dumped that doesn't compress to a finding).
    """
    findings: Dict[str, List[str]] = {
        "decisions": [],
        "lessons": [],
        "constraints": [],
        "next_steps": [],
        "unresolved_questions": [],
        "failures": [],
        "outputs": [],
    }
    seen: set = set()

    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        if role not in ("user", "assistant"):
            continue
        content = _clean_text_for_capture(str(msg.get("content", "")))
        if not content:
            continue

        # Split on sentence-ish boundaries; OB1 wants compact bullet-style
        # findings, not full paragraphs.
        for line in re.split(r"(?<=[.!?])\s+|\n+", content):
            line = line.strip()
            if len(line) < 20 or len(line) > 400:
                continue
            if line in seen:
                continue

            # Pattern match — first hit wins.
            matched_category: Optional[str] = None
            for category, patterns in (
                ("decisions", _DECISION_PATTERNS),
                ("constraints", _CONSTRAINT_PATTERNS),
                ("failures", _FAILURE_PATTERNS),
                ("next_steps", _NEXT_STEP_PATTERNS),
                ("lessons", _LESSON_PATTERNS),
                ("unresolved_questions", _QUESTION_PATTERNS),
            ):
                if any(p.search(line) for p in patterns):
                    matched_category = category
                    break
            if matched_category is None:
                continue

            seen.add(line)
            bucket = findings[matched_category]
            if len(bucket) < per_category_limit:
                bucket.append(line)

    # Drop empty buckets — OB1 schema accepts default empty lists, but the
    # writeback ends up cleaner with only populated categories.
    return {k: v for k, v in findings.items() if v}


def _read_hermes_active_model(hermes_home: str) -> Dict[str, str]:
    """Best-effort lookup of the currently-configured Hermes model + provider.

    Hermes' real ``on_turn_start`` (run_agent.py) doesn't pass model in kwargs,
    so we fall back to reading the active config. Returns ``{"model": ..., "provider": ...}``
    with empty strings on failure.

    Hermes' ``config.yaml`` puts the model setting under a nested ``model:``
    object: ``{default, provider, base_url, context_length, ...}``. There's
    also a top-level ``default_model`` key in some configs. We prefer the
    official cli getter, then fall back to a real YAML parse — the previous
    line-scan accidentally matched ``stt.local.model: base``.
    """
    try:
        # Prefer the official cli config getter when importable.
        from hermes_cli.config import cfg_get  # type: ignore
        model = str(cfg_get("model.default") or cfg_get("default_model") or "").strip()
        provider = str(cfg_get("model.provider") or "").strip()
        if model or provider:
            return {"model": model, "provider": provider}
    except Exception:
        pass
    cfg_path = Path(hermes_home) / "config.yaml"
    if not cfg_path.exists():
        return {"model": "", "provider": ""}
    try:
        import yaml  # PyYAML — installed wherever Hermes runs
        cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
    except Exception:
        return {"model": "", "provider": ""}

    model = ""
    provider = ""
    # Preferred: nested model.default
    nested = cfg.get("model")
    if isinstance(nested, dict):
        model = str(nested.get("default") or "").strip()
        provider = str(nested.get("provider") or "").strip()
    elif isinstance(nested, str):
        model = nested.strip()
    # Top-level fallback
    if not model:
        model = str(cfg.get("default_model") or "").strip()
    # Treat Hermes' "auto" router value as no-provider — let the prefix-derive
    # logic in the caller pick a real provider from the model name.
    if provider.lower() == "auto":
        provider = ""
    return {"model": model, "provider": provider}


def _format_relative_time(iso_ts: str) -> str:
    if not iso_ts:
        return ""
    try:
        dt = datetime.fromisoformat(str(iso_ts).replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        seconds = (now - dt).total_seconds()
        if seconds < 1800:
            return "just now"
        if seconds < 3600:
            return f"{int(seconds / 60)}m ago"
        if seconds < 86400:
            return f"{int(seconds / 3600)}h ago"
        if seconds < 604800:
            return f"{int(seconds / 86400)}d ago"
        if dt.year == now.year:
            return dt.strftime("%d %b")
        return dt.strftime("%d %b %Y")
    except Exception:
        return ""


def _format_recall_context(memories: List[Dict[str, Any]], max_results: int) -> str:
    """Wrap returned memories in <ob1-context> for system prompt injection."""
    if not memories:
        return ""
    lines: List[str] = []
    for item in memories[:max_results]:
        summary = item.get("summary") or item.get("content") or ""
        if not summary:
            continue
        bits: List[str] = []
        rel = _format_relative_time(item.get("updated_at") or item.get("created_at") or "")
        if rel:
            bits.append(f"[{rel}]")
        policy = item.get("use_policy") or {}
        if isinstance(policy, dict):
            if policy.get("can_use_as_instruction"):
                bits.append("[instruction]")
            elif policy.get("can_use_as_evidence"):
                bits.append("[evidence]")
            if policy.get("requires_user_confirmation"):
                bits.append("[needs-confirm]")
        prefix = " ".join(bits)
        lines.append(f"- {prefix} {summary}".strip())
    if not lines:
        return ""
    intro = (
        "Background context from OpenBrain long-term memory. Use silently when relevant. "
        "Memories tagged [instruction] are confirmed rules; [evidence] is supporting context only. "
        "Do not force memories into the conversation."
    )
    body = "\n".join(lines)
    return f"<ob1-context>\n{intro}\n\n{body}\n</ob1-context>"


# ---------------------------------------------------------------------------
# HTTP client (sync, urllib, no extra deps)
# ---------------------------------------------------------------------------

class _OB1Client:
    """Thin sync HTTP client for the OB1 Agent Memory API.

    Uses x-brain-key header (NOT Authorization Bearer) per the OB1 contract.
    All methods raise on transport errors; callers wrap appropriately.
    """

    def __init__(self, endpoint: str, access_key: str, timeout: float):
        self._endpoint = endpoint.rstrip("/")
        self._access_key = access_key
        self._timeout = timeout

    def _request(self, method: str, path: str, *, body: Optional[dict] = None) -> dict:
        url = f"{self._endpoint}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Content-Type": "application/json",
                "x-brain-key": self._access_key,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
            raise RuntimeError(f"OB1 {method} {path} failed: HTTP {e.code} {err_body[:300]}") from e

    # ---- API contract methods ------------------------------------------

    def health(self) -> dict:
        return self._request("GET", "/health")

    def recall(self, *, workspace_id: str, project_id: Optional[str], task_type: str,
               query: str, scope: Optional[dict] = None,
               limits: Optional[dict] = None,
               runtime: Optional[dict] = None,
               task_id: Optional[str] = None,
               flow_id: Optional[str] = None,
               model_intent: Optional[dict] = None) -> dict:
        # The Edge Function's writeback path stores memories with
        # visibility="personal" by default, and its scopeMatches() filter at
        # /recall drops personal memories unless scope.visibility="personal" is
        # passed. So we always set scope.visibility="personal" to match what
        # we wrote — without this, recall returns zero results despite
        # match_thoughts finding the thought correctly.
        body: dict = {
            "schema_version": _RECALL_SCHEMA_VERSION,
            "workspace_id": workspace_id,
            "query": query,
            "scope": scope or {
                "visibility": "personal",
                "project_only": True,
                "include_unconfirmed": False,
                "include_stale": False,
            },
            "limits": limits or {"max_items": 10, "max_tokens": 4000},
        }
        if project_id:
            body["project_id"] = project_id
        if task_type:
            body["task_type"] = task_type
        if runtime:
            body["runtime"] = runtime  # {name, version?} only — no other fields allowed
        if model_intent:
            body["model_intent"] = model_intent
        if task_id:
            body["task_id"] = task_id
        if flow_id:
            body["flow_id"] = flow_id
        return self._request("POST", "/recall", body=body)

    def writeback(self, *, workspace_id: str, project_id: Optional[str],
                  memory_payload: dict,
                  runtime: Optional[dict] = None,
                  models_used: Optional[List[dict]] = None,
                  source_refs: Optional[List[dict]] = None,
                  provenance: Optional[dict] = None,
                  task_id: Optional[str] = None,
                  flow_id: Optional[str] = None,
                  step_id: Optional[str] = None,
                  idempotency_key: Optional[str] = None) -> dict:
        body: dict = {
            "schema_version": _WRITEBACK_SCHEMA_VERSION,
            "workspace_id": workspace_id,
            "memory_payload": memory_payload,
        }
        if project_id:
            body["project_id"] = project_id
        if runtime:
            body["runtime"] = runtime  # {name, version?} only
        if models_used:
            body["models_used"] = models_used  # [{provider, model, role}]
        if source_refs:
            body["source_refs"] = source_refs
        if provenance:
            body["provenance"] = provenance  # {default_status, confidence, requires_review}
        if task_id:
            body["task_id"] = task_id
        if flow_id:
            body["flow_id"] = flow_id
        if step_id:
            body["step_id"] = step_id
        if idempotency_key:
            body["idempotency_key"] = idempotency_key
        return self._request("POST", "/writeback", body=body)

    def report_usage(self, request_id: str, *, used: List[str],
                     ignored: List[str]) -> dict:
        # API expects used_memory_ids: [] and ignored: [{memory_id, reason?}].
        body = {
            "used_memory_ids": used,
            "ignored": [{"memory_id": mid} for mid in ignored],
        }
        return self._request("POST", f"/recall/{request_id}/usage", body=body)

    def list_memories(self, *, workspace_id: str, project_id: Optional[str] = None,
                      review_status: Optional[str] = None, limit: int = 20) -> dict:
        # Encoded as POST body to avoid URL-encoding issues with workspace ids.
        body: dict = {"workspace_id": workspace_id, "limit": limit}
        if project_id:
            body["project_id"] = project_id
        if review_status:
            body["review_status"] = review_status
        return self._request("POST", "/memories/list", body=body)

    def get_review_queue(self, *, workspace_id: str, project_id: Optional[str] = None) -> dict:
        body: dict = {"workspace_id": workspace_id}
        if project_id:
            body["project_id"] = project_id
        return self._request("POST", "/memories/review", body=body)

    def review_memory(self, memory_id: str, *, action: str, notes: Optional[str] = None,
                      reviewer: str = "ob1-plugin") -> dict:
        body: dict = {"action": action, "reviewer": reviewer}
        if notes:
            body["notes"] = notes
        return self._request("PATCH", f"/memories/{memory_id}/review", body=body)

    def get_recall_trace(self, request_id: str) -> dict:
        return self._request("GET", f"/recall-traces/{request_id}")


# ---------------------------------------------------------------------------
# Tool schemas (OpenAI function-calling format)
# ---------------------------------------------------------------------------

RECALL_SCHEMA = {
    "name": "ob1_recall",
    "description": "Recall relevant memories from OpenBrain. Use BEFORE meaningful work.",
    "parameters": {
        "type": "object",
        "properties": {
            "task_type": {"type": "string", "description": "What kind of task is this (e.g. 'code-review', 'planning', 'general')."},
            "query": {"type": "string", "description": "Natural-language query about the task or topic."},
            "limit": {"type": "integer", "description": "Maximum results, 1-50.", "default": 10},
            "project_only": {"type": "boolean", "description": "Restrict to current project. Default true.", "default": True},
        },
        "required": ["query"],
    },
}

WRITEBACK_SCHEMA = {
    "name": "ob1_writeback",
    "description": "Write a memory to OpenBrain. Memory starts as evidence; review/confirmation needed before instruction-grade.",
    "parameters": {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "Short summary of the memory (1-2 sentences)."},
            "content": {"type": "string", "description": "Full content of the memory."},
            "memory_type": {"type": "string", "description": "Category: decision, lesson, constraint, output, failure, fact."},
            "confidence": {"type": "number", "description": "Self-reported confidence 0-1.", "default": 0.7},
            "metadata": {"type": "object", "description": "Optional extra metadata (token counts, cost, sources, ...)."},
        },
        "required": ["summary", "content"],
    },
}

SEARCH_SCHEMA = {
    "name": "ob1_search",
    "description": "Search OpenBrain memories explicitly (alias for recall with simpler params).",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "limit": {"type": "integer", "default": 10},
        },
        "required": ["query"],
    },
}

REPORT_USAGE_SCHEMA = {
    "name": "ob1_report_usage",
    "description": "Report which recalled memory IDs were used vs ignored. Helps audit recall quality.",
    "parameters": {
        "type": "object",
        "properties": {
            "request_id": {"type": "string", "description": "Recall request id from a prior recall call."},
            "used": {"type": "array", "items": {"type": "string"}, "description": "Memory IDs that informed the answer."},
            "ignored": {"type": "array", "items": {"type": "string"}, "description": "Memory IDs that were not useful."},
        },
        "required": ["request_id"],
    },
}

LIST_REVIEW_SCHEMA = {
    "name": "ob1_list_review_queue",
    "description": "List memories awaiting human review.",
    "parameters": {
        "type": "object",
        "properties": {},
    },
}

REVIEW_MEMORY_SCHEMA = {
    "name": "ob1_review_memory",
    "description": "Confirm, reject, or annotate a memory in the review queue.",
    "parameters": {
        "type": "object",
        "properties": {
            "memory_id": {"type": "string"},
            "action": {"type": "string", "enum": ["confirm", "reject", "edit", "evidence_only"]},
            "notes": {"type": "string"},
        },
        "required": ["memory_id", "action"],
    },
}

GET_TRACE_SCHEMA = {
    "name": "ob1_get_recall_trace",
    "description": "Fetch a recall trace by request_id to debug what memories were returned.",
    "parameters": {
        "type": "object",
        "properties": {
            "request_id": {"type": "string"},
        },
        "required": ["request_id"],
    },
}


# ---------------------------------------------------------------------------
# Provider class
# ---------------------------------------------------------------------------

class OB1MemoryProvider(MemoryProvider):
    """OpenBrain (OB1) memory provider for Hermes.

    Mirrors the supermemory provider's threading + lifecycle pattern but
    speaks the OB1 v1 governed memory contract over HTTP.
    """

    def __init__(self) -> None:
        self._config = _default_config()
        self._access_key: str = ""
        self._endpoint: str = ""
        self._workspace_id: str = _DEFAULT_WORKSPACE_ID
        self._project_id: Optional[str] = _DEFAULT_PROJECT_ID
        self._client: Optional[_OB1Client] = None
        self._session_id: str = ""
        self._turn_count: int = 0
        self._sync_thread: Optional[threading.Thread] = None
        self._prefetch_thread: Optional[threading.Thread] = None
        self._prefetch_lock = threading.Lock()
        # (query, formatted_context, request_id, timestamp)
        self._prefetch_cache: Optional[Tuple[str, str, Optional[str], float]] = None
        self._auto_recall: bool = True
        self._auto_capture: bool = True
        self._max_recall_results: int = _DEFAULT_MAX_RECALL_RESULTS
        self._api_timeout: float = _DEFAULT_API_TIMEOUT
        self._default_confidence: float = _DEFAULT_CONFIDENCE
        self._hermes_home: str = ""
        self._write_enabled: bool = True
        self._active: bool = False

        # Per-turn metadata captured from on_turn_start — written to OB1 metadata
        # in the next sync_turn for per-agent token/model tracking.
        self._last_turn_meta: Dict[str, Any] = {}

        # Latest recall request_id for usage reporting.
        self._last_request_id: Optional[str] = None

        # Identity captured in initialize() — used as runtime_name in OB1 writes.
        self._runtime_name: str = "hermes"
        self._runtime_version: str = ""
        self._agent_identity: str = "default"
        self._platform: str = "cli"

    @property
    def name(self) -> str:
        return "ob1"

    # ---- Availability / setup -----------------------------------------

    def is_available(self) -> bool:
        # Check env first (cheap), then load config to see if endpoint is set.
        if not os.environ.get("OPENBRAIN_KEY", "").strip():
            return False
        try:
            from hermes_constants import get_hermes_home
            home = str(get_hermes_home())
        except Exception:
            home = os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))
        cfg = _load_ob1_config(home)
        return bool(cfg.get("endpoint"))

    def get_config_schema(self) -> List[Dict[str, Any]]:
        return [
            {
                "key": "endpoint",
                "description": "OB1 Agent Memory API URL (e.g. http://localhost:8000/functions/v1/agent-memory-api)",
                "secret": False,
                "required": True,
            },
            {
                "key": "access_key",
                "description": "OB1 access key (sent as x-brain-key header)",
                "secret": True,
                "required": True,
                "env_var": "OPENBRAIN_KEY",
            },
            {
                "key": "workspace_id",
                "description": "Workspace ID for memory scoping",
                "secret": False,
                "required": False,
                "default": _DEFAULT_WORKSPACE_ID,
            },
            {
                "key": "project_id",
                "description": "Default project ID (optional)",
                "secret": False,
                "required": False,
            },
        ]

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        sanitized: Dict[str, Any] = {}
        for k in ("endpoint", "workspace_id", "project_id"):
            if k in values and values[k] is not None:
                sanitized[k] = str(values[k]).strip()
        # Optional booleans.
        for k in ("auto_recall", "auto_capture", "include_unconfirmed_recall", "require_review_by_default"):
            if k in values:
                sanitized[k] = _as_bool(values[k], True)
        if "max_recall_results" in values:
            try:
                sanitized["max_recall_results"] = int(values["max_recall_results"])
            except Exception:
                pass
        if "default_confidence" in values:
            try:
                sanitized["default_confidence"] = float(values["default_confidence"])
            except Exception:
                pass
        if sanitized:
            _save_ob1_config(sanitized, hermes_home)

    # ---- Lifecycle ----------------------------------------------------

    def initialize(self, session_id: str, **kwargs) -> None:
        try:
            from hermes_constants import get_hermes_home
            self._hermes_home = kwargs.get("hermes_home") or str(get_hermes_home())
        except Exception:
            self._hermes_home = kwargs.get("hermes_home") or os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))

        self._session_id = session_id
        self._turn_count = 0
        self._last_turn_meta = {}
        self._last_request_id = None

        self._config = _load_ob1_config(self._hermes_home)
        self._access_key = os.environ.get("OPENBRAIN_KEY", "").strip()
        self._endpoint = self._config["endpoint"]
        self._project_id = self._config["project_id"]
        self._auto_recall = self._config["auto_recall"]
        self._auto_capture = self._config["auto_capture"]
        self._max_recall_results = self._config["max_recall_results"]
        self._api_timeout = self._config["api_timeout"]
        self._default_confidence = self._config["default_confidence"]

        # Identity / runtime metadata for OB1 writes. Capture agent_identity
        # BEFORE workspace resolution so per-agent mode can use it.
        self._agent_identity = kwargs.get("agent_identity", "default")
        self._platform = kwargs.get("platform", "cli")

        # Workspace resolution (per-agent vs shared). Mirrors the OpenClaw
        # plugin's workspaceMode option so both runtimes have symmetric
        # multi-tenant semantics. In per-agent mode an empty/default agent
        # identity falls back to the configured workspace so we never send
        # an empty workspace_id.
        self._workspace_id = _resolve_workspace_id(
            mode=self._config["workspace_mode"],
            prefix=self._config["workspace_prefix"],
            agent_identity=self._agent_identity,
            fallback=self._config["workspace_id"],
        )
        try:
            from hermes_constants import VERSION as _hermes_version
            self._runtime_version = str(_hermes_version)
        except Exception:
            self._runtime_version = ""

        # Skip writes for non-primary contexts (cron heartbeats, flush passes,
        # subagent runs would corrupt the parent's memory record).
        agent_context = kwargs.get("agent_context", "")
        self._write_enabled = agent_context not in ("cron", "flush", "subagent")

        self._active = bool(self._access_key and self._endpoint)
        self._client = None
        if self._active:
            try:
                self._client = _OB1Client(
                    endpoint=self._endpoint,
                    access_key=self._access_key,
                    timeout=self._api_timeout,
                )
                # Optional health probe — log warning if unreachable but keep
                # provider active so the agent can still operate.
                try:
                    self._client.health()
                except Exception:
                    logger.warning("OB1 endpoint health check failed (continuing)", exc_info=True)
            except Exception:
                logger.warning("OB1 client initialization failed", exc_info=True)
                self._active = False
                self._client = None

    def shutdown(self) -> None:
        for attr in ("_sync_thread", "_prefetch_thread"):
            t = getattr(self, attr, None)
            if t and t.is_alive():
                t.join(timeout=5.0)
            setattr(self, attr, None)
        with self._prefetch_lock:
            self._prefetch_cache = None

    # ---- Per-turn hooks ----------------------------------------------

    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
        """Capture per-turn runtime metadata for the next writeback.

        The MemoryProvider ABC documents `remaining_tokens, model, platform,
        tool_count` as kwargs — but Hermes' ``run_agent.py`` actually calls
        ``on_turn_start(turn_number, message)`` with no extras. So we cache
        what we get and fall back to reading Hermes' configured model from
        config.yaml when sync_turn needs it.
        """
        self._turn_count = max(turn_number, 0)
        self._last_turn_meta = {
            "turn_number": turn_number,
            "remaining_tokens": kwargs.get("remaining_tokens"),
            "model": kwargs.get("model"),
            "platform": kwargs.get("platform") or self._platform,
            "tool_count": kwargs.get("tool_count"),
        }
        platform = kwargs.get("platform")
        if platform:
            self._platform = platform

    def _resolve_model_provider(self) -> Dict[str, str]:
        """Return {model, provider} from cached on_turn_start kwargs OR from
        Hermes' active config if the kwargs were empty (the common case)."""
        model = self._last_turn_meta.get("model") or ""
        provider = ""
        if not model and self._hermes_home:
            fallback = _read_hermes_active_model(self._hermes_home)
            model = fallback.get("model", "")
            provider = fallback.get("provider", "")
        # If we got "anthropic/claude-opus-4.6" or similar, infer provider from
        # the prefix when we don't have it explicitly.
        if model and not provider:
            if "/" in model:
                head = model.split("/", 1)[0].lower()
                # Common OpenRouter-style prefixes — promote into provider field.
                if head in ("openrouter", "anthropic", "openai", "google", "meta", "mistralai", "stepfun", "z-ai", "minimax", "xiaomi", "deepseek"):
                    provider = "openrouter" if head == "openrouter" else head
        return {"model": str(model), "provider": str(provider)}

    def system_prompt_block(self) -> str:
        if not self._active:
            return ""
        return (
            "# OpenBrain (OB1) Memory\n"
            "Active. Workspace: "
            f"{self._workspace_id}"
            + (f", project: {self._project_id}" if self._project_id else "")
            + ".\n"
            "Tools: ob1_recall, ob1_writeback, ob1_search, ob1_report_usage, "
            "ob1_list_review_queue, ob1_review_memory, ob1_get_recall_trace.\n"
            "Memory discipline: recall before meaningful work; writeback compact, "
            "provenance-labeled summaries after. Treat memories tagged [instruction] "
            "as binding rules; [evidence]-tagged as supporting context only."
        )

    # ---- Auto-recall / auto-capture ----------------------------------

    def _do_recall(self, query: str, *, session_id: str = "") -> Tuple[str, Optional[str]]:
        """Execute the recall HTTP call and return (formatted_context, request_id)."""
        if not self._active or not self._client:
            return "", None
        q = (query or "").strip()
        if not q:
            return "", None
        try:
            # visibility="personal" matches the Edge Function writeback default —
            # without it, recall drops every personal-visibility memory we wrote.
            scope: Dict[str, Any] = {
                "visibility": "personal",
                "project_only": bool(self._project_id),
                "include_unconfirmed": self._config["include_unconfirmed_recall"],
                "include_stale": False,
            }
            limits = {"max_items": self._max_recall_results, "max_tokens": 4000}
            runtime = {
                "name": self._runtime_name,
                "version": self._runtime_version or None,
            }
            model_intent: Dict[str, Any] = {}
            last_model = self._last_turn_meta.get("model")
            if last_model:
                model_intent["model"] = last_model
            response = self._client.recall(
                workspace_id=self._workspace_id,
                project_id=self._project_id,
                task_type="general",
                query=q[:2000],
                scope=scope,
                limits=limits,
                runtime=runtime,
                model_intent=model_intent or None,
                task_id=session_id or self._session_id or None,
                flow_id=self._agent_identity,
            )
        except Exception:
            logger.debug("OB1 recall failed", exc_info=True)
            return "", None

        request_id = response.get("request_id")
        memories = response.get("memories") or []
        return _format_recall_context(memories, self._max_recall_results), request_id

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if not self._active or not self._auto_recall:
            return ""
        q = (query or "").strip()
        if not q:
            return ""

        # Consume cached recall from queue_prefetch when fresh. Hermes' contract
        # explicitly says queue_prefetch's result is "consumed by prefetch() on
        # the next turn" regardless of new query — so we use the cache as long
        # as TTL hasn't elapsed.
        cached = self._consume_prefetch_cache()
        if cached is not None:
            context, request_id = cached
            if request_id:
                self._last_request_id = request_id
            return context

        context, request_id = self._do_recall(q, session_id=session_id)
        if request_id:
            self._last_request_id = request_id
        return context

    def _consume_prefetch_cache(self) -> Optional[Tuple[str, Optional[str]]]:
        with self._prefetch_lock:
            entry = self._prefetch_cache
            self._prefetch_cache = None
        if entry is None:
            return None
        _query, context, request_id, ts = entry
        if (time.monotonic() - ts) > _PREFETCH_TTL_SECONDS:
            return None
        return context, request_id

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        """Fire a background recall whose result is consumed by the next prefetch().

        Hermes calls this after each completed turn with the just-completed user
        message. The result is cached and returned by the next prefetch() call
        as long as TTL hasn't elapsed — saves a synchronous round-trip per turn.
        """
        if not self._active or not self._auto_recall or not self._client:
            return
        q = (query or "").strip()
        if not q:
            return

        # Don't stack up prefetches — if one is already running, let it finish
        # before queuing another (rare; Hermes turns are usually >>HTTP latency).
        existing = self._prefetch_thread
        if existing and existing.is_alive():
            return

        def _run() -> None:
            try:
                context, request_id = self._do_recall(q, session_id=session_id)
                if not context:
                    return
                with self._prefetch_lock:
                    self._prefetch_cache = (q, context, request_id, time.monotonic())
            except Exception:
                logger.debug("OB1 queue_prefetch failed", exc_info=True)

        self._prefetch_thread = threading.Thread(
            target=_run, daemon=True, name="ob1-prefetch"
        )
        self._prefetch_thread.start()

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "") -> None:
        if not self._active or not self._auto_capture or not self._write_enabled or not self._client:
            return

        clean_user = _clean_text_for_capture(user_content)
        clean_assistant = _clean_text_for_capture(assistant_content)
        if not clean_user or not clean_assistant:
            return
        if len(clean_user) < _MIN_CAPTURE_LENGTH or len(clean_assistant) < _MIN_CAPTURE_LENGTH:
            return
        if _is_trivial_message(clean_user):
            return

        # OB1 memory_payload is structured: arrays per category, not free text.
        # For an auto-captured turn, we put the summary in `outputs` (a
        # statement of what the agent did/produced this turn).
        summary = (clean_user[:160].rstrip() + "…") if len(clean_user) > 160 else clean_user
        output_line = f"Turn summary — user: {summary} | assistant: {clean_assistant[:300]}"
        memory_payload: Dict[str, Any] = {
            "outputs": [output_line],
        }

        # models_used carries the LLM provenance: provider/model/role. The
        # resolver pulls from on_turn_start kwargs first, then falls back to
        # Hermes' configured default model — covers the common case where
        # Hermes doesn't pass model in the kwargs.
        models_used: List[Dict[str, Any]] = []
        mp = self._resolve_model_provider()
        if mp.get("model"):
            models_used.append({
                "provider": mp.get("provider") or "unknown",
                "model": mp["model"],
                "role": "primary",
            })

        runtime = {
            "name": self._runtime_name,
            "version": self._runtime_version or None,
        }
        provenance = {
            "default_status": "generated",
            "confidence": self._default_confidence,
            "requires_review": self._config["require_review_by_default"],
        }

        client = self._client
        workspace_id = self._workspace_id
        project_id = self._project_id
        task_id = session_id or self._session_id or None
        flow_id = self._agent_identity

        def _run() -> None:
            try:
                client.writeback(
                    workspace_id=workspace_id,
                    project_id=project_id,
                    memory_payload=memory_payload,
                    runtime=runtime,
                    models_used=models_used or None,
                    provenance=provenance,
                    task_id=task_id,
                    flow_id=flow_id,
                )
            except Exception:
                logger.debug("OB1 sync_turn writeback failed", exc_info=True)

        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=2.0)
        self._sync_thread = threading.Thread(target=_run, daemon=True, name="ob1-sync")
        self._sync_thread.start()

    # ---- Session-end + pre-compress hooks ----------------------------

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        """Extract structured findings from the full session and write to OB1.

        Runs synchronously (not threaded) since the agent is already exiting —
        a daemon thread might be killed before completing.
        """
        if not self._active or not self._auto_capture or not self._write_enabled or not self._client:
            return
        if not messages:
            return

        findings = _extract_findings(messages, per_category_limit=10)
        if not findings:
            # Even with no structured findings, write a single output line
            # noting the session occurred. Skip if conversation was trivial.
            user_count = sum(1 for m in messages if isinstance(m, dict) and m.get("role") == "user")
            if user_count < 2:
                return
            findings = {"outputs": [
                f"Session completed with {user_count} user messages; no structured "
                "findings extracted by heuristics."
            ]}

        mp = self._resolve_model_provider()
        models_used: List[Dict[str, Any]] = []
        if mp.get("model"):
            models_used.append({
                "provider": mp.get("provider") or "unknown",
                "model": mp["model"],
                "role": "primary",
            })
        provenance = {
            "default_status": "generated",
            "confidence": self._default_confidence,
            "requires_review": self._config["require_review_by_default"],
        }

        try:
            self._client.writeback(
                workspace_id=self._workspace_id,
                project_id=self._project_id,
                memory_payload=findings,
                runtime={"name": self._runtime_name, "version": self._runtime_version or None},
                models_used=models_used or None,
                provenance=provenance,
                task_id=self._session_id or None,
                flow_id=self._agent_identity,
            )
        except Exception:
            logger.debug("OB1 on_session_end writeback failed", exc_info=True)

    def on_pre_compress(self, messages: List[Dict[str, Any]]) -> str:
        """Extract findings from messages about to be compressed and return
        a summary string for the compression prompt.

        Side-effect: also writeback the extracted findings to OB1 as a
        compression-extracted memory, since the original messages will be
        discarded after compression.
        """
        if not self._active or not self._client or not messages:
            return ""

        findings = _extract_findings(messages, per_category_limit=5)
        if not findings:
            return ""

        # Background writeback — we don't want to block compression.
        if self._auto_capture and self._write_enabled:
            mp = self._resolve_model_provider()
            models_used: List[Dict[str, Any]] = []
            if mp.get("model"):
                models_used.append({
                    "provider": mp.get("provider") or "unknown",
                    "model": mp["model"],
                    "role": "primary",
                })
            provenance = {
                "default_status": "generated",
                "confidence": self._default_confidence,
                "requires_review": self._config["require_review_by_default"],
            }

            client = self._client
            workspace_id = self._workspace_id
            project_id = self._project_id
            task_id = self._session_id or None
            flow_id = self._agent_identity
            runtime = {"name": self._runtime_name, "version": self._runtime_version or None}

            def _run() -> None:
                try:
                    client.writeback(
                        workspace_id=workspace_id,
                        project_id=project_id,
                        memory_payload=findings,
                        runtime=runtime,
                        models_used=models_used or None,
                        provenance=provenance,
                        task_id=task_id,
                        flow_id=flow_id,
                        idempotency_key=f"precompress:{task_id or 'no-task'}:{len(messages)}",
                    )
                except Exception:
                    logger.debug("OB1 on_pre_compress writeback failed", exc_info=True)

            if self._sync_thread and self._sync_thread.is_alive():
                self._sync_thread.join(timeout=2.0)
            self._sync_thread = threading.Thread(target=_run, daemon=True, name="ob1-precompress")
            self._sync_thread.start()

        # Build a concise summary for the compression prompt. Compression
        # itself is text-based, so we hand back a structured-but-readable
        # block the compressor can fold into its own summary.
        parts: List[str] = []
        for category, items in findings.items():
            if not items:
                continue
            label = category.replace("_", " ").title()
            joined = "\n".join(f"  - {it}" for it in items[:3])
            parts.append(f"{label}:\n{joined}")
        if not parts:
            return ""
        return (
            "Pre-compression findings extracted by OB1 memory provider "
            "(preserve in summary):\n" + "\n".join(parts)
        )

    # ---- Tools --------------------------------------------------------

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return [
            RECALL_SCHEMA,
            WRITEBACK_SCHEMA,
            SEARCH_SCHEMA,
            REPORT_USAGE_SCHEMA,
            LIST_REVIEW_SCHEMA,
            REVIEW_MEMORY_SCHEMA,
            GET_TRACE_SCHEMA,
        ]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        if not self._active or not self._client:
            return tool_error("OpenBrain (OB1) memory provider is not configured")
        try:
            if tool_name == "ob1_recall":
                return self._tool_recall(args)
            if tool_name == "ob1_writeback":
                return self._tool_writeback(args)
            if tool_name == "ob1_search":
                return self._tool_search(args)
            if tool_name == "ob1_report_usage":
                return self._tool_report_usage(args)
            if tool_name == "ob1_list_review_queue":
                return self._tool_list_review_queue(args)
            if tool_name == "ob1_review_memory":
                return self._tool_review_memory(args)
            if tool_name == "ob1_get_recall_trace":
                return self._tool_get_recall_trace(args)
        except Exception as exc:
            return tool_error(f"OB1 tool '{tool_name}' failed: {exc}")
        return tool_error(f"Unknown tool: {tool_name}")

    # Per-tool implementations ------------------------------------------

    def _tool_recall(self, args: Dict[str, Any]) -> str:
        query = str(args.get("query") or "").strip()
        if not query:
            return tool_error("query is required")
        try:
            limit = max(1, min(50, int(args.get("limit", self._max_recall_results) or self._max_recall_results)))
        except Exception:
            limit = self._max_recall_results
        scope = {
            "visibility": "personal",
            "project_only": bool(args.get("project_only", True)) and bool(self._project_id),
            "include_unconfirmed": self._config["include_unconfirmed_recall"],
            "include_stale": False,
        }
        response = self._client.recall(
            workspace_id=self._workspace_id,
            project_id=self._project_id,
            task_type=str(args.get("task_type") or "general"),
            query=query,
            scope=scope,
            limits={"max_items": limit, "max_tokens": 4000},
            runtime={"name": self._runtime_name, "version": self._runtime_version or None},
            task_id=self._session_id or None,
            flow_id=self._agent_identity,
        )
        if response.get("request_id"):
            self._last_request_id = response["request_id"]
        return json.dumps(response)

    def _tool_search(self, args: Dict[str, Any]) -> str:
        # Alias to recall with simpler params + task_type=search.
        merged = {"task_type": "search", **args}
        return self._tool_recall(merged)

    def _tool_writeback(self, args: Dict[str, Any]) -> str:
        # Tool-call writeback maps user-friendly args (summary/content/memory_type)
        # onto the structured OB1 memory_payload: pick the right category array
        # based on memory_type, falling back to "outputs" for free-form content.
        summary = str(args.get("summary") or "").strip()
        content = str(args.get("content") or "").strip()
        if not summary and not content:
            return tool_error("summary or content is required")
        try:
            confidence = max(0.0, min(1.0, float(args.get("confidence", self._default_confidence))))
        except Exception:
            confidence = self._default_confidence

        line = summary if summary else content
        if summary and content:
            line = f"{summary} — {content[:600]}"

        memory_type = str(args.get("memory_type") or "lesson").lower()
        category_map = {
            "decision": "decisions",
            "decisions": "decisions",
            "output": "outputs",
            "outputs": "outputs",
            "lesson": "lessons",
            "lessons": "lessons",
            "constraint": "constraints",
            "constraints": "constraints",
            "question": "unresolved_questions",
            "unresolved_question": "unresolved_questions",
            "next_step": "next_steps",
            "next_steps": "next_steps",
            "failure": "failures",
            "failures": "failures",
        }
        category = category_map.get(memory_type, "outputs")
        memory_payload: Dict[str, Any] = {category: [line]}

        models_used: List[Dict[str, Any]] = []
        mp = self._resolve_model_provider()
        if mp.get("model"):
            models_used.append({
                "provider": mp.get("provider") or "unknown",
                "model": mp["model"],
                "role": "primary",
            })

        provenance = {
            "default_status": "generated",
            "confidence": confidence,
            "requires_review": self._config["require_review_by_default"],
        }

        response = self._client.writeback(
            workspace_id=self._workspace_id,
            project_id=self._project_id,
            memory_payload=memory_payload,
            runtime={"name": self._runtime_name, "version": self._runtime_version or None},
            models_used=models_used or None,
            provenance=provenance,
            task_id=self._session_id or None,
            flow_id=self._agent_identity,
        )
        return json.dumps(response)

    def _tool_report_usage(self, args: Dict[str, Any]) -> str:
        request_id = str(args.get("request_id") or self._last_request_id or "").strip()
        if not request_id:
            return tool_error("request_id is required (or call ob1_recall first)")
        used = args.get("used") or []
        ignored = args.get("ignored") or []
        if not isinstance(used, list) or not isinstance(ignored, list):
            return tool_error("'used' and 'ignored' must be lists of memory IDs")
        response = self._client.report_usage(
            request_id, used=[str(x) for x in used], ignored=[str(x) for x in ignored]
        )
        return json.dumps(response)

    def _tool_list_review_queue(self, args: Dict[str, Any]) -> str:
        response = self._client.get_review_queue(
            workspace_id=self._workspace_id, project_id=self._project_id
        )
        return json.dumps(response)

    def _tool_review_memory(self, args: Dict[str, Any]) -> str:
        memory_id = str(args.get("memory_id") or "").strip()
        action = str(args.get("action") or "").strip()
        if not memory_id or not action:
            return tool_error("memory_id and action are required")
        if action not in ("confirm", "reject", "edit", "evidence_only"):
            return tool_error(f"Invalid action: {action}")
        response = self._client.review_memory(
            memory_id, action=action, notes=args.get("notes"), reviewer=f"hermes:{self._agent_identity}"
        )
        return json.dumps(response)

    def _tool_get_recall_trace(self, args: Dict[str, Any]) -> str:
        request_id = str(args.get("request_id") or self._last_request_id or "").strip()
        if not request_id:
            return tool_error("request_id is required")
        response = self._client.get_recall_trace(request_id)
        return json.dumps(response)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register(ctx) -> None:
    ctx.register_memory_provider(OB1MemoryProvider())
