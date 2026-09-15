import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("extractor", Path(__file__).with_name("extract-gate-artifact.py"))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class ArtifactTests(unittest.TestCase):
    def check_archive(self, extra=None, context=None):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            archive = root / "report.zip"
            with zipfile.ZipFile(archive, "w") as target:
                target.writestr(context or "ob1-review-context.json", json.dumps({"pr_number": 343}))
                target.writestr("ob1-review-summary.md", "Report")
                if extra:
                    target.writestr(*extra)
            extractor.extract(archive, root / "report")
            return sorted(p.name for p in (root / "report").iterdir())

    def test_only_reports_are_extracted(self):
        self.assertEqual(self.check_archive(("../../escape.py", "raise Exception('executed')")),
                         sorted(extractor.FILES))

    def test_symlink_rejected(self):
        entry = zipfile.ZipInfo("ob1-review-context.json")
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaises(ValueError):
            self.check_archive(context=entry)

    def test_duplicate_rejected(self):
        with self.assertRaises(ValueError):
            self.check_archive(("ob1-review-summary.md", "duplicate"))

    def test_oversized_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            archive = Path(root) / "report.zip"
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as target:
                target.writestr("ob1-review-context.json", "{}")
                target.writestr("ob1-review-summary.md", "x" * (extractor.MAX_BYTES + 1))
            with self.assertRaises(ValueError):
                extractor.extract(archive, Path(root) / "report")


if __name__ == "__main__":
    unittest.main()
