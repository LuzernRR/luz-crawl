#!/usr/bin/env python3
"""Download X/Twitter pbs.twimg.com media URLs and verify local files."""

from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

from luz_crawl_protocol import detect_image_type


def normalize_x_media_url(url: str) -> tuple[str, str]:
    parsed = urllib.parse.urlparse(url)
    query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    ext = query.get("format", "jpg").lower()
    if ext == "jpeg":
        ext = "jpg"
    query["name"] = "orig"
    normalized = parsed._replace(query=urllib.parse.urlencode(query)).geturl()
    return normalized, ext


def safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._") or "image"


def ps_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def download_with_powershell(url: str, target: Path) -> None:
    command = (
        "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; "
        "[Net.ServicePointManager]::SecurityProtocol = "
        "[Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13; "
        f"Invoke-WebRequest -UseBasicParsing -Uri {ps_literal(url)} "
        "-Headers @{ 'User-Agent' = 'Mozilla/5.0' } "
        f"-OutFile {ps_literal(str(target))}"
    )
    encoded = base64.b64encode(command.encode("utf-16le")).decode("ascii")
    subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
        check=True,
    )


def download_with_curl(url: str, target: Path) -> None:
    subprocess.run(
        [
            "curl.exe",
            "-L",
            "--fail",
            "--retry",
            "3",
            "--retry-delay",
            "2",
            "--connect-timeout",
            "20",
            "--max-time",
            "90",
            "-A",
            "Mozilla/5.0",
            url,
            "-o",
            str(target),
        ],
        check=True,
    )


def is_valid_image(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0 and detect_image_type(path) is not None


def download_verified(url: str, target: Path) -> None:
    if is_valid_image(target):
        return
    errors: list[str] = []
    for attempt in range(1, 4):
        try:
            download_with_powershell(url, target)
            if is_valid_image(target):
                return
            errors.append(f"powershell attempt {attempt}: invalid image bytes")
        except Exception as exc:
            errors.append(f"powershell attempt {attempt}: {exc}")
        target.unlink(missing_ok=True)
        time.sleep(min(attempt * 2, 6))
    try:
        download_with_curl(url, target)
        if is_valid_image(target):
            return
        errors.append("curl fallback: invalid image bytes")
    except Exception as exc:
        errors.append(f"curl fallback: {exc}")
    target.unlink(missing_ok=True)
    raise RuntimeError("; ".join(errors))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download X pbs.twimg.com media from a JSON manifest."
    )
    parser.add_argument("--manifest", required=True, help="JSON file with items/prefix/urls")
    parser.add_argument("--out-dir", required=True, help="Output images directory")
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    data = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    downloads: list[dict[str, object]] = []

    for item in data.get("items", []):
        prefix = safe_name(str(item["prefix"]))
        for index, raw_url in enumerate(item.get("urls", []), start=1):
            url, ext = normalize_x_media_url(str(raw_url))
            filename = f"{prefix}_{index:02d}.{ext}"
            target = out_dir / filename
            try:
                download_verified(url, target)
            except Exception as exc:
                print(f"ERROR: failed to download {url}: {exc}", file=sys.stderr)
                return 1
            size = target.stat().st_size if target.exists() else 0
            if size <= 0:
                print(f"ERROR: empty download: {target}", file=sys.stderr)
                return 1
            image_type = detect_image_type(target)
            if image_type is None:
                print(f"ERROR: downloaded file is not a recognized image: {target}", file=sys.stderr)
                return 1
            downloads.append({"file": filename, "bytes": size, "type": image_type, "url": url})

    print(json.dumps({"downloaded": downloads}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
