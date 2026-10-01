#!/usr/bin/env python3
"""Normalize enterprise/supplier search candidates with field-level evidence."""

from __future__ import annotations

from datetime import datetime, timezone
import copy
import hashlib
import re
from typing import Any
from urllib.parse import urlsplit

from source_registry import safe_source_url


QCC_FUZZY_SOURCE = "https://openapi.qcc.com/dataApi/886"
_LIST_KEYS = ("results", "items", "offers", "products", "records", "Result", "Data", "data")
_ROLE_MAILBOX_NAMES = {
    "business", "contact", "export", "info", "inquiry", "marketing",
    "sales", "service", "support",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _text(value: Any, limit: int = 300) -> str | None:
    if value is None or isinstance(value, (dict, list)):
        return None
    normalized = re.sub(r"\s+", " ", str(value)).strip()
    return normalized[:limit] or None


def _first(item: dict, *keys: str) -> Any:
    for key in keys:
        if key in item and item[key] not in (None, ""):
            return item[key]
    return None


def _rows(payload: Any, *, depth: int = 0) -> list[dict]:
    if depth > 5:
        return []
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    identity_keys = {"offer_id", "offerId", "seller_name", "store_name", "CreditCode", "Name"}
    if identity_keys.intersection(payload):
        return [payload]
    for key in _LIST_KEYS:
        if key in payload:
            result = _rows(payload[key], depth=depth + 1)
            if result:
                return result
    # Some wrappers put the record list under a provider-specific envelope.
    for value in payload.values():
        result = _rows(value, depth=depth + 1)
        if result:
            return result
    return []


def _is_1688_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urlsplit(value)
    host = (parsed.hostname or "").lower().rstrip(".")
    return parsed.scheme == "https" and (host == "1688.com" or host.endswith(".1688.com"))


def _candidate_id(provider: str, identity: str) -> str:
    digest = hashlib.sha256(f"{provider}\0{identity}".encode("utf-8")).hexdigest()[:24]
    return f"{provider}:{digest}"


def _business_mailbox(value: str | None) -> str | None:
    normalized = (value or "").strip().lower()
    if len(normalized) > 254 or normalized.count("@") != 1:
        return None
    local, domain = normalized.rsplit("@", 1)
    if (local not in _ROLE_MAILBOX_NAMES or "." not in domain
            or not re.fullmatch(r"[a-z0-9.-]+", domain) or ".." in domain):
        return None
    return normalized


def parse_1688_candidates(payload: Any, *, query: str,
                          observed_at: str | None = None) -> list[dict]:
    """Map OpenCLI 1688 search rows to product/supplier candidates.

    Product price and MOQ remain product-level display fields. Search cards do
    not establish a supplier's legal company identity or a business contact.
    """
    timestamp = observed_at or utc_now()
    candidates: list[dict] = []
    for item in _rows(payload):
        offer_id = _text(_first(item, "offer_id", "offerId", "offerIdStr", "id"), 100)
        item_url = safe_source_url(_text(_first(
            item, "item_url", "url", "offer_url", "detail_url", "itemUrl"), 2048) or "")
        if not _is_1688_url(item_url):
            continue
        supplier_name = _text(_first(item, "seller_name", "store_name", "supplier_name",
                                      "sellerName", "storeName"), 240)
        title = _text(_first(item, "title", "product_title", "subject", "productName"), 500)
        if not supplier_name and not title:
            continue
        member_id = _text(_first(item, "member_id", "memberId", "seller_id", "sellerId"), 160)
        seller_url = safe_source_url(_text(_first(
            item, "seller_url", "store_url", "shop_url", "sellerUrl", "storeUrl"), 2048) or "")
        if seller_url and not _is_1688_url(seller_url):
            seller_url = None
        source_identity = member_id or offer_id or item_url
        evidence = {
            "provider": "1688_opencli",
            "route": "opencli/1688:search",
            "query": _text(query, 240),
            "url": item_url,
            "observed_at": timestamp,
        }
        fields = {
            "title": title,
            "supplier_name": supplier_name,
            "member_id": member_id,
            "item_url": item_url,
            "seller_url": seller_url,
            "location": _text(_first(item, "location", "seller_location", "area"), 160),
            "product_price_text": _text(_first(item, "price_text", "price", "priceText"), 120),
            "product_moq_text": _text(_first(item, "moq_text", "moq", "quantityText"), 120),
            "offer_id": offer_id,
        }
        fields = {key: value for key, value in fields.items() if value is not None}
        candidates.append({
            "schema_version": 1,
            "candidate_id": _candidate_id("1688", source_identity),
            "entity_type": "supplier_candidate",
            "company_name": _text(_first(item, "company_name", "legal_name"), 240),
            "credit_code": None,
            "fields": fields,
            "field_evidence": {key: [evidence] for key in fields},
            "contacts": [],
            "sources": [evidence],
            "confidence": "discovery_candidate",
        })
    return candidates


def _qcc_rows(payload: Any) -> list[dict]:
    if isinstance(payload, dict):
        result = _first(payload, "Result", "Data", "result", "data")
        if result is not None:
            return _rows(result)
    return _rows(payload)


def parse_qcc_candidates(payload: Any, *, query: str,
                         observed_at: str | None = None) -> list[dict]:
    """Whitelist company fields from Qichacha fuzzy-search responses.

    Personal contact/person fields and phone values are intentionally ignored.
    QCC fuzzy search (ApiCode 886) does not certify any contact as a business
    lead channel; contact enrichment is a separate evidence step.
    """
    timestamp = observed_at or utc_now()
    candidates: list[dict] = []
    for item in _qcc_rows(payload)[:5]:
        name = _text(_first(item, "Name", "name", "CompanyName", "company_name"), 300)
        credit_code = _text(_first(item, "CreditCode", "credit_code", "UnifiedSocialCreditCode"), 80)
        if not name:
            continue
        fields = {
            "company_name": name,
            "credit_code": credit_code,
            "registered_address": _text(_first(item, "Address", "address"), 300),
            "registration_status": _text(_first(item, "Status", "status"), 120),
            "established_date": _text(_first(item, "StartDate", "start_date"), 40),
            "registration_number": _text(_first(item, "No", "registration_number"), 100),
        }
        fields = {key: value for key, value in fields.items() if value is not None}
        evidence = {
            "provider": "qichacha_openapi_886",
            "route": "qichacha/FuzzySearch/GetList",
            "query": _text(query, 240),
            "url": QCC_FUZZY_SOURCE,
            "observed_at": timestamp,
        }
        identity = credit_code or f"{name}:{fields.get('registered_address', '')}"
        candidates.append({
            "schema_version": 1,
            "candidate_id": _candidate_id("qichacha", identity),
            "entity_type": "registered_company_candidate",
            "company_name": name,
            "credit_code": credit_code,
            "fields": fields,
            "field_evidence": {key: [evidence] for key in fields},
            "contacts": [],
            "sources": [evidence],
            "confidence": "registry_candidate",
        })
    return candidates


def deduplicate_candidates(candidates: list[dict]) -> list[dict]:
    """Deduplicate strong legal identities while retaining every source.

    A verified credit code is cross-source identity. Otherwise, only exact
    legal-company names are unified; marketplace seller/store names stay as
    supplier candidates and are not guessed to be registered companies.
    """
    merged: dict[str, dict] = {}
    for candidate in candidates:
        credit_code = _text(candidate.get("credit_code"), 80)
        company_name = _text(candidate.get("company_name"), 300)
        entity_type = candidate.get("entity_type")
        if credit_code:
            key = f"credit_code:{credit_code.casefold()}"
        elif company_name and entity_type != "supplier_candidate":
            normalized_name = "".join(company_name.split()).casefold()
            key = f"legal_name:{normalized_name}"
        else:
            key = candidate.get("candidate_id")
        if not key:
            continue
        if key not in merged:
            merged[key] = candidate
            continue
        current = merged[key]
        for source in candidate.get("sources", []):
            if source not in current["sources"]:
                current["sources"].append(source)
        for field, sources in candidate.get("field_evidence", {}).items():
            destination = current.setdefault("field_evidence", {}).setdefault(field, [])
            for source in sources:
                if source not in destination:
                    destination.append(source)
        for field, value in candidate.get("fields", {}).items():
            current.setdefault("fields", {}).setdefault(field, value)
        if not current.get("company_name"):
            current["company_name"] = candidate.get("company_name")
        if not current.get("credit_code"):
            current["credit_code"] = candidate.get("credit_code")
    return list(merged.values())


def attach_company_site_evidence(candidate: dict, site_result: dict) -> dict:
    """Attach only role-mailbox evidence from a readable approved company site."""
    if not isinstance(candidate, dict) or not isinstance(site_result, dict):
        raise ValueError("candidate and site_result must be objects")
    if site_result.get("status") != "readable":
        raise ValueError("company site must have at least one readable robots-allowed page")
    root_url = safe_source_url(_text(site_result.get("source_url"), 2048) or "")
    root_host = (urlsplit(root_url).hostname or "").lower()
    if urlsplit(root_url).scheme != "https" or not root_host:
        raise ValueError("site result must include an HTTPS source URL")

    merged = copy.deepcopy(candidate)
    merged.setdefault("contacts", [])
    merged.setdefault("sources", [])
    merged.setdefault("field_evidence", {})
    for item in site_result.get("contacts", []):
        if not isinstance(item, dict) or item.get("type") != "role_mailbox_email":
            continue
        value = _business_mailbox(_text(item.get("value"), 254))
        source_url = safe_source_url(_text(item.get("source_url"), 2048) or "")
        if not value or (urlsplit(source_url).hostname or "").lower() != root_host:
            continue
        evidence = {
            "provider": "official_company_site",
            "route": "company_site_reader",
            "url": source_url,
            "observed_at": _text(item.get("observed_at"), 40) or utc_now(),
            "purpose": "role-mailbox email linked on an approved company website",
        }
        contact = {
            "type": "business_email",
            "value": value,
            "source_url": source_url,
            "observed_at": evidence["observed_at"],
            "evidence": evidence,
        }
        if contact not in merged["contacts"]:
            merged["contacts"].append(contact)
        sources = merged["field_evidence"].setdefault("business_email", [])
        if evidence not in sources:
            sources.append(evidence)
        if evidence not in merged["sources"]:
            merged["sources"].append(evidence)
    pages = []
    for item in site_result.get("business_contact_pages", []):
        if not isinstance(item, dict):
            continue
        page_url = safe_source_url(_text(item.get("url"), 2048) or "")
        if (urlsplit(page_url).hostname or "").lower() == root_host:
            pages.append({
                "url": page_url,
                "anchor_text": _text(item.get("anchor_text"), 120),
                "form_present": bool(item.get("form_present")),
            })
    if pages:
        merged["business_contact_pages"] = pages
    return merged
