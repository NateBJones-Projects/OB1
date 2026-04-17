#!/usr/bin/env python3
"""Build resources/ob1-catalog.json from repo contents.

Scans every non-template contribution under the seven canonical category
folders, validates it against generator-time rules, rewrites intra-repo
links in README markdown, and emits a single site-ready JSON artifact.

Usage:
    python3 scripts/build_catalog.py          # rebuild and write the artifact
    python3 scripts/build_catalog.py --check  # fail if the artifact is stale

The --check mode is what the OB1 PR gate runs. It exits non-zero if
regenerating would produce a file that differs from what is committed.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from typing import Any

REPO_OWNER = "NateBJones-Projects"
REPO_NAME = "OB1"
REPO_URL = f"https://github.com/{REPO_OWNER}/{REPO_NAME}"
BLOB_URL = f"{REPO_URL}/blob/main"
TREE_URL = f"{REPO_URL}/tree/main"
RAW_URL = f"https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/main"

CATEGORIES = [
    "recipes",
    "schemas",
    "dashboards",
    "integrations",
    "skills",
    "primitives",
    "extensions",
]

ROOT = pathlib.Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "resources" / "ob1-catalog.json"
SCHEMA_VERSION = "1.0.0"


class ValidationError(Exception):
    def __init__(self, where: str, message: str) -> None:
        super().__init__(f"{where}: {message}")
        self.where = where
        self.message = message


def discover_contributions() -> list[dict[str, Any]]:
    """Walk each category folder and return a record per contribution."""
    entries = []
    for cat in CATEGORIES:
        cat_dir = ROOT / cat
        if not cat_dir.is_dir():
            continue
        for d in sorted(cat_dir.iterdir()):
            if not d.is_dir() or d.name.startswith("_"):
                continue
            meta_path = d / "metadata.json"
            readme_path = d / "README.md"
            if not meta_path.exists() or not readme_path.exists():
                continue
            entries.append(
                {
                    "category": cat,
                    "slug": d.name,
                    "dir": d,
                    "meta_path": meta_path,
                    "readme_path": readme_path,
                }
            )
    return entries


_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(\s+\"[^\"]*\")?\)")
_LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)\s]+)(\s+\"[^\"]*\")?\)")
_HTML_IMG_RE = re.compile(r'(<img[^>]*?\ssrc=[\"\'])([^\"\']+)([\"\'])', re.IGNORECASE)


def _resolve_repo_path(ref_path: str, source_dir: pathlib.Path) -> pathlib.Path:
    """Resolve a relative link ref (relative to the source README) to a repo path."""
    target = (source_dir / ref_path).resolve()
    return target


def _rewrite_target(
    ref: str, source_dir: pathlib.Path, catalog_slugs: set[tuple[str, str]]
) -> tuple[str, str | None]:
    """Rewrite one link/image target.

    Returns (new_target, error) where error is a human-readable string if
    the target is a broken intra-repo link. Absolute URLs and anchor-only
    refs pass through unchanged.
    """
    if not ref:
        return ref, None
    # Anchor-only
    if ref.startswith("#"):
        return ref, None
    # mailto, tel, data, etc.
    if ":" in ref.split("/")[0] and "://" not in ref and not ref.startswith("//"):
        # e.g. mailto:foo, but also x-y-z-tag
        scheme = ref.split(":", 1)[0].lower()
        if scheme in {"mailto", "tel", "data", "javascript"}:
            return ref, None
    # Absolute URL — leave alone
    if ref.startswith("http://") or ref.startswith("https://") or ref.startswith("//"):
        return ref, None

    # Strip anchor fragment for resolution, preserve for output
    anchor = ""
    bare = ref
    if "#" in ref:
        bare, anchor = ref.split("#", 1)
        anchor = "#" + anchor
    if not bare:
        return ref, None

    target_abs = _resolve_repo_path(bare, source_dir)
    try:
        rel_to_root = target_abs.relative_to(ROOT)
    except ValueError:
        return ref, f"link {ref!r} escapes repo root"

    if not target_abs.exists():
        return ref, f"broken link {ref!r} → {rel_to_root} does not exist"

    parts = rel_to_root.parts

    # Category index folder or index README
    if (
        len(parts) == 1
        and parts[0] in CATEGORIES
        and target_abs.is_dir()
    ):
        return f"/ob1/{parts[0]}" + anchor, None
    if (
        len(parts) == 2
        and parts[0] in CATEGORIES
        and parts[1] == "README.md"
    ):
        return f"/ob1/{parts[0]}" + anchor, None

    # Contribution folder or its README
    if len(parts) >= 2 and parts[0] in CATEGORIES and not parts[1].startswith("_"):
        category, slug = parts[0], parts[1]
        is_contribution = (category, slug) in catalog_slugs
        if is_contribution:
            if len(parts) == 2 and target_abs.is_dir():
                return f"/ob1/{category}/{slug}" + anchor, None
            if len(parts) == 3 and parts[2] == "README.md":
                return f"/ob1/{category}/{slug}" + anchor, None
            # Deeper file inside a contribution folder — link to the raw file on GitHub
            return f"{BLOB_URL}/{rel_to_root.as_posix()}" + anchor, None

    # Images and other assets — send to raw GitHub so they load on the site
    if target_abs.is_file() and _is_asset(parts[-1]):
        return f"{RAW_URL}/{rel_to_root.as_posix()}" + anchor, None

    # Everything else (docs/, root markdown, etc.) — send to GitHub blob/tree
    if target_abs.is_dir():
        return f"{TREE_URL}/{rel_to_root.as_posix()}" + anchor, None
    return f"{BLOB_URL}/{rel_to_root.as_posix()}" + anchor, None


_ASSET_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".avif",
    ".ico",
    ".mp4",
    ".mov",
    ".webm",
    ".pdf",
    ".zip",
}


def _is_asset(name: str) -> bool:
    ext = pathlib.Path(name).suffix.lower()
    return ext in _ASSET_EXTS


def rewrite_readme(
    raw: str, source_dir: pathlib.Path, catalog_slugs: set[tuple[str, str]]
) -> tuple[str, list[str]]:
    """Rewrite all intra-repo links/images in a README. Returns (new_text, errors)."""
    errors: list[str] = []

    def handle_link(match: re.Match) -> str:
        text, target, title = match.group(1), match.group(2), match.group(3) or ""
        new_target, err = _rewrite_target(target, source_dir, catalog_slugs)
        if err:
            errors.append(err)
        return f"[{text}]({new_target}{title})"

    def handle_image(match: re.Match) -> str:
        alt, target, title = match.group(1), match.group(2), match.group(3) or ""
        new_target, err = _rewrite_target(target, source_dir, catalog_slugs)
        if err:
            errors.append(err)
        return f"![{alt}]({new_target}{title})"

    def handle_html_img(match: re.Match) -> str:
        prefix, target, suffix = match.group(1), match.group(2), match.group(3)
        new_target, err = _rewrite_target(target, source_dir, catalog_slugs)
        if err:
            errors.append(err)
        return f"{prefix}{new_target}{suffix}"

    result = _IMAGE_RE.sub(handle_image, raw)
    result = _LINK_RE.sub(handle_link, result)
    result = _HTML_IMG_RE.sub(handle_html_img, result)
    return result, errors


def validate_metadata(meta: dict[str, Any], category: str, slug: str) -> list[str]:
    """Generator-time validation beyond the JSON schema.

    The JSON schema already enforces shape. These rules catch semantic
    issues that the schema cannot: category mismatches, malformed
    dependency declarations, and so on.
    """
    errors: list[str] = []

    if meta.get("category") != category:
        errors.append(
            f"metadata.category={meta.get('category')!r} does not match folder category {category!r}"
        )

    requires = meta.get("requires") or {}
    ob = requires.get("open_brain")
    if ob not in {"required", "optional"}:
        errors.append(
            f"requires.open_brain must be 'required' or 'optional' (got {ob!r})"
        )

    # Non-skills contributions shouldn't declare requires_skills unless they truly do
    # (we don't block it, just don't emit structural errors here).

    # learning_order is extensions-only
    if "learning_order" in meta and category != "extensions":
        errors.append(
            "learning_order is only allowed on extensions"
        )

    return errors


def build_entry(
    record: dict[str, Any],
    meta: dict[str, Any],
    readme_body: str,
) -> dict[str, Any]:
    category = record["category"]
    slug = record["slug"]
    site_path = f"/ob1/{category}/{slug}"
    github_folder_url = f"{TREE_URL}/{category}/{slug}"
    github_readme_url = f"{BLOB_URL}/{category}/{slug}/README.md"
    requires = meta.get("requires") or {}
    return {
        "slug": slug,
        "category": category,
        "site_path": site_path,
        "name": meta.get("name"),
        "description": meta.get("description"),
        "author": meta.get("author") or {},
        "version": meta.get("version"),
        "tags": meta.get("tags") or [],
        "difficulty": meta.get("difficulty"),
        "estimated_time": meta.get("estimated_time"),
        "created": meta.get("created"),
        "updated": meta.get("updated"),
        "learning_order": meta.get("learning_order"),
        "compatibility": {
            "open_brain": requires.get("open_brain"),
        },
        "requirements": {
            "services": requires.get("services") or [],
            "tools": requires.get("tools") or [],
        },
        "dependencies": {
            "skills": meta.get("requires_skills") or [],
            "primitives": meta.get("requires_primitives") or [],
        },
        "reverse_dependencies": {
            "skills": [],
            "primitives": [],
        },
        "urls": {
            "github_folder": github_folder_url,
            "github_readme": github_readme_url,
        },
        "readme_markdown": readme_body,
    }


def build_catalog() -> dict[str, Any]:
    records = discover_contributions()
    catalog_slugs = {(r["category"], r["slug"]) for r in records}

    # Phase 1: load + metadata validation + README rewriting
    entries: list[dict[str, Any]] = []
    all_errors: list[str] = []

    for record in records:
        cat, slug = record["category"], record["slug"]
        where = f"{cat}/{slug}"
        try:
            meta = json.loads(record["meta_path"].read_text())
        except json.JSONDecodeError as e:
            all_errors.append(f"{where}/metadata.json: invalid JSON — {e}")
            continue

        meta_errors = validate_metadata(meta, cat, slug)
        for err in meta_errors:
            all_errors.append(f"{where}/metadata.json: {err}")

        raw_readme = record["readme_path"].read_text()
        readme_body, rewrite_errors = rewrite_readme(
            raw_readme, record["dir"], catalog_slugs
        )
        for err in rewrite_errors:
            all_errors.append(f"{where}/README.md: {err}")

        entry = build_entry(record, meta, readme_body)
        entries.append(entry)

    # Phase 2: dependency resolution + reverse dep graph
    by_key = {(e["category"], e["slug"]): e for e in entries}

    for entry in entries:
        where = f"{entry['category']}/{entry['slug']}"
        for dep_slug in entry["dependencies"]["skills"]:
            key = ("skills", dep_slug)
            if key not in by_key:
                all_errors.append(
                    f"{where}: requires_skills references {dep_slug!r} "
                    f"but skills/{dep_slug}/ is not a valid contribution"
                )
                continue
            by_key[key]["reverse_dependencies"]["skills"].append(
                {"category": entry["category"], "slug": entry["slug"], "name": entry["name"]}
            )
        for dep_slug in entry["dependencies"]["primitives"]:
            key = ("primitives", dep_slug)
            if key not in by_key:
                all_errors.append(
                    f"{where}: requires_primitives references {dep_slug!r} "
                    f"but primitives/{dep_slug}/ is not a valid contribution"
                )
                continue
            by_key[key]["reverse_dependencies"]["primitives"].append(
                {"category": entry["category"], "slug": entry["slug"], "name": entry["name"]}
            )

    # Phase 3: uniqueness of site_path (category+slug already unique by construction,
    # but we guard the invariant explicitly).
    seen: dict[str, str] = {}
    for entry in entries:
        existing = seen.get(entry["site_path"])
        if existing:
            all_errors.append(
                f"{entry['category']}/{entry['slug']}: duplicate site_path {entry['site_path']} "
                f"(also produced by {existing})"
            )
        else:
            seen[entry["site_path"]] = f"{entry['category']}/{entry['slug']}"

    if all_errors:
        raise ValidationError(
            "catalog",
            "validation failed:\n  - " + "\n  - ".join(all_errors),
        )

    # Stable sort: category ordering from CATEGORIES then slug
    cat_rank = {c: i for i, c in enumerate(CATEGORIES)}
    entries.sort(key=lambda e: (cat_rank[e["category"]], e["slug"]))

    # Sort reverse deps for determinism
    for e in entries:
        e["reverse_dependencies"]["skills"].sort(
            key=lambda r: (r["category"], r["slug"])
        )
        e["reverse_dependencies"]["primitives"].sort(
            key=lambda r: (r["category"], r["slug"])
        )

    # Category index
    categories_index = []
    for cat in CATEGORIES:
        cat_entries = [e for e in entries if e["category"] == cat]
        required = sum(1 for e in cat_entries if e["compatibility"]["open_brain"] == "required")
        optional = sum(1 for e in cat_entries if e["compatibility"]["open_brain"] == "optional")
        categories_index.append(
            {
                "slug": cat,
                "site_path": f"/ob1/{cat}",
                "count": len(cat_entries),
                "required_count": required,
                "optional_count": optional,
            }
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_from": {
            "repo": f"{REPO_OWNER}/{REPO_NAME}",
            "branch": "main",
        },
        "categories": categories_index,
        "entries": entries,
    }


def serialize(catalog: dict[str, Any]) -> str:
    return json.dumps(catalog, indent=2, sort_keys=False, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if the committed catalog is stale.",
    )
    args = parser.parse_args()

    try:
        catalog = build_catalog()
    except ValidationError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    new_text = serialize(catalog)

    if args.check:
        if not CATALOG_PATH.exists():
            print(f"error: {CATALOG_PATH} does not exist", file=sys.stderr)
            return 3
        existing = CATALOG_PATH.read_text()
        if existing != new_text:
            print(
                "error: committed catalog is stale. Run "
                "`python3 scripts/build_catalog.py` and commit the result.",
                file=sys.stderr,
            )
            return 4
        print(f"catalog is up to date ({len(catalog['entries'])} entries)")
        return 0

    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_PATH.write_text(new_text)
    print(
        f"wrote {CATALOG_PATH.relative_to(ROOT)} "
        f"({len(catalog['entries'])} entries, {len(new_text):,} bytes)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
