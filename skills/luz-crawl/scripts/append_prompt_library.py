#!/usr/bin/env python3
"""Append model-cleaned prompt-image pairs to the prompt library.

This belongs to luz-crawl Prompt Library Mode. It intentionally does not import
or call prompt-collect-skills code.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

from luz_crawl_protocol import detect_image_type


LIBRARY_ROOT = Path(os.environ.get("LUZ_PROMPT_LIBRARY_ROOT", str(Path.home() / "Documents" / "prompt-collect-skills"))).expanduser()
REGISTRY_PATH = LIBRARY_ROOT / "00记录" / "prompt_collection_registry.json"
FORBIDDEN_DIR = LIBRARY_ROOT / "00二创"


def now_cn() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def normalize_status_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url.strip())
    host = parsed.netloc.lower().removeprefix("www.")
    if host not in {"x.com", "twitter.com"}:
        raise ValueError(f"not an X/Twitter URL: {url}")
    match = re.match(r"^/([A-Za-z0-9_]{1,20})/status/(\d+)", parsed.path)
    if not match:
        raise ValueError(f"not an X status URL: {url}")
    handle, status_id = match.groups()
    return f"https://x.com/{handle}/status/{status_id}"


def tweet_id(url: str) -> str:
    return normalize_status_url(url).rsplit("/", 1)[-1]


def normalize_x_media_url(url: str) -> tuple[str, str]:
    parsed = urllib.parse.urlparse(url.strip())
    if "pbs.twimg.com" not in parsed.netloc or "/media/" not in parsed.path:
        raise ValueError(f"not an X media URL: {url}")
    query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    ext = (query.get("format") or Path(parsed.path).suffix.lstrip(".") or "jpg").lower()
    if ext == "jpeg":
        ext = "jpg"
    query["name"] = "orig"
    normalized = parsed._replace(query=urllib.parse.urlencode(query)).geturl()
    return normalized, ext


def prompt_hash(prompt: str) -> str:
    normalized = re.sub(r"\s+", " ", prompt.strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]


def safe_filename(value: str, fallback: str = "prompt") -> str:
    value = re.sub(r"https?://\S+", "", value)
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", value)
    value = re.sub(r"\s+", "-", value).strip("-._ ")
    return (value[:48].strip("-._ ") or fallback)


def read_registry(path: Path) -> dict:
    if not path.exists():
        return {"version": 1, "sources": {}, "prompt_hash_index": {}, "image_url_index": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        data = {"version": 1}
    if not isinstance(data, dict):
        data = {"version": 1}
    data.setdefault("version", 1)
    data.setdefault("sources", {})
    data.setdefault("prompt_hash_index", {})
    data.setdefault("image_url_index", {})
    if not isinstance(data["sources"], dict):
        data["sources"] = {}
    if not isinstance(data["prompt_hash_index"], dict):
        data["prompt_hash_index"] = {}
    if not isinstance(data["image_url_index"], dict):
        data["image_url_index"] = {}
    rebuild_indexes(data)
    return data


def add_index(index: dict, key: str, source: str) -> None:
    if not key:
        return
    values = index.setdefault(key, [])
    if isinstance(values, str):
        values = [values]
        index[key] = values
    if source not in values:
        values.append(source)


def rebuild_indexes(registry: dict) -> None:
    prompt_index: dict[str, list[str]] = {}
    image_index: dict[str, list[str]] = {}
    for source, record in registry.get("sources", {}).items():
        if not isinstance(record, dict):
            continue
        for key in [record.get("prompt_hash")]:
            if key:
                add_index(prompt_index, str(key), source)
        for item in record.get("items") or []:
            if isinstance(item, dict) and item.get("prompt_hash"):
                add_index(prompt_index, str(item["prompt_hash"]), source)
        for image_url in record.get("image_urls") or []:
            if image_url:
                add_index(image_index, str(image_url), source)
    registry["prompt_hash_index"] = prompt_index
    registry["image_url_index"] = image_index


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        newline="\n",
        delete=False,
        dir=str(path.parent),
    ) as fh:
        fh.write(text)
        temp_name = fh.name
    os.replace(temp_name, path)


def write_registry(path: Path, registry: dict) -> None:
    registry["updated_at"] = now_cn()
    rebuild_indexes(registry)
    atomic_write_text(path, json.dumps(registry, ensure_ascii=False, indent=2))


def next_sequence(md_path: Path) -> int:
    if not md_path.exists():
        return 1
    text = md_path.read_text(encoding="utf-8")
    nums = [int(m.group(1)) for m in re.finditer(r"^##\s+(\d{3,4})[.．、]\s+", text, re.M)]
    return max(nums) + 1 if nums else 1


def category_doc_header(category: str) -> str:
    return (
        f"# {category}提示词库\n\n"
        "- 条目按编号顺序排列。\n"
        "- 图片按原始字节保存到 images 文件夹。\n"
        "- 提示词代码块必须是可直接复用的中文文本。\n\n"
    )


def assert_allowed_path(path: Path) -> None:
    resolved = path.resolve()
    root = LIBRARY_ROOT.resolve()
    forbidden = FORBIDDEN_DIR.resolve()
    if not str(resolved).lower().startswith(str(root).lower()):
        raise ValueError(f"path outside prompt library root: {path}")
    if str(resolved).lower().startswith(str(forbidden).lower()):
        raise ValueError(f"refusing to write under 00二创: {path}")


def download_image(url: str, target: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = response.read()
    if not data:
        raise RuntimeError(f"empty image download: {url}")
    target.write_bytes(data)
    if detect_image_type(target) is None:
        target.unlink(missing_ok=True)
        raise RuntimeError(f"downloaded bytes are not an image: {url}")


def require_chinese_prompt(prompt: str) -> None:
    if not re.search(r"[\u4e00-\u9fff]", prompt):
        raise ValueError("prompt must contain Chinese text")
    if not re.search(r"(画幅比例|宽高比|1:1|3:4|4:5|9:16|16:9|横版|竖版|方形)", prompt):
        raise ValueError("prompt must include an aspect ratio")
    bad = ["View keyboard shortcuts", "Show more", "Prompt in comments", "提示词见评论区"]
    for needle in bad:
        if needle.lower() in prompt.lower():
            raise ValueError(f"prompt contains teaser/UI noise: {needle}")


def append_category_block(path: Path, category: str, block: str) -> tuple[bool, str]:
    existed = path.exists()
    existing = path.read_text(encoding="utf-8") if existed else category_doc_header(category)
    atomic_write_text(path, existing + block)
    return existed, existing


def restore_text_block(path: Path, existed: bool, previous_text: str) -> None:
    if existed:
        atomic_write_text(path, previous_text)
    else:
        path.unlink(missing_ok=True)


def prepare_item(item: dict, registry: dict) -> dict:
    source_url = normalize_status_url(str(item["link"]))
    category = str(item["category"]).strip()
    title = str(item["title"]).strip()
    author = str(item.get("author") or "").strip()
    source_title = str(item.get("source_title") or title).strip()
    prompt = str(item["prompt"]).strip()
    aspect_ratio = str(item.get("aspect_ratio") or "").strip()
    raw_images = [str(url).strip() for url in item.get("images", []) if str(url).strip()]

    if not category or not title or not prompt or not raw_images:
        raise ValueError("item requires category/title/prompt/images")
    require_chinese_prompt(prompt)

    normalized_images: list[tuple[str, str]] = [normalize_x_media_url(url) for url in raw_images]
    image_urls = [url for url, _ in normalized_images]
    phash = prompt_hash(prompt)

    sources = registry.setdefault("sources", {})
    existing = sources.get(source_url)
    if isinstance(existing, dict) and existing.get("status") == "ready":
        return {"source": source_url, "status": "skipped", "reason": "duplicate_source"}
    if phash in registry.get("prompt_hash_index", {}):
        return {"source": source_url, "status": "skipped", "reason": "duplicate_prompt_hash"}
    duplicate_images = [url for url in image_urls if url in registry.get("image_url_index", {})]
    if duplicate_images:
        return {"source": source_url, "status": "skipped", "reason": "duplicate_image_url", "images": duplicate_images}

    category_dir = LIBRARY_ROOT / safe_filename(category, "未分类")
    image_dir = category_dir / "images"
    md_path = category_dir / f"{category_dir.name}.md"
    for path in [category_dir, image_dir, md_path, REGISTRY_PATH]:
        assert_allowed_path(path)

    sequence = next_sequence(md_path)
    file_base = f"{sequence:03d}-{safe_filename(title)}"
    local_rel_images: list[str] = []
    final_image_paths: list[Path] = []
    image_dir.mkdir(parents=True, exist_ok=True)
    temp_downloads: list[tuple[Path, Path]] = []
    try:
        for idx, (image_url, ext) in enumerate(normalized_images, start=1):
            final_target = image_dir / f"{file_base}-{idx:02d}.{ext}"
            with tempfile.NamedTemporaryFile(delete=False, dir=str(image_dir), suffix=f".{ext}") as fh:
                temp_target = Path(fh.name)
            download_image(image_url, temp_target)
            temp_downloads.append((temp_target, final_target))
            final_image_paths.append(final_target)
            local_rel_images.append(f"{category_dir.name}/images/{final_target.name}")
    except Exception:
        for temp_path, _ in temp_downloads:
            temp_path.unlink(missing_ok=True)
        raise

    image_tags = " ".join(
        f'<img src="images/{path.name}" alt="{title}-{idx:02d}" width="180">'
        for idx, path in enumerate(final_image_paths, start=1)
    )
    marker = f"<!-- prompt-collect source={source_url} item={tweet_id(source_url)} index=1 -->"
    block = (
        f"{marker}\n"
        f"## {sequence:03d}. {title}\n\n"
        f"**画面比例**：{aspect_ratio or '见提示词'}\n\n"
        f"**分类**：{category}\n\n"
        "**图片**  \n"
        f"{image_tags}\n\n"
        "**提示词**\n\n"
        "```text\n"
        f"{prompt}\n"
        "```\n\n"
        "<details><summary>来源信息</summary>\n\n"
        f"- 原链接：{source_url}\n"
        f"- 作者：{author}\n"
        f"- 来源标题：{source_title}\n"
        f"- 采集时间：{now_cn()}\n"
        "- 图片来源：pbs.twimg.com/media 原图\n\n"
        "</details>\n\n"
    )

    record = {
        "source_url": source_url,
        "tweet_id": tweet_id(source_url),
        "status": "ready",
        "title": title,
        "category": category,
        "prompt_hash": phash,
        "image_urls": image_urls,
        "local_images": local_rel_images,
        "doc_path": str(md_path),
        "collected_at": now_cn(),
        "author": author,
    }
    return {
        "source": source_url,
        "status": "prepared",
        "category": category,
        "doc": str(md_path),
        "images": local_rel_images,
        "block": block,
        "record": record,
        "temp_downloads": temp_downloads,
    }


def commit_prepared_item(prepared: dict, registry: dict, registry_path: Path) -> dict:
    md_path = Path(prepared["doc"])
    record = dict(prepared["record"])
    source_url = str(record["source_url"])
    committed: list[Path] = []
    registry_snapshot = copy.deepcopy(registry)
    md_snapshot: tuple[bool, str] | None = None
    try:
        for temp_path, final_path in prepared["temp_downloads"]:
            final_path.parent.mkdir(parents=True, exist_ok=True)
            os.replace(temp_path, final_path)
            committed.append(final_path)

        md_snapshot = append_category_block(
            md_path,
            str(prepared["category"]),
            str(prepared["block"]),
        )

        sources = registry.setdefault("sources", {})
        sources[source_url] = record
        add_index(registry.setdefault("prompt_hash_index", {}), str(record["prompt_hash"]), source_url)
        for image_url in record["image_urls"]:
            add_index(registry.setdefault("image_url_index", {}), image_url, source_url)
        write_registry(registry_path, registry)
    except Exception:
        registry.clear()
        registry.update(registry_snapshot)
        if md_snapshot is not None:
            restore_text_block(md_path, *md_snapshot)
        for temp_path, _ in prepared["temp_downloads"]:
            temp_path.unlink(missing_ok=True)
        for final_path in committed:
            final_path.unlink(missing_ok=True)
        raise

    result = {
        "source": source_url,
        "status": "appended",
        "category": prepared["category"],
        "doc": str(md_path),
        "images": prepared["images"],
    }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--items", required=True, help="JSON file containing an items array")
    parser.add_argument("--registry", default=str(REGISTRY_PATH))
    args = parser.parse_args()

    data = json.loads(Path(args.items).read_text(encoding="utf-8-sig"))
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list) or not items:
        raise SystemExit("items JSON must contain a non-empty list")

    registry_path = Path(args.registry)
    assert_allowed_path(registry_path)
    registry = read_registry(registry_path)
    results = []
    for item in items:
        try:
            prepared = prepare_item(item, registry)
            result = commit_prepared_item(prepared, registry, registry_path)
            results.append(result)
        except Exception as exc:
            results.append({"source": item.get("link"), "status": "error", "reason": str(exc)})
    print(json.dumps({"results": results, "registry": str(registry_path)}, ensure_ascii=False, indent=2))
    if any(result.get("status") == "error" for result in results):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
