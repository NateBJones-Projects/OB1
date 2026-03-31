#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import importlib
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path


MARKITDOWN_SPEC = "markitdown[pdf,docx,pptx,xlsx]"
PREVIEW_LINE_LIMIT = 12
PREVIEW_CHAR_LIMIT = 160


@dataclass
class Artifact:
    path: str
    kind: str
    description: str


@dataclass
class ConversionResult:
    source: Path
    output_dir: Path
    converter: str = ""
    artifacts: list[Artifact] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    quality_flags: list[str] = field(default_factory=list)
    stats: dict[str, object] = field(default_factory=dict)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert heavyweight files into markdown, CSV, and an index."
    )
    parser.add_argument("source", type=Path, help="Path to the source file")
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Directory for extracted outputs. Defaults to <source>.ob1/",
    )
    parser.add_argument(
        "--prefer",
        choices=["auto", "native", "markitdown"],
        default="auto",
        help="Preferred converter strategy for supported formats",
    )
    return parser.parse_args()


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", value.strip().lower()).strip("-")
    return cleaned or "sheet"


def require_module(module_name: str, package_name: str):
    try:
        return importlib.import_module(module_name)
    except ImportError as exc:
        raise RuntimeError(
            f"Missing dependency '{package_name}'. "
            f"Install it with `uv run --with {package_name} ...` or `pip install {package_name}`."
        ) from exc


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def relpath(path: Path, base: Path) -> str:
    try:
        return str(path.relative_to(base))
    except ValueError:
        return str(path)


def human_size(num_bytes: int) -> str:
    size = float(num_bytes)
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024 or unit == "GB":
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{num_bytes} B"


def clean_preview_line(line: str) -> str:
    line = re.sub(r"\s+", " ", line).strip()
    if len(line) > PREVIEW_CHAR_LIMIT:
        return f"{line[: PREVIEW_CHAR_LIMIT - 1]}…"
    return line


def gather_preview_lines(path: Path) -> list[str]:
    if not path.exists() or not path.is_file():
        return []
    if path.suffix.lower() not in {".md", ".txt", ".csv", ".tsv"}:
        return []

    previews: list[str] = []
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = clean_preview_line(raw_line)
        if not line:
            continue
        previews.append(line)
        if len(previews) >= PREVIEW_LINE_LIMIT:
            break
    return previews


def infer_next_step(result: ConversionResult) -> str:
    if "dependency_missing" in result.quality_flags:
        return "install_dependency_and_retry"
    if "conversion_failed" in result.quality_flags:
        return "manual_review"
    if {"scanned_pdf_suspected", "low_text_density"} & set(result.quality_flags):
        return "cheap_model_or_stronger_converter"
    if "low_text_output" in result.quality_flags and result.source.suffix.lower() in {
        ".pdf",
        ".docx",
        ".pptx",
        ".xlsx",
    }:
        return "cheap_model_or_stronger_converter"
    return "read_extracted_artifact"


def build_index_markdown(result: ConversionResult) -> str:
    source_type = result.source.suffix.lower().lstrip(".") or "unknown"
    lines = [
        f"# Heavy File Index: {result.source.name}",
        "",
        f"- Source path: `{result.source}`",
        f"- Source type: `{source_type}`",
        f"- Source size: `{human_size(result.source.stat().st_size)}`",
        f"- Converter: `{result.converter or 'none'}`",
        f"- Recommended next step: `{infer_next_step(result)}`",
    ]

    if result.quality_flags:
        lines.append(f"- Quality flags: `{', '.join(result.quality_flags)}`")
    if result.warnings:
        lines.append(f"- Warnings: `{'; '.join(result.warnings)}`")

    lines.extend(["", "## Artifacts", ""])
    for artifact in result.artifacts:
        lines.append(f"- `{artifact.kind}`: `{relpath(Path(artifact.path), result.output_dir)}` — {artifact.description}")

    if result.stats:
        lines.extend(["", "## Stats", ""])
        for key, value in sorted(result.stats.items()):
            lines.append(f"- `{key}`: `{value}`")

    previews: list[str] = []
    for artifact in result.artifacts:
        previews.extend(gather_preview_lines(Path(artifact.path)))
        if len(previews) >= PREVIEW_LINE_LIMIT:
            break

    if previews:
        lines.extend(["", "## Preview", ""])
        for index, preview in enumerate(previews[:PREVIEW_LINE_LIMIT], start=1):
            lines.append(f"{index}. {preview}")

    return "\n".join(lines) + "\n"


