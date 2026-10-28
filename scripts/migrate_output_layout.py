"""Normalize legacy LuzCrawl output without deleting original files (dry-run by default)."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def inventory(root: Path) -> list[dict]:
    paths = sorted(root.rglob("*"))
    if any(path.is_symlink() or path.is_junction() for path in paths):
        raise ValueError(f"Refusing linked evidence tree: {root}")
    return [{"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size, "sha256": digest(path)} for path in paths if path.is_file()]


def inside(root: Path, path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(root) or resolved == root:
        raise ValueError(f"Move escapes output root: {path}")
    return resolved


def write_json(file: Path, value: dict) -> None:
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def render_index(title: str, files: list[dict]) -> str:
    pages = [item for item in files if Path(item["path"]).suffix.lower() in {".html", ".htm"}]
    rows = "".join(f'<tr><td><a href="{quote(item["path"], safe="/")}">{html.escape(Path(item["path"]).name)}</a></td></tr>' for item in pages)
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>
:root{{font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;font-size:16px;color:#243746;background:#f5f6f8;line-height:1.75}}*{{box-sizing:border-box}}body{{margin:0;overflow-wrap:anywhere}}main{{max-width:1120px;margin:auto;padding:30px 22px 60px}}h1{{font-size:28px;line-height:1.4;margin:0 0 22px}}.table-wrap{{overflow:auto;border:1px solid #dfe5e9;border-radius:14px;background:#fff}}table{{width:100%;border-collapse:collapse;font-size:15px}}th,td{{text-align:left;padding:12px 16px;border-bottom:1px solid #dfe5e9}}th{{background:#eef2f6}}tr:last-child td{{border:0}}a{{color:#536e8a;text-underline-offset:4px}}:focus-visible{{outline:3px solid #728da9;outline-offset:3px}}@media(max-width:760px){{main{{padding:22px 14px}}h1{{font-size:26px}}}}@media print{{body{{background:#fff}}main{{padding:0}}tr{{break-inside:avoid}}}}
</style></head><body><main><h1>{html.escape(title)}</h1><div class="table-wrap" tabindex="0" aria-label="历史材料"><table><thead><tr><th scope="col">历史材料</th></tr></thead><tbody>{rows or '<tr><td>源文件保存在 raw 中。</td></tr>'}</tbody></table></div></main></body></html>\n'''


def finalize(folder: Path, title: str, records: list[dict]) -> None:
    for item in records:
        file = folder / item["path"]
        if file.stat().st_size != item["bytes"] or digest(file) != item["sha256"]:
            raise ValueError(f"Migrated evidence changed: {file}")
    marker = {"schema_version": 2, "kind": "task_archive", "delivery_layout": "task_raw_sibling_v2", "title": title, "created_at": datetime.now().astimezone().isoformat(), "thread_id": None}
    write_json(folder / "luz-task.json", marker)
    delivery = folder / f"{folder.name}.html"
    delivery.write_text(render_index(title, records), encoding="utf-8")
    write_json(folder / "raw" / "legacy-manifest.json", {"files": records})
    info = {"path": delivery.name, "bytes": delivery.stat().st_size, "sha256": digest(delivery)}
    write_json(folder / "raw" / "manifest.json", {"schema_version": 3, "kind": "task_report", "output_layout": "task_html_and_raw_v3", "primary_file": delivery.name, "title": title, "delivery": {"file": delivery.name, "bytes": info["bytes"], "sha256": info["sha256"]}, "files": [info, *records]})


def migrate(root: Path, apply: bool) -> dict:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError(f"Output root does not exist: {root}")
    entries = sorted(root.iterdir())
    if any(path.is_symlink() or path.is_junction() for path in entries):
        raise ValueError("Refusing linked output paths")
    loose = [path for path in entries if path.is_file() or path.name.lower() == "raw"]
    projects = [path for path in entries if path.is_dir() and path not in loose and not (path / "luz-task.json").exists()]
    highest = max([int(match[1]) for path in entries if (match := re.match(r"^(\d+)_", path.name))] or [0])
    plans = []
    if loose:
        target = root / "000_历史输出"
        if target.exists():
            highest += 1
            target = root / f"{highest:03d}_历史输出"
        plans.append((None, target, loose))
    for project in projects:
        target = project
        if not re.match(r"^\d+_", project.name):
            highest += 1
            target = root / f"{highest:03d}_{project.name}"
        plans.append((project, target, [project]))
    split = root / "000_历史输出" / "raw" / "legacy-root-raw"
    result = {"root": str(root), "projects": [{"source": str(source) if source else "loose output", "folder": str(target)} for source, target, _ in plans], "repair_split_raw": split.is_dir(), "applied": False}
    if not apply:
        return result
    if split.is_dir():
        folder = split.parent.parent
        old = json.loads((folder / "raw/legacy-manifest.json").read_text(encoding="utf-8"))["files"]
        for item in old:
            if digest(folder / item["path"]) != item["sha256"]:
                raise ValueError("Legacy inventory checksum mismatch; original files kept")
        destination = inside(root, folder / "raw/legacy-root/raw")
        if destination.exists():
            raise ValueError(f"Refusing to overwrite {destination}")
        shutil.move(str(inside(root, split)), str(destination))
        for item in old:
            item["path"] = item["path"].replace("raw/legacy-root-raw/", "raw/legacy-root/raw/", 1)
        finalize(folder, "历史输出", old)
    moved_files = 0
    for source, target, paths in plans:
        inside(root, target)
        snapshots = [(item, item.is_dir(), inventory(item) if item.is_dir() else [{"path": item.name, "bytes": item.stat().st_size, "sha256": digest(item)}]) for item in paths]
        if source == target:
            stage = inside(root, root / f".layout-migration-{uuid4()}")
            shutil.move(str(inside(root, source)), str(stage))
            snapshots = [(stage, True, snapshots[0][2])]
        elif target.exists():
            raise ValueError(f"Refusing to overwrite {target}")
        legacy = target / "raw" / "legacy-output"
        legacy.mkdir(parents=True)
        records = []
        for original, is_directory, items in snapshots:
            destination = legacy if source else legacy / original.name
            if source:
                legacy.rmdir()
            shutil.move(str(inside(root, original)), str(inside(root, destination)))
            for item in items:
                file = destination / item["path"] if is_directory else destination
                records.append({**item, "path": file.relative_to(target).as_posix()})
        finalize(target, re.sub(r"^\d+_", "", target.name), records)
        moved_files += len(records)
    result.update({"applied": True, "moved_files": moved_files})
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(migrate(args.root, args.apply), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
