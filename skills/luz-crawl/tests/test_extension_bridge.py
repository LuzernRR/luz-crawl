from __future__ import annotations

from contextlib import redirect_stderr
from io import StringIO
import sys
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import extension_bridge


class ExtensionBridgeCliTests(unittest.TestCase):
    def test_configure_persists_the_extension_id_once(self):
        with tempfile.TemporaryDirectory() as directory:
            config_file = Path(directory) / "bridge-config.json"
            with patch.object(extension_bridge, "CONFIG_FILE", config_file):
                result = extension_bridge.main(["configure", "--extension-id", "a" * 32])
            self.assertEqual(result, 0)
            self.assertEqual(json.loads(config_file.read_text(encoding="utf-8")), {"extensionId": "a" * 32})

    def test_configure_rejects_invalid_extension_ids(self):
        with patch.object(extension_bridge, "CONFIG_FILE", Path("unused-config.json")), \
             redirect_stderr(StringIO()):
            result = extension_bridge.main(["configure", "--extension-id", "not-an-extension-id"])
        self.assertEqual(result, 2)

    def test_search_waits_for_extension_result_and_keeps_chinese_query(self):
        seen = []
        responses = [
            {"id": "job-1", "sourceId": "1688", "query": "深圳家具工厂", "status": "queued"},
            {"id": "job-1", "sourceId": "1688", "query": "深圳家具工厂", "status": "completed", "resultCount": 2,
             "capture": {"links": [{"title": "深圳家具厂", "url": "https://example.com/"}] }},
        ]

        def request(method, path, body=None, timeout=3.0):
            seen.append((method, path, body))
            return responses.pop(0)

        with patch.object(extension_bridge, "ensure_server", return_value={"extensionConnected": True}), \
             patch.object(extension_bridge, "_request", side_effect=request), \
             patch.object(extension_bridge.time, "sleep", return_value=None):
            result = extension_bridge.submit("1688", "深圳家具工厂", wait_timeout=1)

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["capture"]["links"][0]["title"], "深圳家具厂")
        self.assertEqual(seen[0], ("POST", "/api/jobs", {"sourceId": "1688", "query": "深圳家具工厂"}))
        self.assertEqual(seen[1][1], "/api/jobs/job-1")

    def test_no_wait_returns_backend_job_id_without_opening_browser_manually(self):
        job = {"id": "job-2", "sourceId": "github", "query": "browser agent", "status": "queued"}
        with patch.object(extension_bridge, "ensure_server", return_value={"extensionConnected": False}), \
             patch.object(extension_bridge, "_request", return_value=job) as request:
            result = extension_bridge.submit("github", "browser agent", wait=False)
        self.assertEqual(result["id"], "job-2")
        request.assert_called_once_with("POST", "/api/jobs", {"sourceId": "github", "query": "browser agent"})

    def test_sources_lists_platforms_from_the_shared_extension_catalog(self):
        catalog = {"sources": [{"id": "qichacha", "category": "企业信息"}]}
        with patch.object(extension_bridge, "ensure_server", return_value={"extensionConnected": True}), \
             patch.object(extension_bridge, "_request", return_value=catalog) as request:
            result = extension_bridge.list_sources()
        self.assertEqual(result, catalog)
        request.assert_called_once_with("GET", "/api/sources")


if __name__ == "__main__":
    unittest.main()
