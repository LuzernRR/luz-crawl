#!/usr/bin/env python3
"""Shared protocol constants and helpers for luz-crawl scripts."""

from __future__ import annotations

from dataclasses import dataclass
import os
import re
from pathlib import Path


DEFAULT_ROOT = Path(os.environ.get("LUZ_CRAWL_OUTPUT_ROOT", str(Path.home() / "Documents" / "luz-crawl"))).expanduser()
BUNDLED_EXPERIENCE_ROOT = Path(__file__).resolve().parents[1] / "experience"
EXPERIENCE_FILES = (
    "knowledge-index.md",
    "search-keywords.md",
    "search-skill-library.md",
    "knowledge-base-seeds.md",
)


def resolve_codex_home() -> Path:
    configured = os.environ.get("CODEX_HOME", "").strip()
    return Path(configured).expanduser() if configured else Path.home() / ".codex"


def resolve_experience_root(value: str | Path | None = None) -> Path:
    if value:
        return Path(value).expanduser().resolve()
    configured = os.environ.get("LUZ_CRAWL_STATE_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return (resolve_codex_home() / "state" / "luz-crawl").resolve()


DEFAULT_EXPERIENCE_ROOT = resolve_experience_root()

# Deprecated compatibility symbols. luz-crawl outputs are flat NNN_主题 folders.
MODULES: dict[str, str] = {}

SECTIONED_MODULE_IDS: set[str] = set()
SECTION_FOLDERS: dict[str, str] = {}

# Backward-compatible names for older helper scripts that import these symbols.
MONEY_SECTION_FOLDERS: dict[str, str] = {}
PLATFORM_SECTION_FOLDERS: dict[str, str] = {}


STRICT_PROMPT_LINK_LABEL = "链接"
STRICT_PROMPT_IMAGES_LABEL = "图片"
STRICT_PROMPT_PROMPT_LABEL = "提示词"
STRICT_PROMPT_NO_IMAGES = "无"

ITEM_HEADING_RE = re.compile(r"^##\s+(\d+)[.．、]\s+(.+?)\s*$")
IMAGE_LINE_RE = re.compile(r'^\s*<img\s+src="\./images/([^"]+)"\s+height="(\d+)">\s*$')


@dataclass(frozen=True)
class StrictPromptItem:
    index: int
    title: str
    link: str
    images: list[str]
    prompt: str
    image_heights: list[int]


@dataclass(frozen=True)
class StrictPromptDocument:
    heading: str | None
    items: list[StrictPromptItem]


def resolve_module(value: str) -> str:
    raise ValueError("module folders are deprecated; use a clear root-level NNN_主题 title")


def module_id_for_name(module_name: str) -> str | None:
    for module_id, name in MODULES.items():
        if name == module_name:
            return module_id
    return None


def module_requires_section(module_name: str) -> bool:
    module_id = module_id_for_name(module_name)
    return module_id in SECTIONED_MODULE_IDS


def section_folders_for_module(module_name: str) -> dict[str, str]:
    if not module_requires_section(module_name):
        return {}
    return SECTION_FOLDERS


def resolve_section(value: str | None, module_name: str) -> str | None:
    if not module_requires_section(module_name):
        return None
    valid_sections = section_folders_for_module(module_name)
    if not value:
        raise ValueError(
            f"module {module_name} requires --section: "
            + ", ".join(f"{key} -> {name}" for key, name in valid_sections.items())
        )
    if value in valid_sections:
        return valid_sections[value]
    if value in valid_sections.values():
        return value
    raise ValueError(
        "unknown section value. Valid sections:\n"
        + "\n".join(f"  {key} -> {name}" for key, name in valid_sections.items())
    )


def detect_image_type(path: Path) -> str | None:
    header = path.read_bytes()[:12]
    if header.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "webp"
    return None


def render_images_block(images: list[str], height: int) -> str:
    if not images:
        return STRICT_PROMPT_NO_IMAGES
    lines = ["<p>"]
    for image in images:
        lines.append(f'  <img src="./images/{image}" height="{height}">')
    lines.append("</p>")
    return "\n".join(lines)


def render_strict_prompt_document(
    items: list[dict],
    heading: str | None = None,
    image_height: int = 220,
) -> str:
    parts: list[str] = []
    if heading:
        parts.append(f"# {heading}")

    for index, item in enumerate(items, start=1):
        title = str(item["title"]).strip()
        link = str(item["link"]).strip()
        prompt = str(item["prompt"]).strip()
        images = [str(image).strip() for image in item.get("images", []) if str(image).strip()]
        parts.append(f"## {index}. {title}")
        parts.append(f"{STRICT_PROMPT_LINK_LABEL}：{link}")
        parts.append(f"{STRICT_PROMPT_IMAGES_LABEL}：")
        parts.append(render_images_block(images, image_height))
        parts.append(f"{STRICT_PROMPT_PROMPT_LABEL}：")
        parts.append(f"```text\n{prompt}\n```")

    return "\n\n".join(parts).rstrip() + "\n"


def parse_strict_prompt_document(text: str) -> StrictPromptDocument:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    index = 0
    heading: str | None = None
    items: list[StrictPromptItem] = []

    def skip_blank() -> None:
        nonlocal index
        while index < len(lines) and not lines[index].strip():
            index += 1

    skip_blank()
    if index < len(lines) and lines[index].startswith("# "):
        heading = lines[index][2:].strip()
        index += 1

    while True:
        skip_blank()
        if index >= len(lines):
            break

        heading_match = ITEM_HEADING_RE.match(lines[index])
        if not heading_match:
            raise ValueError(f"unexpected content outside item blocks: {lines[index]!r}")
        item_index = int(heading_match.group(1))
        title = heading_match.group(2).strip()
        index += 1

        skip_blank()
        if index >= len(lines) or not lines[index].startswith(f"{STRICT_PROMPT_LINK_LABEL}："):
            raise ValueError(f"item {item_index}: missing {STRICT_PROMPT_LINK_LABEL} line")
        link = lines[index].split("：", 1)[1].strip()
        index += 1

        skip_blank()
        if index >= len(lines) or lines[index].strip() != f"{STRICT_PROMPT_IMAGES_LABEL}：":
            raise ValueError(f"item {item_index}: missing {STRICT_PROMPT_IMAGES_LABEL} line")
        index += 1

        skip_blank()
        images: list[str] = []
        image_heights: list[int] = []
        if index >= len(lines):
            raise ValueError(f"item {item_index}: missing image block")
        if lines[index].strip() == STRICT_PROMPT_NO_IMAGES:
            index += 1
        else:
            if lines[index].strip() != "<p>":
                raise ValueError(f"item {item_index}: image block must start with <p>")
            index += 1
            while index < len(lines) and lines[index].strip() != "</p>":
                image_match = IMAGE_LINE_RE.match(lines[index])
                if not image_match:
                    raise ValueError(f"item {item_index}: invalid image line {lines[index]!r}")
                images.append(image_match.group(1))
                image_heights.append(int(image_match.group(2)))
                index += 1
            if index >= len(lines) or lines[index].strip() != "</p>":
                raise ValueError(f"item {item_index}: image block missing closing </p>")
            index += 1

        skip_blank()
        if index >= len(lines) or lines[index].strip() != f"{STRICT_PROMPT_PROMPT_LABEL}：":
            raise ValueError(f"item {item_index}: missing {STRICT_PROMPT_PROMPT_LABEL} line")
        index += 1

        skip_blank()
        if index >= len(lines) or lines[index].strip() != "```text":
            raise ValueError(f"item {item_index}: prompt must start with ```text")
        index += 1

        prompt_lines: list[str] = []
        while index < len(lines) and lines[index].strip() != "```":
            prompt_lines.append(lines[index])
            index += 1
        if index >= len(lines):
            raise ValueError(f"item {item_index}: prompt fence is not closed")
        prompt = "\n".join(prompt_lines).strip()
        index += 1

        items.append(
            StrictPromptItem(
                index=item_index,
                title=title,
                link=link,
                images=images,
                prompt=prompt,
                image_heights=image_heights,
            )
        )

    return StrictPromptDocument(heading=heading, items=items)
