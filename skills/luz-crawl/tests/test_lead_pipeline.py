from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import lead_queries  # noqa: E402
import lead_records  # noqa: E402
import platform_search  # noqa: E402
import qcc_client  # noqa: E402
import company_site_reader  # noqa: E402


class LeadQueryPlanTests(unittest.TestCase):
    def test_reuses_worked_queries_and_skips_weak_queries(self) -> None:
        def history(_intent: str) -> dict:
            return {
                "keyword_hints": {
                    "worked_queries": ["深圳家居源头厂家"],
                    "weak_queries": ["深圳 家居企业 源头厂家"],
                    "matched_runs": ["prior-run"],
                },
                "preferences": [{"key": "preferred_sources", "value": "official"}],
            }

        plan = lead_queries.build_query_plan(
            "家居企业", location="深圳", terms=["沙发"],
            max_queries_per_source=4, history_lookup=history,
        )
        self.assertIn("沙发", plan["queries_by_source"]["1688"][0])
        self.assertIn("深圳家居源头厂家", plan["queries_by_source"]["1688"])
        self.assertNotIn("深圳 家居企业 源头厂家", plan["queries_by_source"]["1688"])
        self.assertEqual(len(plan["queries_by_source"]["qichacha"]), 1)
        self.assertLessEqual(len(plan["queries_by_source"]["qichacha"][0]), 100)
        self.assertEqual(plan["learning"]["matched_runs"], ["prior-run"])


class LeadRecordTests(unittest.TestCase):
    def test_1688_parser_keeps_source_fields_and_drops_unapproved_contact_fields(self) -> None:
        rows = [{
            "offer_id": "12345", "seller_name": "深圳示例家居厂",
            "title": "沙发制造", "item_url": "https://detail.1688.com/offer/12345.html",
            "seller_url": "https://shop.1688.com/page/index.html", "location": "深圳",
            "price_text": "¥500", "moq_text": "2件起订", "mobile": "13800000000",
        }]
        candidates = lead_records.parse_1688_candidates(rows, query="深圳 沙发")
        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(candidate["entity_type"], "supplier_candidate")
        self.assertEqual(candidate["fields"]["supplier_name"], "深圳示例家居厂")
        self.assertEqual(candidate["contacts"], [])
        self.assertNotIn("mobile", candidate["fields"])
        self.assertIn("observed_at", candidate["sources"][0])

    def test_1688_parser_rejects_non_1688_links(self) -> None:
        candidates = lead_records.parse_1688_candidates([{
            "seller_name": "示例", "item_url": "https://attacker.example/item",
        }], query="沙发")
        self.assertEqual(candidates, [])

    def test_qcc_parser_whitelists_company_fields_and_ignores_personal_data(self) -> None:
        candidates = lead_records.parse_qcc_candidates([{
            "Name": "深圳示例家居有限公司", "CreditCode": "91440000EXAMPLE",
            "Address": "深圳市南山区", "LegalPerson": "某某",
            "PhoneNumber": "13800000000", "Contact": "private data",
        }], query="深圳 家居")
        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(candidate["fields"]["company_name"], "深圳示例家居有限公司")
        self.assertNotIn("LegalPerson", candidate["fields"])
        self.assertNotIn("PhoneNumber", candidate["fields"])
        self.assertEqual(candidate["contacts"], [])

    def test_company_site_evidence_attaches_only_same_host_role_mailboxes(self) -> None:
        candidate = lead_records.parse_qcc_candidates([{
            "Name": "深圳示例家居有限公司", "CreditCode": "CODE-1",
        }], query="深圳家居")[0]
        site_result = {
            "status": "readable", "source_url": "https://supplier.example/",
            "contacts": [
                {"type": "role_mailbox_email", "value": "sales@supplier.example",
                 "source_url": "https://supplier.example/contact-us", "observed_at": "2026-09-30T00:00:00+00:00"},
                {"type": "role_mailbox_email", "value": "alice@supplier.example",
                 "source_url": "https://supplier.example/contact-us"},
                {"type": "role_mailbox_email", "value": "info@attacker.example",
                 "source_url": "https://attacker.example/contact"},
            ],
            "business_contact_pages": [{
                "url": "https://supplier.example/contact-us", "anchor_text": "Contact",
                "form_present": True,
            }],
        }
        merged = lead_records.attach_company_site_evidence(candidate, site_result)
        self.assertEqual([item["value"] for item in merged["contacts"]],
                         ["sales@supplier.example"])
        self.assertEqual(merged["contacts"][0]["evidence"]["provider"], "official_company_site")
        self.assertEqual(merged["business_contact_pages"][0]["anchor_text"], "Contact")
        self.assertEqual(candidate["contacts"], [])

    def test_deduplication_merges_provenance_without_splicing_contacts(self) -> None:
        first = lead_records.parse_qcc_candidates([{
            "Name": "示例企业", "CreditCode": "ABC123",
        }], query="示例")
        second = json.loads(json.dumps(first))
        second[0]["sources"][0]["query"] = "企业示例"
        for field in second[0]["field_evidence"].values():
            for evidence in field:
                evidence["query"] = "企业示例"
        merged = lead_records.deduplicate_candidates(first + second)
        self.assertEqual(len(merged), 1)
        self.assertEqual(len(merged[0]["sources"]), 2)
        self.assertEqual(merged[0]["contacts"], [])


