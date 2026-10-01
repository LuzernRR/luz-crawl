#!/usr/bin/env python3
"""Narrow, billable Qichacha Open Platform adapter for enterprise fuzzy search."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
import time
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


QCC_FUZZY_ENDPOINT = "https://api.qichacha.com/FuzzySearch/GetList"
QCC_FUZZY_COST_RMB = 0.10
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class QCCClientError(RuntimeError):
    """A safe, non-secret-bearing QCC adapter failure."""


class QCCConfirmationRequired(QCCClientError):
    pass


@dataclass(frozen=True)
class QCCCredentials:
    app_key: str
    secret_key: str


def credentials_from_environment(environ: dict[str, str] | None = None) -> QCCCredentials | None:
    env = os.environ if environ is None else environ
    app_key = env.get("QCC_APP_KEY", "").strip()
    secret_key = env.get("QCC_SECRET_KEY", "").strip()
    if not app_key or not secret_key:
        return None
    return QCCCredentials(app_key=app_key, secret_key=secret_key)


def make_auth_headers(credentials: QCCCredentials, *, timespan: int | str | None = None) -> dict[str, str]:
    """Build the official Token/Timespan headers without exposing the secret."""
    stamp = str(int(time.time()) if timespan is None else timespan)
    if not stamp.isdigit() or len(stamp) != 10:
        raise ValueError("Timespan must be a 10-digit Unix timestamp in seconds")
    source = f"{credentials.app_key}{stamp}{credentials.secret_key}".encode("utf-8")
    token = hashlib.md5(source).hexdigest().upper()
    return {"Token": token, "Timespan": stamp}


def _records(data: object) -> list[dict]:
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)][:5]
    if isinstance(data, dict):
        for key in ("Result", "Data", "result", "data"):
            nested = data.get(key)
            if isinstance(nested, list):
                return [item for item in nested if isinstance(item, dict)][:5]
            if isinstance(nested, dict):
                nested_records = _records(nested)
                if nested_records:
                    return nested_records
    return []


def fuzzy_search(
    search_key: str,
    *,
    credentials: QCCCredentials | None = None,
    page_index: int = 1,
    confirmed_billable: bool = False,
    opener: Callable = urlopen,
    now: Callable[[], float] = time.time,
    timeout: float = 12.0,
) -> dict:
    """Issue one confirmed, billable fuzzy-search request; never auto-retry.

    QCC currently documents a price of RMB 0.10/request and a maximum of five
    records per request for ApiCode 886. A failed/ambiguous response is never
    retried because successful transport with a malformed response could still
    be billable.
    """
    query = " ".join((search_key or "").split())
    if not query or len(query) > 100:
        raise ValueError("search_key must contain 1-100 characters")
    if not 1 <= page_index <= 1000:
        raise ValueError("page_index must be between 1 and 1000")
    if not confirmed_billable:
        raise QCCConfirmationRequired(
            f"QCC fuzzy search may cost RMB {QCC_FUZZY_COST_RMB:.2f} per request; "
            "set confirmed_billable=True only after the user confirms."
        )
    active_credentials = credentials or credentials_from_environment()
    if active_credentials is None:
        raise QCCClientError("QCC_APP_KEY and QCC_SECRET_KEY are not configured")

    stamp = str(int(now()))
    params = urlencode({"key": active_credentials.app_key,
                        "searchKey": query, "pageIndex": str(page_index)})
    request = Request(
        f"{QCC_FUZZY_ENDPOINT}?{params}",
        headers={"Accept": "application/json", **make_auth_headers(active_credentials,
                                                                      timespan=stamp)},
        method="GET",
    )
    try:
        with opener(request, timeout=timeout) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
            status_code = getattr(response, "status", 200)
    except HTTPError as exc:
        raise QCCClientError(f"QCC HTTP error {exc.code}; request was not retried") from None
    except (URLError, TimeoutError, OSError) as exc:
        raise QCCClientError(
            f"QCC transport error {type(exc).__name__}; request was not retried"
        ) from None
    if len(body) > MAX_RESPONSE_BYTES:
        raise QCCClientError("QCC response exceeded the 2 MiB safety limit")
    if status_code < 200 or status_code >= 300:
        raise QCCClientError(f"QCC HTTP status {status_code}; request was not retried")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise QCCClientError("QCC returned invalid JSON; request was not retried") from None
    if not isinstance(payload, dict):
        raise QCCClientError("QCC returned an unexpected response shape; request was not retried")

    status = str(payload.get("Status", payload.get("status", "")))
    if status and status not in {"200", "0", "Success", "success"}:
        # Do not echo the provider body: it may contain unneeded company fields.
        raise QCCClientError(f"QCC API status {status}; request was not retried")
    return {
        "provider": "qichacha_openapi_886",
        "query": query,
        "page_index": page_index,
        "max_records_per_request": 5,
        "estimated_cost_rmb": QCC_FUZZY_COST_RMB,
        "requested_at": stamp,
        "status": "ok",
        "records": _records(payload),
    }