def write_index_files(result: ConversionResult) -> None:
    index_payload = {
        "source": str(result.source),
        "source_name": result.source.name,
        "mime_type": mimetypes.guess_type(result.source.name)[0] or "application/octet-stream",
        "source_size_bytes": result.source.stat().st_size,
        "converter": result.converter,
        "artifacts": [artifact.__dict__ for artifact in result.artifacts],
        "warnings": result.warnings,
        "quality_flags": result.quality_flags,
        "recommended_next_step": infer_next_step(result),
        "stats": result.stats,
    }

    index_json = result.output_dir / "index.json"
    index_md = result.output_dir / "index.md"
    write_text(index_json, json.dumps(index_payload, indent=2, sort_keys=True) + "\n")
    write_text(index_md, build_index_markdown(result))


def maybe_markitdown(source: Path, output_path: Path, prefer: str) -> str | None:
    if prefer == "native":
        return None

    command_sets: list[list[str]] = []
    if shutil.which("markitdown"):
        command_sets.append(["markitdown", str(source)])
    if prefer == "markitdown" and shutil.which("uvx"):
        command_sets.append(["uvx", "--from", MARKITDOWN_SPEC, "markitdown", str(source)])

    for command in command_sets:
        try:
            completed = subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
            )
        except (OSError, subprocess.CalledProcessError):
            continue

        if completed.stdout.strip():
            write_text(output_path, completed.stdout)
            return "markitdown"

    return None


def convert_csv_like(source: Path, output_dir: Path, delimiter: str) -> ConversionResult:
    result = ConversionResult(source=source, output_dir=output_dir, converter="native-csv")
    normalized_path = output_dir / "table.csv"
    summary_path = output_dir / "table.md"

    rows: list[list[str]] = []
    with source.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        reader = csv.reader(handle, delimiter=delimiter)
        for row in reader:
            rows.append([str(cell) for cell in row])

    with normalized_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerows(rows)

    header = rows[0] if rows else []
    preview_rows = rows[1:6] if len(rows) > 1 else []
    summary_lines = [
        f"# Table Summary: {source.name}",
        "",
        f"- Rows: `{max(len(rows) - 1, 0)}`",
        f"- Columns: `{len(header)}`",
        f"- Header: `{', '.join(header) if header else 'none'}`",
        "",
        "## Preview",
        "",
    ]

    if preview_rows:
        for index, row in enumerate(preview_rows, start=1):
            summary_lines.append(f"{index}. `{row}`")
    else:
        summary_lines.append("No data rows found.")

    write_text(summary_path, "\n".join(summary_lines) + "\n")

    result.artifacts.extend(
        [
            Artifact(path=str(normalized_path), kind="csv", description="Normalized CSV artifact"),
            Artifact(path=str(summary_path), kind="markdown", description="Cheap table summary"),
        ]
    )
    result.stats.update(
        {
            "row_count": max(len(rows) - 1, 0),
            "column_count": len(header),
        }
    )
    if not rows:
        result.quality_flags.append("low_text_output")
    return result


def convert_xlsx(source: Path, output_dir: Path) -> ConversionResult:
    openpyxl = require_module("openpyxl", "openpyxl")
    result = ConversionResult(source=source, output_dir=output_dir, converter="native-openpyxl")
    workbook = openpyxl.load_workbook(source, read_only=True, data_only=True)
    manifest_lines = [f"# Workbook Summary: {source.name}", ""]
    sheet_count = 0

    for sheet in workbook.worksheets:
        sheet_count += 1
        slug = slugify(sheet.title)
        csv_path = output_dir / f"{sheet_count:02d}-{slug}.csv"

        row_count = 0
        max_columns = 0
        first_rows: list[list[str]] = []
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            for values in sheet.iter_rows(values_only=True):
                normalized = ["" if cell is None else str(cell) for cell in values]
                writer.writerow(normalized)
                if any(cell != "" for cell in normalized):
                    row_count += 1
                    max_columns = max(max_columns, len(normalized))
                    if len(first_rows) < 5:
                        first_rows.append(normalized)

        header = first_rows[0] if first_rows else []
        manifest_lines.extend(
            [
                f"## Sheet {sheet_count}: {sheet.title}",
                "",
                f"- Rows with content: `{row_count}`",
                f"- Columns observed: `{max_columns}`",
                f"- Header preview: `{header}`",
                f"- CSV artifact: `{csv_path.name}`",
                "",
            ]
        )

        result.artifacts.append(
            Artifact(path=str(csv_path), kind="csv", description=f"Sheet {sheet_count}: {sheet.title}")
        )

    manifest_path = output_dir / "workbook.md"
    write_text(manifest_path, "\n".join(manifest_lines))
    result.artifacts.append(
        Artifact(path=str(manifest_path), kind="markdown", description="Workbook manifest and sheet preview")
    )
    result.stats["sheet_count"] = sheet_count
    if sheet_count == 0:
        result.quality_flags.append("low_text_output")
    return result


def extract_shape_text(shape, collector: list[str]) -> None:
    if hasattr(shape, "has_text_frame") and shape.has_text_frame:
        text = shape.text.strip()
        if text:
            collector.append(text)
    if hasattr(shape, "shapes"):
        for child in shape.shapes:
            extract_shape_text(child, collector)