class QCCClientTests(unittest.TestCase):
    def test_official_token_uses_uppercase_md5(self) -> None:
        credentials = qcc_client.QCCCredentials("app", "secret")
        headers = qcc_client.make_auth_headers(credentials, timespan="1790000000")
        expected = hashlib.md5(b"app1790000000secret").hexdigest().upper()
        self.assertEqual(headers, {"Token": expected, "Timespan": "1790000000"})

    def test_missing_user_cost_confirmation_makes_no_request(self) -> None:
        opener = Mock(side_effect=AssertionError("network must not be called"))
        with self.assertRaises(qcc_client.QCCConfirmationRequired):
            qcc_client.fuzzy_search(
                "深圳家居", credentials=qcc_client.QCCCredentials("app", "secret"),
                opener=opener,
            )
        opener.assert_not_called()

    def test_confirmed_search_is_one_mocked_request_with_bounded_records(self) -> None:
        class FakeResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit: int) -> bytes:
                return json.dumps({"Status": "200", "Result": [
                    {"Name": "示例企业"}, {"Name": "另一企业"},
                ]}).encode("utf-8")

        opener = Mock(return_value=FakeResponse())
        result = qcc_client.fuzzy_search(
            "深圳家居", credentials=qcc_client.QCCCredentials("app", "secret"),
            confirmed_billable=True, opener=opener, now=lambda: 1790000000,
        )
        self.assertEqual(len(result["records"]), 2)
        self.assertEqual(result["estimated_cost_rmb"], 0.10)
        opener.assert_called_once()
        request = opener.call_args.args[0]
        self.assertEqual(request.get_header("Token"), qcc_client.make_auth_headers(
            qcc_client.QCCCredentials("app", "secret"), timespan="1790000000",
        )["Token"])

    def test_qcc_records_are_capped_at_five_even_if_provider_payload_is_larger(self) -> None:
        records = qcc_client._records({"Result": [{"Name": str(i)} for i in range(8)]})
        self.assertEqual(len(records), 5)


