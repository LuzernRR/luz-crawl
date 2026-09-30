#!/usr/bin/env python3
"""Make the OpenCLI Browser Bridge close its automation window after use.

Upstream keeps the owned container window open forever: when the last tab
lease is released, ``releaseLease`` navigates that tab to ``about:blank`` as a
"reusable placeholder". In the reference setup, an ``about:blank`` Edge window
survives every search. This patch replaces the placeholder branch with a plain
``chrome.tabs.remove``, which closes the window once its last owned tab goes;
``ensureOwnedContainerWindow`` already recreates a missing window on the next
command, so nothing else changes.

Idempotent. Re-run after every Browser Bridge update, then reload the extension
in ``edge://extensions``.

    python patch_opencli_bridge.py            # patch the default install
    python patch_opencli_bridge.py --check    # report state, change nothing
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

DEFAULT_EXT = Path(os.environ.get(
    "OPENCLI_BROWSER_BRIDGE_DIR",
    str(Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")).expanduser()
        / "skills" / "agent-reach" / "opencli-browser-bridge" / "opencli-extension-v1.0.21"),
)).expanduser()

MARKER = "/* luz-crawl: close container after last lease */"

# The upstream placeholder branch, matched from its opening line to the log call
# that ends it. Stable across 1.0.21-1.0.24.
OLD_HEAD = ("        try {\n"
            "          const tab = await chrome.tabs.update(tabId, { url: BLANK_PAGE, active: true });\n")
OLD_TAIL = ("as reusable placeholder (session=${session.session}, "
            "surface=${session.surface}, ${reason})`);\n")

NEW = (f"        {MARKER}\n"
       "        try {\n"
       "          await chrome.tabs.remove(tabId);\n"
       "          console.log(`[opencli] Released last owned tab lease ${tabId} and closed "
       "its container (session=${session.session}, surface=${session.surface}, ${reason})`);\n")


def patch(background: Path, check: bool) -> int:
    text = background.read_text(encoding="utf-8")
    if MARKER in text:
        print(f"already patched: {background}")
        return 0
    start = text.find(OLD_HEAD)
    end = text.find(OLD_TAIL, start)
    if start < 0 or end < 0:
        print(f"placeholder branch not found in {background}; upstream changed, "
              "patch needs updating", file=sys.stderr)
        return 2
    if check:
        print(f"unpatched: {background}")
        return 1
    end += len(OLD_TAIL)
    backup = background.with_suffix(".js.orig")
    if not backup.exists():
        shutil.copy2(background, backup)
    background.write_text(text[:start] + NEW + text[end:], encoding="utf-8")
    print(f"patched: {background}\nreload the extension in edge://extensions to apply")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ext", type=Path, default=DEFAULT_EXT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    return patch(args.ext / "dist" / "background.js", args.check)


if __name__ == "__main__":
    raise SystemExit(main())
