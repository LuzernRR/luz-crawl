#!/usr/bin/env python3
"""Read a few public pages from an explicitly approved company website.

The reader never follows redirects, submits forms, reads browser cookies, or
collects phone numbers. It obeys robots.txt and only extracts role mailboxes
and contact-page links from the exact approved HTTPS host.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import http.client
import ipaddress
import json
import re
import socket
import ssl
import sys
import time
from typing import Callable
from urllib.parse import quote, unquote, urljoin, urlsplit
from urllib.robotparser import RobotFileParser

USER_AGENT = "LuzCrawlResearchBot/1.0"
MAX_PAGE_BYTES = 1_000_000
MAX_ROBOTS_BYTES = 128_000
MAX_PAGES = 3
MAX_REDIRECTS = 0
CONTACT_ROOTS = {
    "contact", "contacts", "contact-us", "contactus", "about", "about-us",
    "company", "business", "sales", "inquiry", "inquiries", "合作", "联系",
}
ROLE_MAILBOXES = {
    "business", "contact", "export", "info", "inquiry", "marketing",
    "sales", "service", "support",
}
BLOCK_SIGNALS = (
    "captcha", "access denied", "unusual traffic", "verify you are human",
    "challenge-platform", "访问验证", "验证码", "异常流量", "请求过于频繁",
)


class SiteReadError(RuntimeError):
    """A bounded public-site fetch failed closed."""


def _host(value: str) -> str:
    return value.strip().rstrip(".").encode("idna").decode("ascii").lower()


def _normalized_path(path: str) -> str:
    decoded = unquote(path or "/")
    if "\\" in decoded or any(ord(char) < 32 for char in decoded):
        raise SiteReadError("unsafe_path")
    parts = [part for part in decoded.split("/") if part]
    if any(part in {".", ".."} for part in parts):
        raise SiteReadError("unsafe_path")
    normalized = "/" + "/".join(parts) if parts else "/"
    return quote(normalized, safe="/%:@!$&'()*+,;=-._~")


def validate_target(url: str, approved_host: str) -> tuple[str, str]:
    """Require HTTPS, exact host approval, default port, and a bounded path."""
    try:
        parsed = urlsplit(url.strip())
        host = _host(parsed.hostname or "")
        allowed = _host(approved_host)
        port = parsed.port
    except (ValueError, UnicodeError):
        raise SiteReadError("invalid_url") from None
    if (parsed.scheme.lower() != "https" or not host or parsed.username or parsed.password
            or port not in (None, 443) or host != allowed or parsed.fragment):
        raise SiteReadError("host_or_scheme_not_approved")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None:
        raise SiteReadError("ip_literal_host_not_allowed")
    path = _normalized_path(parsed.path)
    if len(path) > 512:
        raise SiteReadError("path_too_long")
    # Query parameters are omitted so the saved URL cannot retain tracking,
    # session, or signed values from a search result.
    return host, path


def _is_contact_path(path: str) -> bool:
    normalized = unquote(_normalized_path(path)).lower()
    first = normalized.strip("/").split("/", 1)[0]
    return normalized == "/" or first in CONTACT_ROOTS


def resolve_public_ip(host: str) -> str:
    """Resolve once and pin a globally routable address for the TLS request."""
    try:
        answers = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError:
        raise SiteReadError("dns_resolution_failed") from None
    addresses = list(dict.fromkeys(answer[4][0] for answer in answers))
    if not addresses:
        raise SiteReadError("dns_no_addresses")
    for value in addresses:
        try:
            parsed = ipaddress.ip_address(value)
        except ValueError:
            raise SiteReadError("dns_invalid_address") from None
        if not parsed.is_global:
            raise SiteReadError("dns_resolved_to_non_public_address")
    return addresses[0]


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, pinned_ip: str, timeout: float):
        super().__init__(host, port=443, timeout=timeout, context=ssl.create_default_context())
        self._pinned_ip = pinned_ip

    def connect(self) -> None:
        if self._tunnel_host:
            raise SiteReadError("proxy_tunnel_not_supported")
        raw = socket.create_connection((self._pinned_ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(raw, server_hostname=self.host)


def _fetch_pinned(host: str, pinned_ip: str, path: str, *,
                  timeout: float, max_bytes: int) -> dict:
    connection = _PinnedHTTPSConnection(host, pinned_ip, timeout)
    try:
        connection.request("GET", path, headers={
            "Host": host,
            "User-Agent": USER_AGENT,
            "Accept": "text/html, text/plain;q=0.9",
            "Accept-Encoding": "identity",
            "Connection": "close",
        })
        response = connection.getresponse()
        if response.status in {301, 302, 303, 307, 308}:
            raise SiteReadError("redirect_not_followed")
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise SiteReadError("response_too_large")
        headers = {key.lower(): value for key, value in response.getheaders()}
        if headers.get("content-encoding", "identity").lower() not in {"", "identity"}:
            raise SiteReadError("compressed_response_rejected")
        return {"status": response.status, "headers": headers, "body": body}
    except SiteReadError:
        raise
    except (OSError, ssl.SSLError, http.client.HTTPException, TimeoutError) as exc:
        raise SiteReadError(f"transport_{type(exc).__name__}") from None
    finally:
        connection.close()


def _decode(body: bytes, content_type: str) -> str:
    match = re.search(r"charset\s*=\s*['\"]?([\w.-]+)", content_type, re.IGNORECASE)
    encoding = match.group(1) if match else "utf-8"
    try:
        return body.decode(encoding, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


class _PublicPageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self._anchor: dict | None = None
        self.links: list[dict[str, str]] = []
        self.has_form = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag.lower() == "title":
            self._in_title = True
        elif tag.lower() == "a":
            self._anchor = {"href": values.get("href") or "", "text": ""}
        elif tag.lower() == "form":
            self.has_form = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False
        elif tag.lower() == "a" and self._anchor is not None:
            self._anchor["text"] = re.sub(r"\s+", " ", self._anchor["text"]).strip()
            self.links.append(self._anchor)
            self._anchor = None

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._anchor is not None:
            self._anchor["text"] += data


def _robots_allows(host: str, pinned_ip: str, path: str, *, timeout: float,
                   fetcher: Callable) -> tuple[bool, dict]:
    response = fetcher(host, pinned_ip, "/robots.txt", timeout=timeout,
                       max_bytes=MAX_ROBOTS_BYTES)
    status = response["status"]
    evidence = {"status": status, "url": f"https://{host}/robots.txt"}
    if status == 404:
        evidence["decision"] = "no_robots_file"
        return True, evidence
    if status != 200:
        raise SiteReadError("robots_unavailable_or_blocked")
    content_type = response["headers"].get("content-type", "").lower()
    if "text/plain" not in content_type and "text/" not in content_type:
        raise SiteReadError("robots_content_type_invalid")
    body = _decode(response["body"], content_type)
    parser = RobotFileParser()
    parser.set_url(f"https://{host}/robots.txt")
    parser.parse(body.splitlines())
    allowed = parser.can_fetch(USER_AGENT, path)
    evidence["decision"] = "allowed" if allowed else "disallowed"
    return allowed, evidence


def _blocked_page(text: str) -> bool:
    sample = text[:100_000].lower()
    return any(signal in sample for signal in BLOCK_SIGNALS)


def _business_email(value: str) -> str | None:
    address = value.strip().lower()
    if len(address) > 254 or address.count("@") != 1:
        return None
    local, domain = address.rsplit("@", 1)
    if local not in ROLE_MAILBOXES or "." not in domain or ".." in address:
        return None
    if not re.fullmatch(r"[a-z0-9._%+-]+", local) or not re.fullmatch(r"[a-z0-9.-]+", domain):
        return None
    return address


def read_official_site(
    url: str,
    approved_host: str,
    *,
    max_pages: int = MAX_PAGES,
    timeout: float = 8.0,
    resolver: Callable[[str], str] = resolve_public_ip,
    fetcher: Callable = _fetch_pinned,
    sleeper: Callable[[float], None] = time.sleep,
) -> dict:
    """Read a homepage and at most two linked contact/about pages, read-only."""
    if not 1 <= max_pages <= MAX_PAGES:
        raise ValueError(f"max_pages must be between 1 and {MAX_PAGES}")
    if not 0.5 <= timeout <= 30:
        raise ValueError("timeout must be between 0.5 and 30 seconds")
    host, start_path = validate_target(url, approved_host)
    if not _is_contact_path(start_path):
        raise SiteReadError("path_not_approved_for_company_contact_read")
    pinned_ip = resolver(host)
    try:
        parsed_ip = ipaddress.ip_address(pinned_ip)
    except ValueError:
        raise SiteReadError("dns_invalid_address") from None
    if not parsed_ip.is_global:
        raise SiteReadError("dns_resolved_to_non_public_address")

    last_request_at = 0.0

    def paced_fetch(fetch_host: str, ip: str, path: str, *,
                    timeout: float, max_bytes: int) -> dict:
        nonlocal last_request_at
        if last_request_at:
            sleeper(max(0.0, 1.0 - (time.monotonic() - last_request_at)))
        response = fetcher(fetch_host, ip, path, timeout=timeout, max_bytes=max_bytes)
        last_request_at = time.monotonic()
        return response

    robots_ok, robots_evidence = _robots_allows(
        host, pinned_ip, start_path, timeout=timeout, fetcher=paced_fetch,
    )
    base_url = f"https://{host}{start_path}"
    if not robots_ok:
        return {
            "schema_version": 1, "status": "robots_denied", "source_url": base_url,
            "robots": robots_evidence, "pages_visited": [], "contacts": [],
            "business_contact_pages": [],
        }

    queue = [start_path]
    visited: set[str] = set()
    pages: list[dict] = []
    contacts: list[dict] = []
    contact_pages: list[dict] = []
    while queue and len(visited) < max_pages:
        path = queue.pop(0)
        if path in visited:
            continue
        visited.add(path)
        allowed, page_robots = _robots_allows(
            host, pinned_ip, path, timeout=timeout, fetcher=paced_fetch,
        )
        if not allowed:
            pages.append({"url": f"https://{host}{path}", "status": "robots_denied",
                          "robots": page_robots})
            continue
        response = paced_fetch(host, pinned_ip, path, timeout=timeout,
                               max_bytes=MAX_PAGE_BYTES)
        response_status = response["status"]
        page_url = f"https://{host}{path}"
        if response_status != 200:
            pages.append({"url": page_url, "status": f"http_{response_status}"})
            continue
        headers = response["headers"]
        content_type = headers.get("content-type", "").lower()
        if "text/html" not in content_type:
            pages.append({"url": page_url, "status": "non_html_rejected"})
            continue
        html = _decode(response["body"], content_type)
        if _blocked_page(html):
            pages.append({"url": page_url, "status": "blocked_page_rejected"})
            continue
        parser = _PublicPageParser()
        try:
            parser.feed(html)
        except Exception:
            pages.append({"url": page_url, "status": "parser_error"})
            continue
        pages.append({
            "url": page_url,
            "status": "readable",
            "title": re.sub(r"\s+", " ", parser.title).strip()[:200],
            "bytes": len(response["body"]),
            "parser": "stdlib_htmlparser_v1",
        })
        for link in parser.links:
            href = link.get("href", "").strip()
            anchor_text = link.get("text", "")[:120]
            if href.lower().startswith("mailto:"):
                email_raw = href[7:].split("?", 1)[0]
                email = _business_email(email_raw)
                if email and not any(item["value"] == email for item in contacts):
                    contacts.append({
                        "type": "role_mailbox_email",
                        "value": email,
                        "source_url": page_url,
                        "observed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        "evidence_context": "role-based mailto address visibly linked on approved company site",
                    })
                continue
            if not href or href.startswith(("#", "javascript:", "tel:")):
                continue
            absolute = urljoin(page_url, href)
            try:
                link_host, link_path = validate_target(absolute, host)
            except SiteReadError:
                continue
            if link_host != host or not _is_contact_path(link_path):
                continue
            if link_path not in visited and link_path not in queue and len(visited) + len(queue) < max_pages:
                queue.append(link_path)
            if link_path != "/" and not any(item["url"] == f"https://{host}{link_path}"
                                             for item in contact_pages):
                contact_pages.append({
                    "url": f"https://{host}{link_path}",
                    "anchor_text": anchor_text,
                    "source_url": page_url,
                })
        if parser.has_form and (_is_contact_path(path) and path != "/"):
            existing_page = next((item for item in contact_pages
                                  if item["url"] == page_url), None)
            if existing_page:
                existing_page["form_present"] = True
            else:
                contact_pages.append({
                    "url": page_url, "anchor_text": "form_present",
                    "source_url": page_url, "form_present": True,
                })

    return {
        "schema_version": 1,
        "status": "readable" if any(item["status"] == "readable" for item in pages)
        else "no_readable_pages",
        "source_url": base_url,
        "robots": robots_evidence,
        "pages_visited": pages,
        "contacts": contacts,
        "business_contact_pages": contact_pages,
        "limits": {
            "max_pages": max_pages,
            "redirects_followed": MAX_REDIRECTS,
            "phones_collected": False,
            "form_submissions": 0,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="HTTPS homepage/contact-page URL from an already verified company source")
    parser.add_argument("--approved-host", required=True,
                        help="Exact company host approved for this read; wildcards are not accepted")
    parser.add_argument("--max-pages", type=int, default=MAX_PAGES)
    parser.add_argument("--timeout", type=float, default=8.0,
                        help="Per-request timeout in seconds (0.5-30)")
    args = parser.parse_args()
    try:
        result = read_official_site(
            args.url, args.approved_host, max_pages=args.max_pages, timeout=args.timeout,
        )
    except (SiteReadError, ValueError) as exc:
        json.dump({"status": "rejected_or_unavailable", "reason": str(exc)},
                  sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 2
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["status"] == "readable" else 2


if __name__ == "__main__":
    raise SystemExit(main())
