from __future__ import annotations

import datetime as _dt
import sys
import time
from pathlib import Path

import httpx


HERMES_ROOT = Path(r"D:\Hermes\hermes-agent")
if str(HERMES_ROOT) not in sys.path:
    sys.path.insert(0, str(HERMES_ROOT))

from hermes_cli import auth as hermes_auth  # noqa: E402


ISSUER = "https://auth.openai.com"


def _post_json(url: str, payload: dict, *, timeout: float = 20.0) -> httpx.Response:
    # Open a fresh client for each request. This avoids stale proxy tunnels during
    # the device-code polling wait without changing Hermes itself.
    with httpx.Client(timeout=httpx.Timeout(timeout)) as client:
        return client.post(
            url,
            json=payload,
            headers={"Content-Type": "application/json"},
        )


def _post_form(url: str, payload: dict, *, timeout: float = 20.0) -> httpx.Response:
    with httpx.Client(timeout=httpx.Timeout(timeout)) as client:
        return client.post(
            url,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )


def main() -> int:
    client_id = hermes_auth.CODEX_OAUTH_CLIENT_ID

    device_resp = None
    for attempt in range(1, 5):
        try:
            device_resp = _post_json(
                f"{ISSUER}/api/accounts/deviceauth/usercode",
                {"client_id": client_id},
            )
        except Exception as exc:
            print(f"DEVICE_CODE_REQUEST_ERROR attempt={attempt}: {exc}", flush=True)
            time.sleep(min(2**attempt, 10))
            continue
        if device_resp.status_code == 200:
            break
        if device_resp.status_code == 429 and attempt < 4:
            retry_after = device_resp.headers.get("Retry-After")
            delay = int(retry_after) if retry_after and retry_after.isdigit() else min(2**attempt, 10)
            print(f"DEVICE_CODE_RATE_LIMIT retry_in={delay}s", flush=True)
            time.sleep(delay)
            continue
        print(f"DEVICE_CODE_REQUEST_STATUS={device_resp.status_code}", flush=True)
        print(device_resp.text[:500], flush=True)
        return 2

    if device_resp is None or device_resp.status_code != 200:
        print("DEVICE_CODE_REQUEST_FAILED", flush=True)
        return 2

    device_data = device_resp.json()
    user_code = str(device_data.get("user_code") or "").strip()
    device_auth_id = str(device_data.get("device_auth_id") or "").strip()
    poll_interval = max(3, int(device_data.get("interval") or 5))
    if not user_code or not device_auth_id:
        print("DEVICE_CODE_INCOMPLETE", flush=True)
        return 2

    print("OPEN_THIS_URL:", f"{ISSUER}/codex/device", flush=True)
    print("ENTER_THIS_CODE:", user_code, flush=True)
    print("WAITING_FOR_SIGN_IN", flush=True)

    code_resp = None
    deadline = time.monotonic() + 15 * 60
    while time.monotonic() < deadline:
        time.sleep(poll_interval)
        try:
            poll_resp = _post_json(
                f"{ISSUER}/api/accounts/deviceauth/token",
                {"device_auth_id": device_auth_id, "user_code": user_code},
            )
        except Exception as exc:
            print(f"POLL_CONNECT_ERROR_RETRYING: {exc}", flush=True)
            continue

        if poll_resp.status_code == 200:
            code_resp = poll_resp.json()
            print("AUTHORIZATION_RECEIVED", flush=True)
            break
        if poll_resp.status_code in {403, 404}:
            print("POLL_PENDING", flush=True)
            continue
        print(f"POLL_STATUS_ERROR={poll_resp.status_code}", flush=True)
        print(poll_resp.text[:500], flush=True)
        return 3

    if code_resp is None:
        print("LOGIN_TIMED_OUT", flush=True)
        return 3

    authorization_code = str(code_resp.get("authorization_code") or "").strip()
    code_verifier = str(code_resp.get("code_verifier") or "").strip()
    if not authorization_code or not code_verifier:
        print("AUTHORIZATION_RESPONSE_INCOMPLETE", flush=True)
        return 3

    try:
        token_resp = _post_form(
            hermes_auth.CODEX_OAUTH_TOKEN_URL,
            {
                "grant_type": "authorization_code",
                "code": authorization_code,
                "redirect_uri": f"{ISSUER}/deviceauth/callback",
                "client_id": client_id,
                "code_verifier": code_verifier,
            },
        )
    except Exception as exc:
        print(f"TOKEN_EXCHANGE_CONNECT_ERROR: {exc}", flush=True)
        return 4

    if token_resp.status_code != 200:
        print(f"TOKEN_EXCHANGE_STATUS={token_resp.status_code}", flush=True)
        print(token_resp.text[:500], flush=True)
        return 4

    token_payload = token_resp.json()
    access_token = str(token_payload.get("access_token") or "").strip()
    refresh_token = str(token_payload.get("refresh_token") or "").strip()
    id_token = str(token_payload.get("id_token") or "").strip()
    if not access_token or not refresh_token:
        print("TOKEN_EXCHANGE_MISSING_TOKEN", flush=True)
        return 4

    hermes_auth._save_codex_tokens(
        {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "id_token": id_token,
            "account_id": token_payload.get("account_id", ""),
        },
        last_refresh=_dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        label="openai-codex-oauth-resilient",
    )
    print("SAVED_TO_HERMES_AUTH", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