class CompanySiteReaderTests(unittest.TestCase):
    host = "supplier.example"
    public_ip = "93.184.216.34"

    def test_url_requires_exact_approved_https_host_and_safe_path(self) -> None:
        with self.assertRaisesRegex(company_site_reader.SiteReadError, "host_or_scheme"):
            company_site_reader.validate_target("http://supplier.example/", self.host)
        with self.assertRaisesRegex(company_site_reader.SiteReadError, "host_or_scheme"):
            company_site_reader.validate_target("https://other.example/", self.host)
        with self.assertRaisesRegex(company_site_reader.SiteReadError, "unsafe_path"):
            company_site_reader.validate_target("https://supplier.example/../admin", self.host)

    def test_dns_private_address_fails_closed_before_fetch(self) -> None:
        called = False

        def fetcher(*_args, **_kwargs):
            nonlocal called
            called = True
            raise AssertionError("must not fetch a private DNS result")

        with self.assertRaisesRegex(company_site_reader.SiteReadError, "non_public"):
            company_site_reader.read_official_site(
                "https://supplier.example/", self.host,
                resolver=lambda _host: "127.0.0.1", fetcher=fetcher,
                sleeper=lambda _seconds: None,
            )
        self.assertFalse(called)

    def test_reads_only_robots_allowed_pages_and_role_based_email(self) -> None:
        pages = {
            "/robots.txt": (200, "text/plain; charset=utf-8",
                             b"User-agent: *\nAllow: /\n"),
            "/": (200, "text/html; charset=utf-8", (
                '<html><title>Example Company</title><body>'
                '<a href="/contact-us">Business contact</a>'
                '<a href="mailto:sales@supplier.example">Sales</a>'
                '<a href="mailto:alice@supplier.example">Alice</a>'
                '<a href="tel:+8613800000000">Call</a></body></html>'
            ).encode()),
            "/contact-us": (200, "text/html; charset=utf-8", (
                "<html><title>Contact Us</title><form action=\"/send\"></form></html>"
            ).encode()),
        }
        calls: list[str] = []

        def fetcher(_host, _ip, path, **_kwargs):
            calls.append(path)
            status, content_type, body = pages[path]
            return {"status": status, "headers": {"content-type": content_type}, "body": body}

        result = company_site_reader.read_official_site(
            "https://supplier.example/", self.host,
            resolver=lambda _host: self.public_ip, fetcher=fetcher,
            sleeper=lambda _seconds: None,
        )
        self.assertEqual(result["status"], "readable")
        self.assertEqual([item["value"] for item in result["contacts"]],
                         ["sales@supplier.example"])
        self.assertTrue(result["contacts"][0]["source_url"].endswith("/"))
        self.assertTrue(any(item.get("form_present") for item in result["business_contact_pages"]))
        self.assertFalse(result["limits"]["phones_collected"])
        self.assertNotIn("+8613800000000", json.dumps(result))
        self.assertLessEqual(len({path for path in calls if path != "/robots.txt"}), 3)

    def test_robots_denial_prevents_target_page_fetch(self) -> None:
        calls: list[str] = []

        def fetcher(_host, _ip, path, **_kwargs):
            calls.append(path)
            body = b"User-agent: *\nDisallow: /contact-us\nAllow: /\n"
            if path == "/robots.txt":
                return {"status": 200, "headers": {"content-type": "text/plain"}, "body": body}
            if path == "/":
                html = b'<a href="/contact-us">Contact</a>'
                return {"status": 200, "headers": {"content-type": "text/html"}, "body": html}
            raise AssertionError("robots-denied page must not be fetched")

        result = company_site_reader.read_official_site(
            "https://supplier.example/", self.host,
            resolver=lambda _host: self.public_ip, fetcher=fetcher,
            sleeper=lambda _seconds: None,
        )
        self.assertTrue(any(item["status"] == "robots_denied" for item in result["pages_visited"]))
        self.assertNotIn("/contact-us", [path for path in calls if path != "/robots.txt"])

    def test_blocked_verification_page_is_not_parsed_as_a_contact_source(self) -> None:
        def fetcher(_host, _ip, path, **_kwargs):
            if path == "/robots.txt":
                return {"status": 200, "headers": {"content-type": "text/plain"},
                        "body": b"User-agent: *\nAllow: /\n"}
            return {"status": 200, "headers": {"content-type": "text/html"},
                    "body": b"<title>Verify you are human</title><a href='mailto:sales@example.com'>sales</a>"}

        result = company_site_reader.read_official_site(
            "https://supplier.example/", self.host,
            resolver=lambda _host: self.public_ip, fetcher=fetcher,
            sleeper=lambda _seconds: None,
        )
        self.assertEqual(result["status"], "no_readable_pages")
        self.assertEqual(result["contacts"], [])


