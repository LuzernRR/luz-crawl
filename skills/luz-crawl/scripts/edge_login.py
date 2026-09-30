#!/usr/bin/env python3
"""Open the crawl profile's Edge so you can log in. User-initiated only.

The crawl path is silent by contract: it launches a headless Edge and reaps it,
and nothing in a normal run ever puts a window on screen. Logging in cannot work
that way -- a QR code has to be scanned by a human -- so it gets its own command
that you run deliberately.

    python edge_login.py                # Zhihu + Xiaohongshu
    python edge_login.py --site xhs     # one site
    python edge_login.py --status       # report profile state, open nothing

This does start an Edge, and this one is visible, because that is the entire
point. Close the window yourself when done -- this script does not reap it,
since a login is not finished until you say it is. Between runs the profile keeps
the resulting cookies, so later silent crawls reuse the session.

The profile is the dedicated crawl profile, never your everyday Edge profile:
touching that one would mean competing with the Edge you already have open, and
Edge refuses remote debugging on a default profile directory anyway.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import edge_session  # noqa: E402

SITES = {
    "zhihu": "https://www.zhihu.com/signin",
    "xhs": "https://www.xiaohongshu.com/explore",
}


def profile_state() -> dict:
    """What the crawl profile already carries: presence, not contents."""
    profile = Path(edge_session.DEFAULT_PROFILE)
    cookies = profile / "Default" / "Network" / "Cookies"
    return {
        "profile": str(profile),
        "exists": profile.exists(),
        "has_cookie_store": cookies.exists(),
        "cookie_store_bytes": cookies.stat().st_size if cookies.exists() else 0,
        "cookie_store_mtime": (time.strftime(
            "%Y-%m-%d %H:%M:%S", time.localtime(cookies.stat().st_mtime))
            if cookies.exists() else None),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Open the crawl profile for an interactive login.",
        epilog="The window is NOT closed automatically: close it when you are done.")
    parser.add_argument("--site", choices=sorted(SITES), action="append",
                        default=None,
                        help="which site to open (default: all)")
    parser.add_argument("--status", action="store_true",
                        help="report the profile's state and exit without opening anything")
    parser.add_argument("--profile", default=edge_session.DEFAULT_PROFILE)
    parser.add_argument("--wait", type=int, default=0,
                        help="seconds to hold the window before exiting (0 = stay "
                             "until you close it)")
    args = parser.parse_args()

    print(json.dumps(profile_state(), ensure_ascii=False, indent=2))
    if args.status:
        print("\n(status only -- nothing opened)")
        return 0

    sites = args.site or sorted(SITES)
    urls = [SITES[s] for s in sites]

    print(f"\nOpening a VISIBLE Edge on the crawl profile:\n  {args.profile}")
    print("Log in (scan the QR code), then close the window yourself.\n")
    for name, url in zip(sites, urls):
        print(f"  {name:<6} {url}")

    handle = edge_session.launch(profile=args.profile, headless=False,
                                 urls=urls, reap_on_exit=False,
                                 windowed=True)
    print(f"\nEdge pid={handle.pid} cdp={handle.endpoint}")
    if args.wait:
        print(f"holding for {args.wait}s ...")
        time.sleep(args.wait)
        handle.close()
        print("closed.")
    else:
        print("Leave this command running, or just close the Edge window when done.")
        print("If you close the window, Ctrl+C here to finish.")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            print("\nleaving Edge running; it keeps the login in the profile.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
