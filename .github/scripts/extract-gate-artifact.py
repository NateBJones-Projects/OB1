"""Read only the two gate report files; never extract archive paths or code."""
import json
from pathlib import Path
import stat
import sys
import zipfile

FILES = {"ob1-review-context.json", "ob1-review-summary.md"}
MAX_BYTES = 1_000_000


def extract(archive, destination):
    destination = Path(destination)
    if destination.exists():
        raise ValueError("Report directory must be fresh")
    with zipfile.ZipFile(archive) as source:
        selected = {}
        for info in source.infolist():
            if info.filename not in FILES:
                continue  # Other files are never read, extracted, or executed.
            if info.filename in selected:
                raise ValueError("Duplicate gate report")
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode) or info.is_dir() or info.file_size > MAX_BYTES:
                raise ValueError("Unsafe gate report")
            with source.open(info) as stream:
                content = stream.read(MAX_BYTES + 1)
            if len(content) > MAX_BYTES:
                raise ValueError("Gate report exceeds size limit")
            selected[info.filename] = content.decode("utf-8")
        if selected.keys() != FILES:
            raise ValueError("Gate report files are missing")
        json.loads(selected["ob1-review-context.json"])
        destination.mkdir(mode=0o700)
        for name, content in selected.items():
            (destination / name).write_text(content, encoding="utf-8")


if __name__ == "__main__":
    extract(*sys.argv[1:])
