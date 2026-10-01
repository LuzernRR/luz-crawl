from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import content_index  # noqa: E402
import experience_store  # noqa: E402
import source_registry  # noqa: E402
import tool_preflight  # noqa: E402


class ExperienceStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "state"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def event(self, event_id: str, *, preference: dict | None = None,
              worked: list[str] | None = None) -> dict:
        return {
            "event_id": event_id,
            "label": "GitHub 开源爬虫检索",
            "summary": "GitHub 开源爬虫项目与 API 方案",
            "domain": "software",
            "channels": ["github"],
            "worked_queries": worked or ["github open source crawler API"],
            "weak_queries": ["generic crawler"],
            "next_queries": ["GitHub repository issues rate limit"],
            "preference_observations": [preference] if preference else [],
        }

    def test_explicit_preferences_are_active_and_idempotent(self) -> None:
        event = self.event("run-1", preference={
            "key": "result_style", "value": "short and source-linked",
            "source": "explicit", "evidence": "User asked for concise answers",
        })
        self.assertTrue(experience_store.record_event(event, self.root))
        self.assertFalse(experience_store.record_event(event, self.root))
        profile = experience_store.preference_profile(experience_store.load_events(self.root))
        self.assertEqual(profile["active_preferences"][0]["value"], "short and source-linked")
        report = experience_store.doctor(self.root)
        self.assertTrue(report["ok"], report["errors"])

    def test_inferred_preference_needs_two_independent_runs(self) -> None:
        observation = {
            "key": "preferred_sources", "value": "official docs and maintained GitHub repos",
            "source": "inferred", "confidence": 0.8,
        }
        experience_store.record_event(self.event("run-a", preference=observation), self.root)
        first = experience_store.preference_profile(experience_store.load_events(self.root))
        self.assertEqual(first["active_preferences"], [])
        self.assertEqual(first["pending_inferred_preferences"][0]["status"], "pending_confirmation")
        experience_store.record_event(self.event("run-b", preference=observation), self.root)
        second = experience_store.preference_profile(experience_store.load_events(self.root))
        self.assertEqual(second["active_preferences"][0]["observation_count"], 2)

    def test_explicit_preference_overrides_inferred(self) -> None:
        experience_store.record_event(self.event("run-a", preference={
            "key": "result_style", "value": "long detail", "source": "inferred",
        }), self.root)
        experience_store.record_event(self.event("run-b", preference={
            "key": "result_style", "value": "long detail", "source": "inferred",
        }), self.root)
        experience_store.record_event(self.event("run-c", preference={
            "key": "result_style", "value": "concise", "source": "explicit",
        }), self.root)
        profile = experience_store.preference_profile(experience_store.load_events(self.root))
        self.assertEqual(profile["active_preferences"][0]["value"], "concise")

    def test_query_returns_cjk_keyword_hints_and_preferences(self) -> None:
        experience_store.record_event(self.event("run-a", preference={
            "key": "preferred_sources", "value": "官方文档与 GitHub 项目", "source": "explicit",
        }), self.root)
        result = experience_store.query_store("GitHub 开源爬虫项目", self.root)
        self.assertTrue(result["matches"])
        self.assertEqual(result["preferences"][0]["key"], "preferred_sources")
        self.assertIn("github open source crawler API", result["keyword_hints"]["worked_queries"])
        self.assertIn("generic crawler", result["keyword_hints"]["weak_queries"])

    def test_feedback_requires_source_url_not_copied_text(self) -> None:
        with self.assertRaisesRegex(ValueError, r"source HTTP\(S\) URL"):
            experience_store.normalize_result_feedback({
                "action": "preferred", "item": "the source says something useful",
            })


class ContentIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "index.sqlite"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_manifest_indexes_metadata_and_short_excerpt(self) -> None:
        manifest = Path(self.temp.name) / "manifest.json"
        manifest.write_text(json.dumps({"articles": [{
            "platform": "知乎", "title": "开源爬虫项目架构", "author": "作者甲",
            "published": "2026-09-30", "url": "https://www.zhihu.com/question/123",
            "text": "GitHub API、SQLite FTS、关键词学习。" * 200,
        }]}, ensure_ascii=False), encoding="utf-8")
        self.assertEqual(content_index.index_manifest(manifest, self.database), 1)
        results = content_index.search_index("开源爬虫项目", self.database)
        self.assertEqual(results[0]["platform"], "zhihu")
        self.assertLessEqual(len(results[0]["excerpt"]), content_index.MAX_EXCERPT_CHARS + 100)
        self.assertEqual(content_index.index_manifest(manifest, self.database), 1)
        connection = content_index.connect(self.database)
        try:
            count = connection.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        finally:
            connection.close()
        self.assertEqual(count, 1)

    def test_manifest_indexes_legacy_string_sources_and_merges_richer_items(self) -> None:
        manifest = Path(self.temp.name) / "manifest.json"
        manifest.write_text(json.dumps({
            "title": "深圳家具线索",
            "platform": "1688",
            "sources": ["https://detail.1688.com/offer/123.html"],
            "items": [{
                "platform": "1688", "title": "深圳实木沙发工厂",
                "url": "https://detail.1688.com/offer/123.html",
                "summary": "同一商品卡片的补充描述。",
            }],
        }, ensure_ascii=False), encoding="utf-8")
        documents = content_index.documents_from_manifest(manifest)
        self.assertEqual(len(documents), 1)
        self.assertEqual(documents[0]["title"], "深圳实木沙发工厂")
        self.assertEqual(documents[0]["summary"], "同一商品卡片的补充描述。")
        self.assertEqual(content_index.index_manifest(manifest, self.database), 1)
        results = content_index.search_index("深圳 实木 沙发", self.database)
        self.assertEqual(results[0]["url"], "https://detail.1688.com/offer/123.html")

    def test_x_post_body_is_not_indexed(self) -> None:
        content_index.index_documents([{
            "platform": "X", "title": "Timeline entry", "url": "https://x.com/user/status/123",
            "text": "sensitive copied topsecret body phrase",
        }], self.database)
        connection = content_index.connect(self.database)
        try:
            row = connection.execute(
                "SELECT d.title, d.author, f.excerpt FROM documents d "
                "JOIN documents_fts f ON d.doc_id = f.doc_id"
            ).fetchone()
        finally:
            connection.close()
        self.assertEqual(tuple(row), ("", "", ""))
        self.assertEqual(content_index.search_index("sensitive copied topsecret body phrase", self.database), [])

    def test_index_drops_token_like_url_parameters(self) -> None:
        safe = source_registry.safe_source_url(
            "https://www.xiaohongshu.com/explore/abc?xsec_token=secret&source=share#note"
        )
        self.assertEqual(safe, "https://www.xiaohongshu.com/explore/abc?source=share")

    def test_explicit_result_feedback_changes_local_ranking(self) -> None:
        content_index.index_documents([
            {"platform": "github", "title": "open crawler", "url": "https://github.com/a/crawler"},
            {"platform": "github", "title": "open crawler", "url": "https://github.com/b/crawler"},
        ], self.database)
        feedback = [{
            "action": "rejected", "item": "https://github.com/b/crawler",
        }]
        self.assertEqual(content_index.record_feedback(feedback, self.database, "run-1"), 1)
        self.assertEqual(content_index.record_feedback(feedback, self.database, "run-1"), 0)
        results = content_index.search_index("open crawler", self.database)
        self.assertEqual(results[0]["url"], "https://github.com/a/crawler")
        self.assertGreater(results[0]["personalization_score"], results[1]["personalization_score"])

    def test_feedback_does_not_override_stronger_text_match(self) -> None:
        content_index.index_documents([
            {"platform": "github", "title": "crawler rate limit", "url": "https://github.com/a/strong"},
            {"platform": "github", "title": "crawler", "url": "https://github.com/b/weak"},
        ], self.database)
        content_index.record_feedback([{
            "action": "rejected", "item": "https://github.com/a/strong",
        }], self.database, "run-reject-strong")
        results = content_index.search_index("crawler rate limit", self.database)
        self.assertEqual(results[0]["url"], "https://github.com/a/strong")


