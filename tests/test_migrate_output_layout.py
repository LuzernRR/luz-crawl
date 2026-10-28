import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("migration", Path(__file__).parents[1] / "scripts/migrate_output_layout.py")
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTests(unittest.TestCase):
    def test_preserves_files_and_relative_links_and_is_repeatable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "old.html").write_text('<img src="raw/image.png">', encoding="utf-8")
            (root / "raw").mkdir()
            (root / "raw/image.png").write_bytes(b"original-image")
            for name in ["设计参考", "001_已有项目"]:
                project = root / name
                (project / "raw").mkdir(parents=True)
                (project / "总结.html").write_text("原整理内容", encoding="utf-8")
                (project / "raw/source.json").write_text('{"original":true}', encoding="utf-8")
            self.assertFalse(migration.migrate(root, False)["applied"])
            self.assertTrue((root / "old.html").exists())
            result = migration.migrate(root, True)
            self.assertEqual(result["moved_files"], 6)
            for project in root.iterdir():
                self.assertTrue(project.is_dir())
                self.assertEqual([file.name for file in project.glob("*.html")], [f"{project.name}.html"])
                records = json.loads((project / "raw/legacy-manifest.json").read_text(encoding="utf-8"))["files"]
                for item in records:
                    self.assertEqual(migration.digest(project / item["path"]), item["sha256"])
            legacy = root / "000_历史输出/raw/legacy-output"
            self.assertTrue((legacy / "old.html").exists())
            self.assertTrue((legacy / "raw/image.png").exists())
            self.assertEqual(migration.migrate(root, False)["projects"], [])
            self.assertEqual(migration.migrate(root, True)["moved_files"], 0)

    def test_refuses_a_changed_previous_inventory_before_moving(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "000_历史输出"
            (folder / "raw/legacy-root-raw").mkdir(parents=True)
            (folder / "raw/legacy-root").mkdir()
            (folder / "raw/legacy-root/old.html").write_text("edited", encoding="utf-8")
            migration.write_json(folder / "luz-task.json", {"kind": "task_archive"})
            migration.write_json(folder / "raw/legacy-manifest.json", {"files": [{"path": "raw/legacy-root/old.html", "sha256": "0" * 64}]})
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                migration.migrate(root, True)
            self.assertTrue((folder / "raw/legacy-root-raw").exists())


if __name__ == "__main__":
    unittest.main()
