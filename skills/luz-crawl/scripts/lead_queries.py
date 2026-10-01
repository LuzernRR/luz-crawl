#!/usr/bin/env python3
"""Build source-specific enterprise prospecting queries from intent and history."""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Callable

from experience_store import query_store


SOURCE_ORDER = (
    "1688", "qichacha", "gsxt", "official_web",
    "xiaohongshu", "zhihu", "wechat", "x",
)


def _clean(value: str, *, limit: int = 120) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())[:limit]


def _key(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", (value or "").lower())


def _unique(values: list[str], limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = _clean(value)
        key = _key(cleaned)
        if cleaned and key and key not in seen:
            seen.add(key)
            out.append(cleaned)
        if len(out) >= limit:
            break
    return out


def _history_for_intent(intent: str, history_lookup: Callable | None) -> dict:
    if history_lookup is None:
        return query_store(intent)
    return history_lookup(intent)


def build_query_plan(
    topic: str,
    *,
    location: str = "",
    terms: list[str] | None = None,
    max_queries_per_source: int = 4,
    history_lookup: Callable | None = None,
) -> dict:
    """Create bounded, source-specific query variants and apply past outcomes.

    Qichacha receives one conservative search key because its fuzzy-search API
    is billable per request. Old queries are reused only when they overlap the
    current topic/location and do not exactly match a recorded weak query.
    """
    topic = _clean(topic)
    location = _clean(location, limit=80)
    if not topic:
        raise ValueError("topic is required")
    if not 1 <= max_queries_per_source <= 12:
        raise ValueError("max_queries_per_source must be between 1 and 12")

    explicit_terms = _unique(terms or [], 8)
    concepts = _unique([*explicit_terms, topic], 8)
    base = _clean(" ".join([location, topic, *explicit_terms[:1]]), limit=100)
    intent = _clean(" ".join([location, topic, *concepts]), limit=240)

    generated: dict[str, list[str]] = {source: [] for source in SOURCE_ORDER}
    # Keep the original intent and every explicit product term visible in the
    # bounded first-round plan. Put one diverse core query per term before
    # learned expansions so broad variants cannot crowd out "沙发"/"床" etc.
    lead_1688_primary: list[str] = []
    if explicit_terms:
        lead_1688_primary.append(_clean(
            f"{location} {topic} {explicit_terms[0]} 工厂", limit=180,
        ))
        lead_1688_primary.extend(
            _clean(f"{location} {term} 工厂", limit=180)
            for term in explicit_terms[1:]
        )
    else:
        lead_1688_primary.append(_clean(f"{location} {topic} 工厂", limit=180))
    generated["1688"].extend(lead_1688_primary)
    for concept in concepts[:3]:
        generated["1688"].extend([
            _clean(f"{location} {concept} 源头厂家"),
            _clean(f"{location} {concept} OEM ODM"),
        ])
    # Avoid multiplying billable API calls: one search key returns up to five
    # records under the published Qichacha fuzzy-search contract.
    generated["qichacha"] = [_clean(base, limit=100)]
    generated["gsxt"].extend([
        _clean(f'site:gsxt.gov.cn "{location}" "{concept}" 企业')
        for concept in concepts[:2]
    ])
    # The two templates above are emitted per concept, keeping product and
    # industry terms distinct for external search engines.
    for concept in concepts[:3]:
        generated["official_web"].extend([
            _clean(f'"{location}" "{concept}" 企业 官网 联系我们'),
            _clean(f'"{location}" "{concept}" 商务合作 联系方式'),
        ])
    for source in ("xiaohongshu", "zhihu", "wechat", "x"):
        for concept in concepts[:2]:
            generated[source].extend([
                _clean(f"{location} {concept} 工厂"),
                _clean(f"{location} {concept} 供应商"),
            ])

    history = _history_for_intent(intent, history_lookup)
    hints = history.get("keyword_hints", {}) if isinstance(history, dict) else {}
    worked = list(hints.get("worked_queries", []))
    weak = {_key(item) for item in hints.get("weak_queries", []) if _key(item)}
    core_keys = [_key(item) for item in [location, *concepts] if _key(item)]
    reused: list[dict] = []
    skipped_weak: list[str] = []

    def relevant(query: str) -> bool:
        normalized = _key(query)
        return bool(normalized and any(key in normalized or normalized in key
                                       for key in core_keys if len(key) >= 2))

    for old_query in worked:
        old_query = _clean(old_query)
        normalized = _key(old_query)
        if not relevant(old_query):
            continue
        if normalized in weak:
            skipped_weak.append(old_query)
            continue
        lowered = old_query.lower()
        if "1688" in lowered or any(word in old_query for word in ("工厂", "厂家", "供应商", "OEM", "ODM")):
            sources = ("1688",)
        elif "gsxt.gov.cn" in lowered or "qcc.com" in lowered:
            sources = ("gsxt", "official_web")
        else:
            sources = ("official_web", "xiaohongshu", "zhihu", "wechat", "x")
        for source in sources:
            if source == "qichacha":
                continue
            if old_query not in generated[source]:
                # Keep user-specified 1688 product coverage first; learned
                # query shapes should replace generic expansions, not products.
                if source == "1688":
                    generated[source].insert(min(len(lead_1688_primary),
                                                  len(generated[source])), old_query)
                else:
                    generated[source].insert(0, old_query)
                reused.append({"source": source, "query": old_query})

    # Remove exact weak queries and cap each route independently. Search tools
    # can still receive several variants, while Qichacha remains one call.
    for source in SOURCE_ORDER:
        generated[source] = [query for query in _unique(
            generated[source], max_queries_per_source + 4
        ) if _key(query) not in weak]
        generated[source] = generated[source][:1 if source == "qichacha"
                                               else max_queries_per_source]

    return {
        "schema_version": 1,
        "intent": intent,
        "location": location,
        "terms": concepts,
        "queries_by_source": generated,
        "learning": {
            "matched_runs": hints.get("matched_runs", []),
            "reused_worked_queries": reused,
            "skipped_weak_queries": _unique(skipped_weak, 12),
            "preferences": history.get("preferences", []) if isinstance(history, dict) else [],
        },
        "limits": {
            "max_queries_per_source": max_queries_per_source,
            "qichacha_requests_per_plan": 1,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("topic")
    parser.add_argument("--location", default="")
    parser.add_argument("--term", action="append", default=[])
    parser.add_argument("--max-per-source", type=int, default=4)
    args = parser.parse_args()
    try:
        result = build_query_plan(
            args.topic, location=args.location, terms=args.term,
            max_queries_per_source=args.max_per_source,
        )
    except ValueError as exc:
        parser.error(str(exc))
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
