#!/usr/bin/env python3
"""Submit a search to the Luz Crawl browser extension through its local bridge."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[3]
BRIDGE_DIR = ROOT / "browser-extension" / "bridge"
SERVER = BRIDGE_DIR / "server.mjs"
CONFIG_FILE = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "LuzCrawl" / "bridge-config.json"
TERMINAL = {"completed", "no_visible_results", "failed", "tab_closed", "manual_search_required", "superseded"}


class BridgeError(RuntimeError):
    pass


def _request(method: str, path: str, body: dict | None = None, timeout: float = 3.0) -> dict:
    default_port = os.environ.get("LUZ_CRAWL_BRIDGE_PORT", "8765")
    base_url = os.environ.get("LUZ_CRAWL_BRIDGE_URL", f"http://127.0.0.1:{default_port}").rstrip("/")
    payload = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = Request(
        f"{base_url}{path}",
        data=payload,
        method=method,
        headers={"Content-Type": "application/json; charset=utf-8"} if payload is not None else {},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            data = response.read(128 * 1024 + 1)
            if len(data) > 128 * 1024:
                raise BridgeError("本机桥接响应超过 128 KiB。")
            return json.loads(data.decode("utf-8"))
    except HTTPError as error:
        try:
            detail = json.loads(error.read(32 * 1024).decode("utf-8"))
        except Exception:
            detail = {}
        raise BridgeError(detail.get("message") or detail.get("error") or f"本机桥接 HTTP {error.code}") from error
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        raise BridgeError(f"本机桥接暂不可用：{error}") from error


def health() -> dict:
    return _request("GET", "/health")


def list_sources() -> dict:
    ensure_server()
    return _request("GET", "/api/sources")


def ensure_server(startup_timeout: float = 5.0) -> dict:
    try:
        return health()
    except BridgeError:
        pass

    node = shutil.which("node")
    if not node:
        raise BridgeError("未找到 Node.js，无法启动本机扩展桥接服务。请安装 Node.js 后重试。")
    if not SERVER.is_file():
        raise BridgeError(f"缺少桥接服务文件：{SERVER}")
    if not (BRIDGE_DIR / "node_modules" / "ws").exists():
        raise BridgeError(
            "桥接服务依赖尚未安装。请在仓库运行："
            "npm install --prefix browser-extension/bridge"
        )

    env = os.environ.copy()
    if not env.get("LUZ_CRAWL_EXTENSION_ID") and CONFIG_FILE.is_file():
        try:
            config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            extension_id = str(config.get("extensionId", ""))
            if extension_id:
                env["LUZ_CRAWL_EXTENSION_ID"] = extension_id
        except (OSError, json.JSONDecodeError):
            raise BridgeError(f"桥接配置损坏：{CONFIG_FILE}")
    log_root = Path(env.get("LOCALAPPDATA") or Path.home()) / "LuzCrawl" / "logs"
    log_root.mkdir(parents=True, exist_ok=True)
    log_file = (log_root / "extension-bridge.log").open("ab")
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    try:
        subprocess.Popen(
            [node, str(SERVER)],
            cwd=BRIDGE_DIR,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            close_fds=True,
            creationflags=creationflags,
            start_new_session=(os.name != "nt"),
        )
    finally:
        log_file.close()

    deadline = time.monotonic() + startup_timeout
    last_error = ""
    while time.monotonic() < deadline:
        time.sleep(0.15)
        try:
            return health()
        except BridgeError as error:
            last_error = str(error)
    raise BridgeError(f"未能启动本机桥接服务：{last_error}")


def submit(source_id: str, query: str, wait_timeout: float = 120.0, wait: bool = True) -> dict:
    ensure_server()
    job = _request("POST", "/api/jobs", {"sourceId": source_id, "query": query})
    if not wait:
        return job

    deadline = time.monotonic() + max(0, wait_timeout)
    while time.monotonic() < deadline:
        time.sleep(0.35)
        current = _request("GET", f"/api/jobs/{job['id']}")
        if current.get("status") in TERMINAL or current.get("status") == "waiting_user":
            return current
    return _request("GET", f"/api/jobs/{job['id']}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="通过已连接的 Luz Crawl 浏览器扩展自动搜索并回传当前页可见结果。")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("health", help="检查本机服务与扩展连接状态。")
    subparsers.add_parser("sources", help="从扩展的共享注册表读取当前支持的平台及类型。")

    search = subparsers.add_parser("search", help="自动派发一次浏览器扩展搜索。")
    search.add_argument("--source", required=True, help="来源 ID；通过 sources 查看注册的平台及类型。")
    search.add_argument("--query", required=True)
    search.add_argument("--wait-timeout", type=float, default=120.0)
    search.add_argument("--no-wait", action="store_true", help="排队后立即返回任务 ID。")

    status = subparsers.add_parser("status", help="读取任务状态。")
    status.add_argument("--job-id", required=True)

    configure = subparsers.add_parser("configure", help="保存当前安装的扩展 ID；同一台机器只需配置一次。")
    configure.add_argument("--extension-id", required=True, help="32 位 Chromium 扩展 ID。")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "health":
            result = ensure_server()
        elif args.command == "sources":
            result = list_sources()
        elif args.command == "configure":
            extension_id = args.extension_id.strip().lower()
            if len(extension_id) != 32 or any(char not in "abcdefghijklmnop" for char in extension_id):
                raise BridgeError("扩展 ID 必须是 32 位 a-p 字符。")
            CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
            temp_file = CONFIG_FILE.with_suffix(".json.tmp")
            temp_file.write_text(json.dumps({"extensionId": extension_id}, indent=2), encoding="utf-8")
            temp_file.replace(CONFIG_FILE)
            result = {"status": "configured", "configPath": str(CONFIG_FILE)}
        elif args.command == "search":
            result = submit(args.source, args.query, wait_timeout=args.wait_timeout, wait=not args.no_wait)
        else:
            ensure_server()
            result = _request("GET", f"/api/jobs/{args.job_id}")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if result.get("status") == "failed":
            return 2
        return 0
    except BridgeError as error:
        print(json.dumps({"status": "bridge_error", "message": str(error)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