def convert_pptx(source: Path, output_dir: Path) -> ConversionResult:
    pptx = require_module("pptx", "python-pptx")
    presentation = pptx.Presentation(str(source))
    result = ConversionResult(source=source, output_dir=output_dir, converter="native-python-pptx")
    markdown_path = output_dir / "presentation.md"

    lines = [f"# Presentation: {source.name}", ""]
    titled_slides = 0
    for slide_number, slide in enumerate(presentation.slides, start=1):
        title_shape = slide.shapes.title
        title = title_shape.text.strip() if title_shape and title_shape.text else f"Slide {slide_number}"
        if title_shape and title_shape.text.strip():
            titled_slides += 1

        lines.append(f"## Slide {slide_number}: {title}")
        lines.append("")

        slide_text: list[str] = []
        for shape in slide.shapes:
            extract_shape_text(shape, slide_text)

        deduped: list[str] = []
        seen: set[str] = set()
        for block in slide_text:
            normalized = block.strip()
            if not normalized or normalized in seen or normalized == title:
                continue
            seen.add(normalized)
            deduped.append(normalized)

        if deduped:
            for block in deduped:
                lines.append(f"- {block}")
        else:
            lines.append("- No extractable text found on this slide.")

        notes_slide = getattr(slide, "notes_slide", None)
        notes_frame = getattr(notes_slide, "notes_text_frame", None) if notes_slide else None
        notes_text = notes_frame.text.strip() if notes_frame and notes_frame.text else ""
        if notes_text:
            lines.extend(["", "### Speaker Notes", "", notes_text])

        lines.append("")

    write_text(markdown_path, "\n".join(lines))
    result.artifacts.append(
        Artifact(path=str(markdown_path), kind="markdown", description="Slide outline and notes")
    )
    result.stats.update(
        {
            "slide_count": len(presentation.slides),
            "titled_slides": titled_slides,
        }
    )
    if len(presentation.slides) == 0:
        result.quality_flags.append("low_text_output")
    return result


def convert_docx(source: Path, output_dir: Path, prefer: str) -> ConversionResult:
    markdown_path = output_dir / "document.md"
    markitdown_used = maybe_markitdown(source, markdown_path, prefer)
    if markitdown_used:
        result = ConversionResult(source=source, output_dir=output_dir, converter=markitdown_used)
        result.artifacts.append(
            Artifact(path=str(markdown_path), kind="markdown", description="Document converted to markdown")
        )
        text_chars = len(markdown_path.read_text(encoding="utf-8", errors="replace"))
        result.stats["text_chars"] = text_chars
        if text_chars < 200:
            result.quality_flags.append("low_text_output")
        return result

    docx = require_module("docx", "python-docx")
    document = docx.Document(str(source))
    result = ConversionResult(source=source, output_dir=output_dir, converter="native-python-docx")

    lines = [f"# Document: {source.name}", ""]
    heading_count = 0
    paragraph_count = 0
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style_name = paragraph.style.name if paragraph.style else ""
        match = re.match(r"Heading (\d+)", style_name)
        if match:
            level = min(int(match.group(1)), 6)
            lines.append(f"{'#' * level} {text}")
            lines.append("")
            heading_count += 1
        else:
            lines.append(text)
            lines.append("")
            paragraph_count += 1

    for table_index, table in enumerate(document.tables, start=1):
        rows = []
        for row in table.rows[:11]:
            rows.append([cell.text.strip() for cell in row.cells])
        if not rows:
            continue
        lines.append(f"## Table {table_index}")
        lines.append("")
        header = rows[0]
        lines.append("| " + " | ".join(header) + " |")
        lines.append("| " + " | ".join(["---"] * len(header)) + " |")
        for row in rows[1:]:
            lines.append("| " + " | ".join(row) + " |")
        if len(table.rows) > len(rows):
            lines.append("")
            lines.append(f"_Table truncated after {len(rows)} rows for token efficiency._")
        lines.append("")

    write_text(markdown_path, "\n".join(lines))
    result.artifacts.append(
        Artifact(path=str(markdown_path), kind="markdown", description="Document converted to markdown")
    )
    result.stats.update(
        {
            "heading_count": heading_count,
            "paragraph_count": paragraph_count,
            "table_count": len(document.tables),
        }
    )
    if heading_count == 0 and paragraph_count < 5:
        result.quality_flags.append("low_text_output")
    return result