class PlatformSearchTests(unittest.TestCase):
    def args(self, *, platform: list[str], lead_search: bool = False,
             confirm_qcc_cost: bool = False) -> object:
        from argparse import Namespace

        return Namespace(
            query="深圳家居企业", synonym=[], platform=platform,
            limit=10, window="background", timeout=2, weixin_pages=1, out=None,
            confirm_qcc_cost=confirm_qcc_cost, lead_search=lead_search,
            location="深圳", term=["沙发"], max_queries_per_source=2,
        )

    def test_1688_is_a_read_only_bounded_search_route(self) -> None:
        command = platform_search.search_command("1688", "深圳沙发工厂", 150,
                                                 "background")
        self.assertIn("--limit", command)
        self.assertIn("100", command)
        self.assertIn("--site-session", command)
        self.assertIn("ephemeral", command)

    def test_login_errors_are_saved_as_structured_adapter_errors(self) -> None:
        output = (
            "ok: false\nerror:\n  code: AUTH_REQUIRED\n"
            "  message: Please log in\n  help: Open 1688 in the shared browser\n"
            "exitCode: 77\n"
        )
        with patch.object(platform_search, "_run_opencli", return_value=(77, output, None)):
            result = platform_search.run_one_search(
                "opencli", "1688", "深圳沙发", 8, "background", 2,
            )
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["adapter_error"]["code"], "AUTH_REQUIRED")
        self.assertEqual(result["adapter_error"]["exit_code"], 77)

    def test_x_search_uses_the_verified_read_command_with_a_result_cap(self) -> None:
        command = platform_search.search_command("twitter", "open source crawler", 500,
                                                 "background")
        self.assertEqual(command[:5], ["twitter", "search", "open source crawler", "--limit", "100"])
        self.assertIn("--keep-tab", command)
        self.assertIn("false", command)

    def test_keyword_learning_requires_results_or_a_healthy_control(self) -> None:
        worked, weak, channels = platform_search.learning_signals([{
            "site_adapter": "twitter", "search_executed": True,
            "status": "control_ok_topic_zero",
            "query_results": [
                {"query": "深圳家居", "query_role": "topic", "status": "zero_results"},
                {"query": "open source", "query_role": "health_control", "status": "results_returned"},
            ],
        }])
        self.assertEqual(worked, [])
        self.assertEqual(weak, ["深圳家居"])
        self.assertEqual(channels, ["twitter"])
        failed = platform_search.learning_signals([{
            "site_adapter": "twitter", "search_executed": False,
            "status": "blocked", "query_results": [],
        }])
        self.assertEqual(failed, ([], [], []))

    def test_1688_keyword_learning_scores_category_and_location_relevance(self) -> None:
        records = [{
            "site_adapter": "1688", "search_executed": True,
            "query_results": [
                {
                    "query": "深圳 家居 源头厂家", "query_role": "topic",
                    "status": "results_returned", "result_count": 2,
                    "lead_candidates": [{"fields": {
                        "supplier_name": "深圳市服饰有限公司", "title": "深圳家居服套装",
                    }}],
                },
                {
                    "query": "深圳 家具 工厂", "query_role": "topic",
                    "status": "results_returned", "result_count": 1,
                    "lead_candidates": [{"fields": {
                        "supplier_name": "深圳市澄木纪家具有限公司", "title": "实木沙发工厂",
                    }}],
                },
            ],
        }]
        worked, weak, _channels = platform_search.learning_signals(
            records, lead_terms=["家居", "家具", "沙发"], location="深圳",
        )
        self.assertEqual(worked, ["深圳 家具 工厂"])
        self.assertEqual(weak, ["深圳 家居 源头厂家"])

    def test_qcc_without_credentials_does_not_call_api(self) -> None:
        output = io.StringIO()
        with patch.object(platform_search, "credentials_from_environment", return_value=None), \
             patch.object(platform_search, "fuzzy_search") as call, \
             patch("sys.stdout", output):
            code = platform_search.run(self.args(platform=["qichacha"]))
        result = json.loads(output.getvalue())
        self.assertEqual(code, 2)
        self.assertEqual(result["results"][0]["status"], "needs_credentials")
        call.assert_not_called()

    def test_qcc_confirmation_gate_and_candidate_normalization(self) -> None:
        credentials = qcc_client.QCCCredentials("app", "secret")
        without_confirmation = self.args(platform=["qichacha"])
        with patch.object(platform_search, "credentials_from_environment", return_value=credentials), \
             patch.object(platform_search, "fuzzy_search") as call, \
             patch("sys.stdout", io.StringIO()) as output:
            self.assertEqual(platform_search.run(without_confirmation), 2)
            self.assertEqual(json.loads(output.getvalue())["results"][0]["status"],
                             "confirmation_required")
        call.assert_not_called()

        confirmed = self.args(platform=["qichacha"], confirm_qcc_cost=True,
                              lead_search=True)
        output = io.StringIO()
        with patch.object(platform_search, "credentials_from_environment", return_value=credentials), \
             patch.object(platform_search, "fuzzy_search", return_value={
                 "records": [{"Name": "深圳示例家居有限公司", "PhoneNumber": "13800000000"}],
                 "estimated_cost_rmb": 0.10,
             }) as call, patch.object(platform_search, "record_event") as learn_call, \
             patch("sys.stdout", output):
            self.assertEqual(platform_search.run(confirmed), 0)
        call.assert_called_once()
        result = json.loads(output.getvalue())
        qcc_result = result["results"][0]["query_results"][0]
        self.assertIn("深圳", qcc_result["query"])
        self.assertEqual(qcc_result["lead_candidates"][0]["contacts"], [])
        self.assertNotIn("PhoneNumber", qcc_result["lead_candidates"][0]["fields"])
        self.assertTrue(result["experience_learning"]["recorded"])
        self.assertIn("worked_queries", learn_call.call_args.args[0])

    def test_1688_results_are_normalized_into_evidence_candidates(self) -> None:
        payload = [{
            "offer_id": "offer-1", "title": "深圳沙发工厂",
            "seller_name": "深圳示例家居厂",
            "item_url": "https://detail.1688.com/offer/offer-1.html",
        }]
        output = io.StringIO()
        with patch.object(platform_search.shutil, "which", return_value="opencli"), \
             patch.object(platform_search, "probe_opencli", return_value={
                 "bridge_connected": True,
                 "site_search": {"1688": {"search_available": True}},
             }), patch.object(platform_search, "run_one_search", return_value={
                 "query": "深圳家居企业", "query_role": "topic",
                 "status": "results_returned", "result_count": 1,
                 "raw_output": json.dumps(payload),
             }), patch.object(platform_search, "record_event"), patch("sys.stdout", output):
            self.assertEqual(platform_search.run(self.args(platform=["1688"])), 0)
        result = json.loads(output.getvalue())
        candidate = result["results"][0]["query_results"][0]["lead_candidates"][0]
        self.assertEqual(candidate["fields"]["supplier_name"], "深圳示例家居厂")
        self.assertEqual(candidate["sources"][0]["provider"], "1688_opencli")


if __name__ == "__main__":
    unittest.main()
