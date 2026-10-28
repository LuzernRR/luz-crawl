import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "dedupe_raw_images.py"
SPEC = importlib.util.spec_from_file_location("dedupe_raw_images", SCRIPT)
dedupe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dedupe)


class DedupeRawImageTests(unittest.TestCase):
    def test_plan_keeps_all_paths_and_apply_replaces_duplicate_data_with_hardlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "raw"
            original = root / "images" / "poster.png"
            duplicate = root / "archive" / "对比旧版" / "images" / "poster.png"
            original.parent.mkdir(parents=True)
            duplicate.parent.mkdir(parents=True)
            payload = b"same image bytes" * 100
            original.write_bytes(payload)
            duplicate.write_bytes(payload)

            plan = dedupe.build_plan(root)
            self.assertEqual(plan["duplicate_files"], 1)
            self.assertEqual(Path(plan["links"][0]["canonical"]), original)
            result = dedupe.apply_plan(plan)

            self.assertEqual(result["reclaimed_bytes_estimate"], len(payload))
            self.assertTrue(original.is_file() and duplicate.is_file())
            self.assertEqual(original.read_bytes(), duplicate.read_bytes())
            self.assertTrue(original.samefile(duplicate))

    def test_changed_duplicate_is_left_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "raw"
            original = root / "a.png"
            duplicate = root / "b.png"
            root.mkdir()
            original.write_bytes(b"original")
            duplicate.write_bytes(b"same size")
            plan = dedupe.build_plan(root)
            self.assertEqual(plan["duplicate_files"], 0)

            duplicate.write_bytes(b"different")
            self.assertEqual(dedupe.apply_plan(plan)["links"], [])
            self.assertEqual(duplicate.read_bytes(), b"different")


if __name__ == "__main__":
    unittest.main()
