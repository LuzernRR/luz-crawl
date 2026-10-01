from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
from tool_preflight import build_plan


class ExtensionPreflightTests(unittest.TestCase):
    def test_selected_extension_route_and_connection_state_are_visible_in_plan(self):
        commands = {"agent-reach": None, "opencli": None, "gh": None, "yt-dlp": None, "mcporter": None, "curl": None}
        report = {
            "status": "warn",
            "service_running": True,
            "extension_connected": False,
            "message": "桥接服务在线，但扩展尚未连接。",
        }
        plan = build_plan(
            "搜索深圳家具工厂",
            ["1688"],
            ["luz-crawl-extension"],
            commands=commands,
            extension_bridge_report=report,
            queries=["深圳家具工厂"],
        )
        route = next(item for item in plan["recommended_routes"] if item["route"].startswith("luz-crawl-extension/"))
        self.assertEqual(route["status"], "warn")
        self.assertIn("尚未连接", route["limitation"])
        self.assertEqual(plan["planned_queries"], ["深圳家具工厂"])
        self.assertTrue(any("do not silently replace" in item for item in plan["fallback_chain"]))


if __name__ == "__main__":
    unittest.main()
