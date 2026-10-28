import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "prune_raw.py"
SPEC = importlib.util.spec_from_file_location("prune_raw", SCRIPT)
prune_raw = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prune_raw)


class PruneRawTests(unittest.TestCase):
    def test_only_verified_deliveries_with_retained_content_can_be_compacted(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            raw_root = output / "raw"
            task = raw_root / "008_search_task"
            archive = task / "raw" / "001_post"
            evidence = archive / "raw"
            snapshots = evidence / "snapshots"
            snapshots.mkdir(parents=True)
            content = b'{"text":"source text"}'
            snapshot = b"x" * (300 * 1024)
            screenshot = b"p" * (300 * 1024)
            (evidence / "content.json").write_bytes(content)
            (snapshots / "0000.json").write_bytes(snapshot)
            (evidence / "page.png").write_bytes(screenshot)
            delivered = task / "001_post.html"
            delivered.write_text("verified output", encoding="utf-8")

            entries = []
            for relative, payload in (("raw/content.json", content), ("raw/snapshots/0000.json", snapshot), ("raw/page.png", screenshot)):
                entries.append({"path": relative, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()})
            manifest = {
                "output_layout": "html_and_raw_v1",
                "status": "captured",
                "completeness": {"target_present": True},
                "requested_url": "https://example.com/post",
                "canonical_url": "https://example.com/post",
                "resolved_url": "https://example.com/post",
                "captured_at": "2026-10-25T00:00:00Z",
                "primary_file": delivered.name,
                "delivery": {"sha256": hashlib.sha256(delivered.read_bytes()).hexdigest()},
                "files": entries,
            }
            manifest_path = evidence / "manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            plan = prune_raw.build_plan(raw_root)
            self.assertEqual(plan["candidate_files"], 2)
            self.assertEqual(plan["reclaimable_bytes"], len(snapshot) + len(screenshot))
            result = prune_raw.apply_plan(plan)

            self.assertEqual(result["reclaimed_bytes"], plan["reclaimable_bytes"])
            self.assertTrue((evidence / "content.json").is_file())
            self.assertFalse((snapshots / "0000.json").exists())
            self.assertFalse((evidence / "page.png").exists())
            compacted = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(compacted["retention"]["revisit_url"], "https://example.com/post")
            self.assertEqual({item["path"] for item in compacted["files"]}, {"raw/content.json"})
            self.assertEqual(len(compacted["pruned_files"]), 2)

    def test_changed_delivery_is_never_a_cleanup_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            raw_root = output / "raw"
            archive = raw_root / "001_post"
            evidence = archive / "raw"
            (evidence / "snapshots").mkdir(parents=True)
            (evidence / "content.json").write_text("{}", encoding="utf-8")
            large = evidence / "snapshots" / "0000.json"
            large.write_bytes(b"x" * (300 * 1024))
            (output / "001_post.html").write_text("changed", encoding="utf-8")
            manifest = {
                "output_layout": "html_and_raw_v1",
                "status": "captured",
                "completeness": {"target_present": True},
                "primary_file": "001_post.html",
                "delivery": {"sha256": "0" * 64},
                "files": [
                    {"path": "raw/content.json", "sha256": hashlib.sha256(b"{}").hexdigest()},
                    {"path": "raw/snapshots/0000.json", "sha256": hashlib.sha256(large.read_bytes()).hexdigest()},
                ],
            }
            (evidence / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            self.assertEqual(prune_raw.build_plan(raw_root)["candidate_files"], 0)
            self.assertTrue(large.exists())

    def test_archive_without_revisit_url_is_never_compacted(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            raw_root = output / "raw"
            archive = raw_root / "001_post"
            evidence = archive / "raw"
            (evidence / "snapshots").mkdir(parents=True)
            content = evidence / "content.json"
            content.write_text("{}", encoding="utf-8")
            delivered = output / "001_post.html"
            delivered.write_text("verified output", encoding="utf-8")
            manifest = {
                "output_layout": "html_and_raw_v1", "status": "captured",
                "completeness": {"target_present": True}, "primary_file": delivered.name,
                "delivery": {"sha256": hashlib.sha256(delivered.read_bytes()).hexdigest()},
                "files": [{"path": "raw/content.json", "sha256": hashlib.sha256(content.read_bytes()).hexdigest()}],
            }
            (evidence / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

            self.assertEqual(prune_raw.build_plan(raw_root, prune_content=True)["candidate_files"], 0)
            self.assertTrue(content.is_file())

    def test_nested_related_archive_is_not_planned_separately_from_its_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            raw_root = output / "raw"
            parent = raw_root / "001_parent"
            parent_raw = parent / "raw"
            parent_raw.mkdir(parents=True)
            parent_content = parent_raw / "content.json"
            parent_content.write_text("{}", encoding="utf-8")
            parent_snapshot = parent_raw / "snapshots" / "0000.json"
            parent_snapshot.parent.mkdir()
            parent_snapshot.write_bytes(b"x" * (300 * 1024))
            child = parent_raw / "related" / "raw" / "001_child"
            child_raw = child / "raw"
            (child_raw / "snapshots").mkdir(parents=True)
            child_content = child_raw / "content.json"
            child_content.write_text("{}", encoding="utf-8")
            child_snapshot = child_raw / "snapshots" / "0000.json"
            child_snapshot.write_bytes(b"y" * (300 * 1024))
            child_delivery = parent_raw / "related" / "001_child.html"
            child_delivery.write_text("verified child", encoding="utf-8")
            parent_delivery = output / "001_parent.html"
            parent_delivery.write_text("verified parent", encoding="utf-8")

            def entry(path, payload):
                return {"path": path, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}

            child_manifest = {
                "output_layout": "html_and_raw_v1", "status": "captured",
                "completeness": {"target_present": True}, "requested_url": "https://example.com/child",
                "primary_file": child_delivery.name,
                "delivery": {"sha256": hashlib.sha256(child_delivery.read_bytes()).hexdigest()},
                "files": [entry("raw/content.json", child_content.read_bytes()), entry("raw/snapshots/0000.json", child_snapshot.read_bytes())],
            }
            (child_raw / "manifest.json").write_text(json.dumps(child_manifest), encoding="utf-8")
            parent_manifest = {
                "output_layout": "html_and_raw_v1", "status": "captured",
                "completeness": {"target_present": True}, "requested_url": "https://example.com/parent",
                "primary_file": parent_delivery.name,
                "delivery": {"sha256": hashlib.sha256(parent_delivery.read_bytes()).hexdigest()},
                "files": [
                    entry("raw/content.json", parent_content.read_bytes()),
                    entry("raw/snapshots/0000.json", parent_snapshot.read_bytes()),
                    entry("raw/related/raw/001_child/raw/content.json", child_content.read_bytes()),
                    entry("raw/related/raw/001_child/raw/snapshots/0000.json", child_snapshot.read_bytes()),
                ],
            }
            (parent_raw / "manifest.json").write_text(json.dumps(parent_manifest), encoding="utf-8")

            plan = prune_raw.build_plan(raw_root, prune_content=True)
            self.assertEqual(len(plan["archives"]), 1)
            self.assertEqual(plan["archives"][0]["archive"], str(parent))

    def test_prune_content_requires_flag_and_records_link_and_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            raw_root = output / "raw"
            archive = raw_root / "001_post"
            evidence = archive / "raw"
            snapshots = evidence / "snapshots"
            snapshots.mkdir(parents=True)
            content = b'{"text":"' + b"z" * (300 * 1024) + b'"}'
            snapshot = b"x" * (300 * 1024)
            (evidence / "content.json").write_bytes(content)
            (snapshots / "0000.json").write_bytes(snapshot)
            delivered = output / "001_post.html"
            delivered.write_text("verified output", encoding="utf-8")
            entries = [
                {"path": "raw/content.json", "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()},
                {"path": "raw/snapshots/0000.json", "bytes": len(snapshot), "sha256": hashlib.sha256(snapshot).hexdigest()},
            ]
            manifest = {
                "output_layout": "html_and_raw_v1", "status": "captured",
                "completeness": {"target_present": True},
                "requested_url": "https://example.com/post", "canonical_url": "https://example.com/post",
                "resolved_url": "https://example.com/post", "captured_at": "2026-10-25T00:00:00Z",
                "primary_file": delivered.name,
                "delivery": {"sha256": hashlib.sha256(delivered.read_bytes()).hexdigest()},
                "files": entries,
            }
            manifest_path = evidence / "manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            self.assertEqual(prune_raw.build_plan(raw_root)["candidate_files"], 1)
            plan = prune_raw.build_plan(raw_root, prune_content=True)
            self.assertEqual(plan["candidate_files"], 2)
            self.assertEqual(plan["reclaimable_bytes"], len(content) + len(snapshot))
            result = prune_raw.apply_plan(plan)

            self.assertEqual(result["reclaimed_bytes"], plan["reclaimable_bytes"])
            self.assertFalse((evidence / "content.json").exists())
            self.assertTrue((output / "001_post.html").is_file())
            compacted = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(compacted["requested_url"], "https://example.com/post")
            self.assertEqual(compacted["retention"]["content_retained"], False)
            self.assertEqual(compacted["retention"]["content_sha256"], hashlib.sha256(content).hexdigest())
            self.assertEqual(len(compacted["pruned_files"]), 2)


if __name__ == "__main__":
    unittest.main()