def convert_pdf(source: Path, output_dir: Path, prefer: str) -> ConversionResult:
    markdown_path = output_dir / "document.md"
    markitdown_used = maybe_markitdown(source, markdown_path, prefer)
    if markitdown_used:
        result = ConversionResult(source=source, output_dir=output_dir, converter=markitdown_used)
        result.artifacts.append(
            Artifact(path=str(markdown_path), kind="markdown", description="PDF converted to markdown")
        )
        text_chars = len(markdown_path.read_text(encoding="utf-8", errors="replace"))
        result.stats["text_chars"] = text_chars
        if text_chars < 400:
            result.quality_flags.append("low_text_output")
        return result

    pdfplumber = require_module("pdfplumber", "pdfplumber")
    result = ConversionResult(source=source, output_dir=output_dir, converter="native-pdfplumber")

    lines = [f"# PDF: {source.name}", ""]
    non_empty_pages = 0
    char_count = 0
    with pdfplumber.open(str(source)) as pdf:
        page_count = len(pdf.pages)
        for page_number, page in enumerate(pdf.pages, start=1):
            text = (page.extract_text() or "").strip()
            lines.append(f"## Page {page_number}")
            lines.append("")
            if text:
                lines.append(text)
                non_empty_pages += 1
                char_count += len(text)
            else:
                lines.append("_No extractable text found on this page._")
            lines.append("")

    write_text(markdown_path, "\n".join(lines))
    result.artifacts.append(
        Artifact(path=str(markdown_path), kind="markdown", description="PDF text extracted page by page")
    )
    result.stats.update(
        {
            "page_count": page_count,
            "non_empty_pages": non_empty_pages,
            "text_chars": char_count,
            "avg_chars_per_page": round(char_count / page_count, 1) if page_count else 0,
        }
    )
    if page_count and non_empty_pages / page_count < 0.7:
        result.quality_flags.append("scanned_pdf_suspected")
    if page_count >= 3 and char_count / page_count < 120:
        result.quality_flags.append("low_text_density")
    return result


def convert_text_file(source: Path, output_dir: Path) -> ConversionResult:
    result = ConversionResult(source=source, output_dir=output_dir, converter="native-text")
    text = source.read_text(encoding="utf-8", errors="replace")
    copied_path = output_dir / ("document.md" if source.suffix.lower() != ".md" else source.name)

    if source.suffix.lower() == ".md":
        shutil.copyfile(source, copied_path)
    else:
        write_text(copied_path, f"# Text File: {source.name}\n\n{text}")

    result.artifacts.append(
        Artifact(path=str(copied_path), kind="markdown", description="Text copied into markdown")
    )
    result.stats["text_chars"] = len(text)
    return result


def handle_conversion(source: Path, output_dir: Path, prefer: str) -> ConversionResult:
    suffix = source.suffix.lower()
    if suffix == ".csv":
        return convert_csv_like(source, output_dir, delimiter=",")
    if suffix == ".tsv":
        return convert_csv_like(source, output_dir, delimiter="\t")
    if suffix == ".xlsx":
        return convert_xlsx(source, output_dir)
    if suffix == ".pptx":
        return convert_pptx(source, output_dir)
    if suffix == ".docx":
        return convert_docx(source, output_dir, prefer)
    if suffix == ".pdf":
        return convert_pdf(source, output_dir, prefer)
    if suffix in {".txt", ".md"}:
        return convert_text_file(source, output_dir)

    result = ConversionResult(source=source, output_dir=output_dir, converter="unsupported")
    result.warnings.append(f"Unsupported file type: {suffix or 'unknown'}")
    result.quality_flags.extend(["conversion_failed", "unsupported_type"])
    return result


def main() -> int:
    args = parse_args()
    source = args.source.expanduser().resolve()
    if not source.exists() or not source.is_file():
        print(f"Source file not found: {source}", file=sys.stderr)
        return 1

    output_dir = (
        args.output_dir.expanduser().resolve()
        if args.output_dir
        else source.parent / f"{source.name}.ob1"
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        result = handle_conversion(source, output_dir, args.prefer)
    except RuntimeError as exc:
        result = ConversionResult(source=source, output_dir=output_dir, converter="failed")
        result.warnings.append(str(exc))
        result.quality_flags.extend(["conversion_failed", "dependency_missing"])
    except Exception as exc:
        result = ConversionResult(source=source, output_dir=output_dir, converter="failed")
        result.warnings.append(f"{exc.__class__.__name__}: {exc}")
        result.quality_flags.extend(["conversion_failed", "unexpected_error"])

    result.stats.setdefault("source_extension", source.suffix.lower() or "none")
    result.stats.setdefault("source_size_bytes", source.stat().st_size)
    write_index_files(result)

    print(json.dumps(
        {
            "output_dir": str(output_dir),
            "recommended_next_step": infer_next_step(result),
            "quality_flags": result.quality_flags,
            "artifacts": [artifact.__dict__ for artifact in result.artifacts],
        },
        indent=2,
    ))
    return 0 if "conversion_failed" not in result.quality_flags else 2


if __name__ == "__main__":
    sys.exit(main())
