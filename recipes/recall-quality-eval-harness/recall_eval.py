#!/usr/bin/env python3
"""Small recall quality harness for an OB1-shaped `match_thoughts` function."""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


def require_database_url() -> str:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    return database_url


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(format(float(v), ".12g") for v in values) + "]"


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil((pct / 100) * len(ordered)) - 1))
    return ordered[index]


def run_psql_json(sql: str, database_url: str) -> Any:
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as sql_file:
        sql_file.write(sql)
        sql_path = sql_file.name
    try:
        proc = subprocess.run(
            ["psql", database_url, "-v", "ON_ERROR_STOP=1", "-tA", "-f", sql_path],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    finally:
        Path(sql_path).unlink(missing_ok=True)

    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "psql failed")

    output = proc.stdout.strip()
    return json.loads(output or "[]")


def run_query(query: dict[str, Any], match_count: int, threshold: float, database_url: str) -> dict[str, Any]:
    embedding = vector_literal(query["query_embedding"])
    filter_json = json.dumps(query.get("filter") or {}, separators=(",", ":"))
    sql = f"""
with rows as (
  select
    row_number() over () as rank,
    id::text as id,
    content,
    metadata,
    similarity
  from public.match_thoughts(
    {sql_literal(embedding)}::vector,
    {threshold},
    {match_count},
    {sql_literal(filter_json)}::jsonb
  )
)
select coalesce(json_agg(json_build_object(
  'rank', rank,
  'id', id,
  'content', content,
  'metadata', metadata,
  'similarity', similarity
)), '[]'::json)
from rows;
"""
    start = time.perf_counter()
    results = run_psql_json(sql, database_url)
    latency_ms = round((time.perf_counter() - start) * 1000, 3)
    return {
        "name": query["name"],
        "latency_ms": latency_ms,
        "expected_ids": query.get("expected_ids", []),
        "results": results,
    }


def load_queries(path: Path) -> list[dict[str, Any]]:
    queries = json.loads(path.read_text())
    if not isinstance(queries, list):
        raise SystemExit("queries file must contain a JSON array")
    for item in queries:
        if "name" not in item or "query_embedding" not in item:
            raise SystemExit("each query must include name and query_embedding")
    return queries


def capture(args: argparse.Namespace) -> None:
    database_url = require_database_url()
    queries = load_queries(Path(args.queries))
    rows = [run_query(query, args.match_count, args.threshold, database_url) for query in queries]
    latencies = [row["latency_ms"] for row in rows]
    payload = {
        "mode": "baseline",
        "match_count": args.match_count,
        "threshold": args.threshold,
        "query_count": len(rows),
        "latency_ms": {
            "p50": percentile(latencies, 50),
            "p95": percentile(latencies, 95),
            "max": max(latencies) if latencies else None,
        },
        "queries": rows,
    }
    Path(args.out).write_text(json.dumps(payload, indent=2) + "\n")


def ids_at(row: dict[str, Any], limit: int) -> list[str]:
    return [result["id"] for result in row.get("results", [])[:limit]]


def ratio(overlap: set[str], denominator: int) -> float:
    return round(len(overlap) / denominator, 6) if denominator else 1.0


def compare(args: argparse.Namespace) -> None:
    database_url = require_database_url()
    queries = load_queries(Path(args.queries))
    baseline = json.loads(Path(args.baseline).read_text())
    baseline_by_name = {row["name"]: row for row in baseline.get("queries", [])}

    current_rows = [run_query(query, args.match_count, args.threshold, database_url) for query in queries]
    comparisons = []
    for current in current_rows:
        old = baseline_by_name.get(current["name"])
        if not old:
            raise SystemExit(f"missing baseline row for query {current['name']}")

        old_10 = ids_at(old, 10)
        old_50 = ids_at(old, 50)
        new_10 = ids_at(current, 10)
        new_50 = ids_at(current, 50)
        expected_ids = set(current.get("expected_ids") or old.get("expected_ids") or [])
        comparisons.append({
            "name": current["name"],
            "latency_ms": current["latency_ms"],
            "recall_at_10": ratio(set(old_10).intersection(new_10), len(old_10)),
            "recall_at_50": ratio(set(old_50).intersection(new_50), len(old_50)),
            "old_top10_contained_in_new_top50": set(old_10).issubset(set(new_50)),
            "expected_ids_present_at_10": sorted(expected_ids.intersection(new_10)),
            "expected_ids_present_at_50": sorted(expected_ids.intersection(new_50)),
            "missing_expected_ids_at_50": sorted(expected_ids.difference(new_50)),
            "old_top10_missing_from_new_top50": sorted(set(old_10).difference(new_50)),
        })

    latencies = [row["latency_ms"] for row in current_rows]
    payload = {
        "mode": "comparison",
        "match_count": args.match_count,
        "threshold": args.threshold,
        "query_count": len(current_rows),
        "summary": {
            "all_old_top10_contained_in_new_top50": all(
                row["old_top10_contained_in_new_top50"] for row in comparisons
            ),
            "min_recall_at_10": min((row["recall_at_10"] for row in comparisons), default=None),
            "min_recall_at_50": min((row["recall_at_50"] for row in comparisons), default=None),
            "latency_ms": {
                "p50": percentile(latencies, 50),
                "p95": percentile(latencies, 95),
                "max": max(latencies) if latencies else None,
            },
        },
        "queries": comparisons,
    }
    Path(args.out).write_text(json.dumps(payload, indent=2) + "\n")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    capture_parser = subparsers.add_parser("capture")
    capture_parser.add_argument("--queries", required=True)
    capture_parser.add_argument("--out", required=True)
    capture_parser.add_argument("--match-count", type=int, default=50)
    capture_parser.add_argument("--threshold", type=float, default=0.0)
    capture_parser.set_defaults(func=capture)

    compare_parser = subparsers.add_parser("compare")
    compare_parser.add_argument("--queries", required=True)
    compare_parser.add_argument("--baseline", required=True)
    compare_parser.add_argument("--out", required=True)
    compare_parser.add_argument("--match-count", type=int, default=50)
    compare_parser.add_argument("--threshold", type=float, default=0.0)
    compare_parser.set_defaults(func=compare)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