class PreflightPlanTests(unittest.TestCase):
    def test_plan_names_domains_routes_and_steps(self) -> None:
        plan = tool_preflight.build_plan(
            "找跨平台内容采集方案", ["小红书", "X", "GitHub", "公众号"],
            ["web__run"],
            commands={"agent-reach": None, "opencli": None, "gh": "gh.exe",
                      "yt-dlp": None, "mcporter": None, "curl": "curl.exe"},
            doctor_report={}, opencli_report={},
            queries=["open source cross platform crawler", "小红书 笔记 搜索 API"],
        )
        sites = {item["platform"]: item for item in plan["planned_sites"]}
        self.assertEqual(sites["github"]["domains"], ["github.com"])
        self.assertIn("mp.weixin.qq.com", sites["wechat"]["domains"])
        gh_route = next(item for item in plan["recommended_routes"] if item["route"] == "gh")
        self.assertEqual(gh_route["status"], "unverified")
        text = tool_preflight.render_user_plan(plan)
        self.assertIn("访问的网站", text)
        self.assertIn("执行步骤", text)
        self.assertIn("fallback", text.lower())
        self.assertIn("小红书 笔记 搜索 API", text)

    def test_enterprise_lead_sources_show_access_gates_and_contact_scope(self) -> None:
        with patch.dict("os.environ", {"QCC_APP_KEY": "", "QCC_SECRET_KEY": ""}):
            plan = tool_preflight.build_plan(
                "深圳家居企业获客线索", ["1688", "企查查", "gsxt", "深圳家居行业"],
                ["web__run"],
                commands={"agent-reach": None, "opencli": "opencli.ps1", "gh": None,
                          "yt-dlp": None, "mcporter": None, "curl": "curl.exe"},
                doctor_report={},
                opencli_report={
                    "bridge_connected": True,
                    "site_search": {"1688": {"search_available": True}},
                },
                queries=["深圳床垫 家居工厂", "深圳家居企业 官网 商务联系方式"],
            )

        sites = {site["platform"]: site for site in plan["planned_sites"]}
        self.assertEqual(sites["1688"]["domains"], ["1688.com", "open.1688.com"])
        self.assertIn("openapi.qcc.com", sites["qichacha"]["domains"])
        self.assertIn("gsxt.gov.cn", sites["gsxt"]["domains"])
        routes = {route["route"]: route for route in plan["recommended_routes"]}
        self.assertEqual(routes["qichacha/openapi:886"]["status"], "needs_credentials")
        self.assertEqual(routes["opencli/1688:search"]["status"], "available")
        self.assertIn("登录", routes["opencli/1688:search"]["limitation"])
        rendered = tool_preflight.render_user_plan(plan)
        self.assertIn("业务合作", rendered)


class FinalizeRunIntegrationTests(unittest.TestCase):
    def test_finalizer_persists_preferences_and_indexes_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            dossier = root / "001_search"
            dossier.mkdir()
            (dossier / "001_search.md").write_text("# Search result\n", encoding="utf-8")
            (dossier / "manifest.json").write_text(json.dumps({
                "articles": [{
                    "platform": "GitHub", "title": "Open crawler", "author": "maintainer",
                    "url": "https://github.com/example/open-crawler",
                    "summary": "A public repository for a crawler.",
                }],
            }), encoding="utf-8")
            experience_root = root / "state"
            command = [
                sys.executable, str(SCRIPTS / "finalize_run.py"), str(dossier),
                "--run-id", "integration-run-1", "--experience-root", str(experience_root),
                "--summary", "Searched open crawler implementations",
                "--preference", json.dumps({
                    "key": "preferred_sources", "value": "maintained GitHub repositories",
                    "source": "explicit",
                }),
                "--feedback", json.dumps({
                    "action": "preferred", "item": "https://github.com/example/open-crawler",
                    "platform": "github", "reason": "implementation evidence",
                }),
            ]
            result = subprocess.run(command, check=False, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("recorded=true", result.stdout)
            self.assertIn("content_indexed=1", result.stdout)
            profile = json.loads((experience_root / "user-preferences.json").read_text(encoding="utf-8"))
            self.assertEqual(profile["active_preferences"][0]["value"], "maintained GitHub repositories")
            indexed = content_index.search_index("open crawler", experience_root / "content-index.sqlite")
            self.assertEqual(indexed[0]["url"], "https://github.com/example/open-crawler")


if __name__ == "__main__":
    unittest.main()
