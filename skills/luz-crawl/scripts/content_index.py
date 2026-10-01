#!/usr/bin/env python3
"""Small local FTS index for finding prior research evidence and source metadata."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import re
from pathlib import Path
import sqlite3
from urllib.parse import urlparse

from luz_crawl_protocol import resolve_experience_root
from source_registry import normalize_platform, safe_source_url


MAX_EXCERPT_CHARS = 500
DATABASE_NAME = "content-index.sqlite"


def default_database() -> Path:
    return resolve_experience_root() / DATABASE_NAME


def connect(database: str | Path | None = None) -> sqlite3.Connection:
    path = Path(database or default_database()).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            doc_id TEXT PRIMARY KEY,
            platform TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT NOT NULL DEFAULT '',
            published TEXT NOT NULL DEFAULT '',
            url TEXT NOT NULL UNIQUE,
            source_path TEXT NOT NULL DEFAULT '',
            indexed_at TEXT NOT NULL
        )
    """)
    connection.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
            doc_id UNINDEXED, title, platform, author, excerpt,
            tokenize='unicode61 remove_diacritics 2'
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS document_feedback (
            url TEXT PRIMARY KEY,
            score REAL NOT NULL DEFAULT 0,
            positive_count INTEGER NOT NULL DEFAULT 0,
            negative_count INTEGER NOT NULL DEFAULT 0,
            last_action TEXT NOT NULL DEFAULT ''
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS feedback_events (
            event_id TEXT NOT NULL,
            url TEXT NOT NULL,
            action TEXT NOT NULL,
            weight REAL NOT NULL,
            recorded_at TEXT NOT NULL,
            PRIMARY KEY (event_id, url, action)
        )
    """)
    connection.commit()
    return connection


def _platform_for_document(item: dict) -> str:
    platform = str(item.get("platform", "")).strip()
    if platform:
        return normalize_platform(platform)
    host = urlparse(str(item.get("url", ""))).netloc.lower()
    if "github.com" in host:
        return "github"
    if "xiaohongshu.com" in host:
        return "xiaohongshu"
    if "zhihu.com" in host:
        return "zhihu"
    if "weixin.qq.com" in host or "sogou.com" in host:
        return "wechat"
    if "x.com" in host or "twitter.com" in host:
        return "x"
    return host.removeprefix("www.") or "web"


def _read_excerpt(item: dict, manifest_path: Path | None) -> str:
    value = next((item.get(key) for key in
                  ("excerpt", "snippet", "summary", "description", "text", "body")
                  if isinstance(item.get(key), str) and item.get(key).strip()), "")
    if not value and manifest_path and item.get("raw_file"):
        candidates = [manifest_path.parent / "raw" / str(item["raw_file"]),
                     manifest_path.parent / str(item["raw_file"])]
        raw_path = next((path for path in candidates if path.is_file()), None)
        if raw_path:
            raw_text = raw_path.read_text(encoding="utf-8", errors="replace")
            value = raw_text.split("---", 1)[-1]
    return re.sub(r"\s+", " ", str(value)).strip()[:MAX_EXCERPT_CHARS]


def _document(item: dict, manifest_path: Path | None = None) -> dict | None:
    url = safe_source_url(str(item.get("url") or item.get("source_url") or item.get("html_url") or ""))
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    platform = _platform_for_document({**item, "url": url})
    # Keep X source URLs only until its current developer terms have been checked.
    restricted = platform in {"x", "twitter"}
    excerpt = "" if restricted else _read_excerpt(item, manifest_path)
    title = "" if restricted else str(item.get("title") or item.get("name") or "").strip()
    author = "" if restricted else str(item.get("author") or item.get("owner") or item.get("author_name") or "").strip()
    published = "" if restricted else str(item.get("published") or item.get("created_at") or item.get("date") or "").strip()
    source_path = str(item.get("source_path") or item.get("path") or "").strip()
    if restricted:
        source_path = ""
    elif not source_path and manifest_path and item.get("raw_file"):
        candidate = manifest_path.parent / "raw" / str(item["raw_file"])
        if candidate.is_file():
            source_path = str(candidate.resolve())
    canonical_url = url
    doc_id = hashlib.sha256(canonical_url.encode("utf-8")).hexdigest()
    return {
        "doc_id": doc_id,
        "platform": platform,
        "title": title[:500],
        "author": author[:200],
        "published": published[:100],
        "url": canonical_url,
        "source_path": source_path[:1000],
        "excerpt": excerpt,
    }


def index_documents(documents: list[dict], database: str | Path | None = None,
                    manifest_path: str | Path | None = None) -> int:
    path = Path(manifest_path).resolve() if manifest_path else None
    connection = connect(database)
    indexed = 0
    try:
        for raw in documents:
            if not isinstance(raw, dict):
                continue
            item = _document(raw, path)
            if not item:
                continue
            connection.execute("""
                INSERT INTO documents
                  (doc_id, platform, title, author, published, url, source_path, indexed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(url) DO UPDATE SET
                  doc_id=excluded.doc_id, platform=excluded.platform,
                  title=excluded.title, author=excluded.author,
                  published=excluded.published, source_path=excluded.source_path,
                  indexed_at=excluded.indexed_at
            """, (item["doc_id"], item["platform"], item["title"], item["author"],
                  item["published"], item["url"], item["source_path"],
                  datetime.now(timezone.utc).isoformat()))
            connection.execute("DELETE FROM documents_fts WHERE doc_id = ?", (item["doc_id"],))
            connection.execute("""
                INSERT INTO documents_fts(doc_id, title, platform, author, excerpt)
                VALUES (?, ?, ?, ?, ?)
            """, (item["doc_id"], item["title"], item["platform"],
                  item["author"], item["excerpt"]))
            indexed += 1
        connection.commit()
    finally:
        connection.close()
    return indexed


def documents_from_manifest(manifest_path: str | Path) -> list[dict]:
    path = Path(manifest_path).expanduser().resolve()
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        collections = [("articles", payload)]
        defaults: dict = {}
    elif not isinstance(payload, dict):
        raise ValueError("manifest must be a JSON object or list")
    else:
        collections = [(key, payload.get(key)) for key in
                       ("sources", "articles", "results", "items", "repositories")]
        defaults = {
            key: payload[key] for key in ("platform", "title")
            if isinstance(payload.get(key), str) and payload[key].strip()
        }

    # Existing Luz Crawl manifests store source URLs as strings, while newer
    # research outputs may store full per-source metadata objects. Accept both
    # formats and merge duplicate URLs so richer item metadata wins.
    merged: dict[str, dict] = {}
    for collection, values in collections:
        if not isinstance(values, list):
            continue
        for raw in values:
            if isinstance(raw, dict):
                item = dict(raw)
            elif collection == "sources" and isinstance(raw, str):
                item = {**defaults, "url": raw}
            else:
                continue
            url = safe_source_url(str(
                item.get("url") or item.get("source_url") or item.get("html_url") or ""
            ))
            if not url:
                continue
            current = merged.setdefault(url, {"url": url})
            for key, value in item.items():
                if key in {"url", "source_url", "html_url"}:
                    continue
                if value not in (None, "", [], {}):
                    current[key] = value
    return list(merged.values())


def index_manifest(manifest_path: str | Path,
                   database: str | Path | None = None) -> int:
    path = Path(manifest_path).expanduser().resolve()
    return index_documents(documents_from_manifest(path), database, path)


FEEDBACK_WEIGHTS = {
    "preferred": 1.0,
    "saved": 1.5,
    "opened": 0.25,
    "rejected": -2.0,
    "corrected": -1.5,
}


def record_feedback(feedback: list[dict], database: str | Path | None = None,
                    event_id: str = "") -> int:
    """Persist only source-level ranking signals with a canonical HTTP URL."""
    if not event_id.strip():
        raise ValueError("event_id is required for idempotent feedback recording")
    connection = connect(database)
    recorded = 0
    try:
        for item in feedback:
            if not isinstance(item, dict):
                continue
            action = str(item.get("action", "")).strip().lower()
            url = safe_source_url(str(item.get("item", "")))
            parsed = urlparse(url)
            weight = FEEDBACK_WEIGHTS.get(action)
            if weight is None or parsed.scheme not in {"http", "https"} or not parsed.netloc:
                continue
            inserted = connection.execute("""
                INSERT OR IGNORE INTO feedback_events(event_id, url, action, weight, recorded_at)
                VALUES (?, ?, ?, ?, ?)
            """, (event_id, url, action, weight, datetime.now(timezone.utc).isoformat()))
            if inserted.rowcount:
                aggregate = connection.execute("""
                    SELECT COALESCE(SUM(weight), 0),
                           COALESCE(SUM(CASE WHEN weight > 0 THEN 1 ELSE 0 END), 0),
                           COALESCE(SUM(CASE WHEN weight < 0 THEN 1 ELSE 0 END), 0)
                    FROM feedback_events WHERE url = ?
                """, (url,)).fetchone()
                connection.execute("""
                    INSERT INTO document_feedback(url, score, positive_count, negative_count, last_action)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(url) DO UPDATE SET
                      score=excluded.score,
                      positive_count=excluded.positive_count,
                      negative_count=excluded.negative_count,
                      last_action=excluded.last_action
                """, (url, max(-5.0, min(5.0, float(aggregate[0]))),
                      int(aggregate[1]), int(aggregate[2]), action))
                recorded += 1
        connection.commit()
    finally:
        connection.close()
    return recorded


def _fts_query(query: str) -> str:
    tokens = re.findall(r"[\w\u4e00-\u9fff]+", query.lower())
    if not tokens:
        return ""
    return " OR ".join('"' + token.replace('"', '""') + '"' for token in dict.fromkeys(tokens))


def _personalize(rows: list[sqlite3.Row], limit: int) -> list[dict]:
    values = [dict(row) for row in rows]
    if not values:
        return []
    ranks = [float(item.get("rank", 0.0)) for item in values]
    best, worst = min(ranks), max(ranks)
    spread = worst - best
    for item in values:
        rank = float(item.get("rank", 0.0))
        lexical = 1.0 if spread == 0 else (worst - rank) / spread
        feedback = max(-5.0, min(5.0, float(item.get("personalization_score", 0.0))))
        item["lexical_score"] = round(lexical, 4)
        item["personalized_score"] = round(lexical + feedback * 0.05, 4)
    values.sort(key=lambda item: (-item["personalized_score"],
                                  -item["lexical_score"], item["url"]))
    return values[:max(1, limit)]


def search_index(query: str, database: str | Path | None = None,
                 limit: int = 10) -> list[dict]:
    match = _fts_query(query)
    if not match:
        return []
    connection = connect(database)
    try:
        rows = connection.execute("""
            SELECT d.platform, d.title, d.author, d.published, d.url, d.source_path,
                   snippet(documents_fts, 4, '[', ']', ' … ', 12) AS excerpt,
                   COALESCE(f.score, 0) AS personalization_score,
                   bm25(documents_fts) AS rank
            FROM documents_fts
            JOIN documents d ON d.doc_id = documents_fts.doc_id
            LEFT JOIN document_feedback f ON f.url = d.url
            WHERE documents_fts MATCH ?
            ORDER BY rank, d.indexed_at DESC
            LIMIT ?
        """, (match, max(1, limit * 5))).fetchall()
        if rows:
            return _personalize(rows, limit)

        # FTS tokenization for CJK varies by SQLite build; token-wise substring
        # matching keeps multi-term searches useful without a segmenter.
        tokens = list(dict.fromkeys(re.findall(r"[\w\u4e00-\u9fff]+", query.lower())))[:20]
        if not tokens:
            return []
        fields = ("d.title", "d.author", "d.platform", "f.excerpt")
        token_patterns = [f"%{token}%" for token in tokens]
        token_match = " OR ".join(
            "(" + " OR ".join(f"{field} LIKE ?" for field in fields) + ")"
            for _token in tokens
        )
        score_terms = [
            "CASE WHEN (" + " OR ".join(f"{field} LIKE ?" for field in fields)
            + ") THEN 1 ELSE 0 END"
            for _token in tokens
        ]
        score_expr = "(" + " + ".join(score_terms) + ")"
        where_params = [pattern for pattern in token_patterns for _field in fields]
        score_params = [pattern for pattern in token_patterns for _field in fields]
        fallback = connection.execute("""
            SELECT d.platform, d.title, d.author, d.published, d.url, d.source_path,
                   f.excerpt AS excerpt, COALESCE(fb.score, 0) AS personalization_score,
                   -""" + score_expr + """ AS rank
            FROM documents d
            JOIN documents_fts f ON f.doc_id = d.doc_id
            LEFT JOIN document_feedback fb ON fb.url = d.url
            WHERE """ + token_match + """
            ORDER BY rank ASC, d.indexed_at DESC
            LIMIT ?
        """, (*score_params, *where_params, max(1, limit * 5))).fetchall()
        return _personalize(fallback, limit)
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", help="Override local SQLite index path")
    subparsers = parser.add_subparsers(dest="command", required=True)
    index_parser = subparsers.add_parser("index-manifest")
    index_parser.add_argument("manifest")
    search_parser = subparsers.add_parser("search")
    search_parser.add_argument("query")
    search_parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()
    database = Path(args.database).expanduser().resolve() if args.database else default_database()
    if args.command == "index-manifest":
        count = index_manifest(args.manifest, database)
        print(json.dumps({"indexed": count, "database": str(database)}, ensure_ascii=False, indent=2))
        return 0
    results = search_index(args.query, database, args.limit)
    print(json.dumps({"query": args.query, "results": results,
                      "database": str(database)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
