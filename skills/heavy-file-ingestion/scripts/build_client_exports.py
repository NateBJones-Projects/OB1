#!/usr/bin/env python3
from __future__ import annotations

import shutil
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]
RESOURCES_DIR = REPO_ROOT / "resources"
VARIANTS_DIR = ROOT / "variants"


def reset_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def copy_tree(src: Path, dst: Path) -> None:
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        target = dst / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)


def build_zip_from_dir(source_dir: Path, archive_path: Path) -> None:
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(source_dir.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(source_dir.parent))


def build_exports() -> list[Path]:
    build_root = ROOT / ".build-exports"
    reset_dir(build_root)
    RESOURCES_DIR.mkdir(parents=True, exist_ok=True)

    created: list[Path] = []

    code_bundle = build_root / "heavy-file-ingestion-claude-code"
    copy_tree(VARIANTS_DIR / "claude-code", code_bundle)
    (code_bundle / "scripts").mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "scripts" / "convert_heavy_file.py", code_bundle / "scripts" / "convert_heavy_file.py")
    copy_tree(ROOT / "references", code_bundle / "references")
    claude_code_zip = RESOURCES_DIR / "heavy-file-ingestion-claude-code.zip"
    build_zip_from_dir(code_bundle, claude_code_zip)
    created.append(claude_code_zip)

    codex_bundle = build_root / "heavy-file-ingestion-codex"
    copy_tree(VARIANTS_DIR / "codex", codex_bundle)
    (codex_bundle / "scripts").mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "scripts" / "convert_heavy_file.py", codex_bundle / "scripts" / "convert_heavy_file.py")
    copy_tree(ROOT / "references", codex_bundle / "references")
    codex_zip = RESOURCES_DIR / "heavy-file-ingestion-codex.zip"
    build_zip_from_dir(codex_bundle, codex_zip)
    created.append(codex_zip)

    desktop_bundle = build_root / "heavy-file-ingestion-claude-desktop"
    copy_tree(VARIANTS_DIR / "claude-desktop", desktop_bundle)
    desktop_skill = RESOURCES_DIR / "heavy-file-ingestion-claude-desktop.skill"
    build_zip_from_dir(desktop_bundle, desktop_skill)
    created.append(desktop_skill)

    return created


def main() -> int:
    created = build_exports()
    for path in created:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
