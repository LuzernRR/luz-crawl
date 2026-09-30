#!/usr/bin/env python3
"""Silent Microsoft Edge lifecycle for the crawl layer.

Why this module exists
----------------------
Attaching to the Edge the user already has open is **not possible**. Chromium
binds the DevTools server only when ``--remote-debugging-port`` is present at
process start; there is no IPC to enable it later. Edge 136+ additionally
refuses remote debugging on the default ``user-data-dir`` as an anti
cookie-theft measure. Relaunching the default profile with the flag does not
help either: the process singleton forwards the request to the running Edge and
the launcher exits, so the port never opens.

So the only workable shape is: **spawn our own Edge, silently, and reap it.**

Launcher identity
-----------------
``C:\\Users\\Public\\Desktop\\Microsoft Edge.lnk`` is the only sanctioned Edge
identity in this setup. The shortcut carries no arguments, and invoking the
``.lnk`` itself would merely hand a tab to the running Edge, so this module
*resolves* the shortcut and launches its target with its own flags. The
shortcut decides *which binary*; it cannot carry the flags. No other browser is
ever used -- not Chrome, not Playwright's bundled Chromium.

Silence and cleanup
-------------------
Every launch is windowless: ``--headless=new`` by default, ``CREATE_NO_WINDOW``
so no console flashes, and a headed fallback parked at ``-32000,-32000`` for
sites that refuse the headless renderer. Every launch is reaped on the way out
-- gracefully via ``Browser.close``, then ``taskkill /T /F`` by PID, then a
sweep for any straggler carrying our unique marker. A browser we merely adopted
is never touched, and nothing is ever killed by image name.
"""

from __future__ import annotations

import atexit
import json
import os
import socket
import subprocess
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

# The default system-wide Edge launcher identity.
EDGE_SHORTCUT = r"C:\Users\Public\Desktop\Microsoft Edge.lnk"

# Consulted only when the shortcut is missing or unreadable; always recorded.
_FALLBACK_EDGE = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
)

# Persistent crawl profile: separate from the user's Edge (whose profile we can
# never share while it runs) and reused across runs so a one-time login lasts.
DEFAULT_PROFILE = os.environ.get(
    "LUZ_CRAWL_EDGE_PROFILE", str(Path.home() / ".luz-crawl-browser"))

# Ports scanned for an already-running *Edge* we may adopt.
ADOPT_PORTS = (9223, 9222, 9333)

# Headless leaks a "HeadlessChrome" UA token, which is a free bot signal on all
# three target platforms. Override it with a real Edge token.
EDGE_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
           "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0")

CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200

_PS = ("powershell", "-NoProfile", "-NonInteractive", "-Command")

_LAUNCH_LOG: list[str] = []


def launch_notes() -> list[str]:
    """Provenance lines worth preserving in a run's raw evidence."""
    return list(_LAUNCH_LOG)


def _note(line: str) -> None:
    _LAUNCH_LOG.append(line)


# --- launcher identity -------------------------------------------------------

_resolved_exe: str | None = None


def resolve_launcher(shortcut: str = EDGE_SHORTCUT) -> str:
    """Return the Edge executable named by the sanctioned shortcut.

    Reads the ``.lnk`` through WScript.Shell rather than assuming an install
    path, because 32-bit and 64-bit Edge live in different Program Files trees.
    """
    global _resolved_exe
    if _resolved_exe:
        return _resolved_exe

    if Path(shortcut).exists():
        quoted = shortcut.replace("'", "''")
        script = (
            "$ErrorActionPreference='Stop';"
            "$w=New-Object -ComObject WScript.Shell;"
            f"Write-Output $w.CreateShortcut('{quoted}').TargetPath"
        )
        try:
            out = subprocess.run(list(_PS) + [script], capture_output=True,
                                 text=True, timeout=25,
                                 creationflags=CREATE_NO_WINDOW)
            lines = [ln.strip() for ln in (out.stdout or "").splitlines() if ln.strip()]
            target = lines[-1] if lines else ""
            if target and Path(target).exists():
                _resolved_exe = target
                _note(f"edge launcher resolved from shortcut: {target}")
                return target
            _note(f"shortcut resolved to a missing target: {target!r}")
        except Exception as exc:
            _note(f"shortcut unreadable ({type(exc).__name__}: {exc})")
    else:
        _note(f"sanctioned shortcut not found: {shortcut}")

    for candidate in _FALLBACK_EDGE:
        if Path(candidate).exists():
            _resolved_exe = candidate
            _note(f"FALLBACK: shortcut unusable, using known Edge path {candidate}")
            return candidate

    raise RuntimeError(
        "Microsoft Edge could not be located. The sanctioned launcher "
        f"{shortcut} is missing or broken and no Edge install was found at "
        + " or ".join(_FALLBACK_EDGE))


# --- CDP endpoint probing ----------------------------------------------------

def probe_endpoint(endpoint: str, timeout: float = 2.5) -> dict | None:
    """Return ``/json/version`` for a live CDP endpoint, else None."""
    try:
        url = endpoint.rstrip("/") + "/json/version"
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8", "replace"))
    except Exception:
        return None


def is_edge(version: dict | None) -> bool:
    """True when a CDP endpoint is Microsoft Edge rather than another Chromium.

    This check is load-bearing. A stray headless *Chrome* left on 9222 by an
    unrelated job is a perfectly live CDP endpoint that would otherwise be
    adopted silently, handing back a browser with none of the user's existing browser state.
    """
    if not version:
        return False
    blob = "%s %s" % (version.get("Browser", ""), version.get("User-Agent", ""))
    return "Edg/" in blob or "Edge/" in blob


def find_adoptable(ports=ADOPT_PORTS) -> str | None:
    """Return the endpoint of an already-running CDP-enabled Edge, if any.

    This is rare in practice: a normally-started Edge exposes no CDP port at
    all. It matters for a previous luz-crawl browser still alive, or an Edge the
    user deliberately started with remote debugging.
    """
    for port in ports:
        endpoint = f"http://127.0.0.1:{port}"
        version = probe_endpoint(endpoint)
        if version is None:
            continue
        if is_edge(version):
            _note(f"adopted existing Edge at {endpoint} ({version.get('Browser')})")
            return endpoint
        _note(f"skipped {endpoint}: not Edge ({version.get('Browser')!r})")
    return None


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


# --- launching ---------------------------------------------------------------

def _flags(port: int, profile: str, *, headless: bool, marker: str,
           visible: bool = False, urls: "list[str] | None" = None) -> list[str]:
    flags = [
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile}",
        "--profile-directory=Default",
        # CDP's WebSocket handshake is rejected without this on modern Chromium.
        "--remote-allow-origins=*",
        # Keep the UA free of the HeadlessChrome token.
        f"--user-agent={EDGE_UA}",
        "--lang=zh-CN",
        # Quiet every first-run, upsell, restore and telemetry surface, so that
        # nothing can draw a window even in the headed fallback.
        "--no-first-run",
        "--no-default-browser-check",
        "--no-service-autorun",
        "--hide-crash-restore-bubble",
        "--disable-session-crashed-bubble",
        "--disable-infobars",
        "--disable-sync",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-client-side-phishing-detection",
        "--disable-default-apps",
        "--disable-notifications",
        "--disable-features=Translate,MediaRouter,OptimizationHints,"
        "msEdgeSplitScreen,msImplicitSignin",
        "--mute-audio",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        # Drops the "Chrome is being controlled by automated software" surface
        # and the AutomationControlled blink feature that exposes it.
        "--disable-blink-features=AutomationControlled",
        f"--luz-crawl-marker={marker}",
    ]
    flags += list(urls or ["about:blank"])
    if headless:
        flags.insert(0, "--headless=new")
    elif visible:
        # The login bootstrap only. A real, on-screen window at a normal size,
        # because a QR code has to be scanned by a human -- the one case where
        # being invisible would defeat the purpose.
        flags[0:0] = ["--window-size=1280,900", "--window-position=80,60"]
    else:
        # Headed but parked far off every physical desktop: still invisible, and
        # a materially cleaner fingerprint than headless when a platform starts
        # refusing the headless renderer.
        flags[0:0] = ["--window-position=-32000,-32000", "--window-size=1440,960"]
    return flags


@dataclass
class EdgeHandle:
    """A CDP endpoint plus what is needed to take it down again."""

    endpoint: str
    owned: bool
    pid: int | None = None
    marker: str | None = None
    profile: str | None = None
    headless: bool = True
    _closed: bool = field(default=False, repr=False)

    @property
    def port(self) -> str:
        return self.endpoint.rsplit(":", 1)[-1]

    def close(self) -> None:
        """Shut down only a browser this process started."""
        if self._closed or not self.owned:
            self._closed = True
            return
        self._closed = True
        _shutdown(self)

    def __enter__(self) -> "EdgeHandle":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()


_OWNED: list[EdgeHandle] = []


def launch(*, profile: str = DEFAULT_PROFILE, headless: bool = True,
           port: int | None = None, timeout: float = 45.0,
           visible: bool = False, urls: "list[str] | None" = None,
           reap_on_exit: bool = True) -> EdgeHandle:
    """Start an Edge and return a handle to its CDP endpoint.

    Silent by default: headless, or headed but parked off-screen when the caller
    asks for a heading renderer. ``visible=True`` is the deliberate exception for
    the interactive login bootstrap, and it also implies ``reap_on_exit=False``,
    since the profile is not logged in until the human says it is.
    """
    if visible:
        headless = False
        reap_on_exit = False
    exe = resolve_launcher()
    port = port or _free_port()
    marker = f"luzcrawl-{os.getpid()}-{int(time.time() * 1000) % 10_000_000}"
    Path(profile).mkdir(parents=True, exist_ok=True)

    args = [exe] + _flags(port, profile, headless=headless, marker=marker,
                          visible=visible, urls=urls)
    proc = subprocess.Popen(
        args,
        creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL)

    handle = EdgeHandle(endpoint=f"http://127.0.0.1:{port}", owned=True,
                        pid=proc.pid, marker=marker, profile=profile,
                        headless=headless)
    if reap_on_exit:
        _OWNED.append(handle)

    deadline = time.time() + timeout
    while time.time() < deadline:
        version = probe_endpoint(handle.endpoint, timeout=1.5)
        if version:
            if not is_edge(version):
                handle.close()
                raise RuntimeError(
                    f"port {port} answered but is not Edge: {version.get('Browser')!r}")
            _note("launched %s Edge pid=%s port=%s profile=%s (%s)" % (
                "headless" if headless else ("VISIBLE" if visible else "headed-offscreen"),
                proc.pid, port, profile, version.get("Browser")))
            return handle
        if proc.poll() is not None:
            handle._closed = True
            if handle in _OWNED:
                _OWNED.remove(handle)
            raise RuntimeError(
                f"Edge exited immediately (code {proc.returncode}) without opening "
                f"port {port}. The usual cause is another Edge already holding "
                f"--user-data-dir={profile}.")
        time.sleep(0.25)

    handle.close()
    raise RuntimeError(f"Edge did not expose CDP on port {port} within {timeout:.0f}s")


# --- shutdown ----------------------------------------------------------------

def _graceful(handle: EdgeHandle) -> bool:
    """Ask the browser to close itself over CDP.

    Worth trying before the hard kill: a clean exit flushes the profile and
    avoids marking it as crashed, which keeps the reused profile free of
    restore prompts on the next headed launch.
    """
    version = probe_endpoint(handle.endpoint, timeout=2.0)
    ws_url = (version or {}).get("webSocketDebuggerUrl")
    if not ws_url:
        return False
    try:
        import websocket  # websocket-client
    except Exception:
        return False
    try:
        conn = websocket.create_connection(ws_url, timeout=5)
        conn.send(json.dumps({"id": 1, "method": "Browser.close"}))
        try:
            conn.settimeout(3)
            conn.recv()
        except Exception:
            pass
        conn.close()
        return True
    except Exception:
        return False


def _sweep(marker: str) -> int:
    """Kill any msedge.exe still carrying our marker.

    Children inherit the full command line, so the marker reaches renderer, GPU
    and crashpad helpers too. This is how the reap stays surgical: it can never
    match the user's own Edge processes. ``wmic`` is gone on Windows 11 26200,
    hence Get-CimInstance.
    """
    script = (
        "$n=0; Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
        f"Where-Object {{ $_.CommandLine -like '*{marker}*' }} | "
        "ForEach-Object { $n++; taskkill /PID $_.ProcessId /T /F > $null 2>&1 }; "
        "Write-Output $n")
    try:
        out = subprocess.run(list(_PS) + [script], capture_output=True, text=True,
                             timeout=30, creationflags=CREATE_NO_WINDOW)
        tail = [ln.strip() for ln in (out.stdout or "").splitlines() if ln.strip()]
        return int(tail[-1]) if tail and tail[-1].isdigit() else 0
    except Exception:
        return 0


def _shutdown(handle: EdgeHandle) -> None:
    if _graceful(handle):
        for _ in range(12):
            if probe_endpoint(handle.endpoint, timeout=1.0) is None:
                break
            time.sleep(0.25)
    if handle.pid:
        try:
            subprocess.run(["taskkill", "/PID", str(handle.pid), "/T", "/F"],
                           capture_output=True, timeout=20,
                           creationflags=CREATE_NO_WINDOW)
        except Exception:
            pass
    swept = _sweep(handle.marker) if handle.marker else 0
    _note(f"closed owned Edge pid={handle.pid} port={handle.port} swept={swept}")
    if handle in _OWNED:
        _OWNED.remove(handle)


@atexit.register
def _reap_all() -> None:
    """Never leave a spawned Edge behind, even on an unhandled exception."""
    for handle in list(_OWNED):
        try:
            handle.close()
        except Exception:
            pass


# --- the one call the crawl layer needs --------------------------------------

def acquire(*, profile: str = DEFAULT_PROFILE, headless: bool = True,
            adopt: bool = True, endpoint: str | None = None) -> EdgeHandle:
    """Get a usable CDP endpoint, preferring a browser we need not start.

    Order: an explicitly supplied endpoint, then an already-running Edge with
    remote debugging, then a freshly launched silent Edge. Only the last is
    owned, and only an owned browser is ever closed.
    """
    if endpoint:
        version = probe_endpoint(endpoint)
        if not version:
            raise RuntimeError(f"no CDP endpoint answered at {endpoint}")
        if not is_edge(version):
            raise RuntimeError(
                f"{endpoint} is {version.get('Browser')!r}, not Microsoft Edge. "
                "Refusing to crawl through a browser that is not the sanctioned one.")
        _note(f"using caller-supplied endpoint {endpoint} ({version.get('Browser')})")
        return EdgeHandle(endpoint=endpoint, owned=False)

    if adopt:
        found = find_adoptable()
        if found:
            return EdgeHandle(endpoint=found, owned=False)

    return launch(profile=profile, headless=headless)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Inspect or exercise the silent Edge layer.")
    parser.add_argument("--headed", action="store_true",
                        help="launch headed-offscreen instead of headless")
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--no-adopt", action="store_true",
                        help="always launch a fresh Edge, never adopt a running one")
    parser.add_argument("--hold", type=float, default=0.0,
                        help="seconds to keep the browser alive before closing")
    args = parser.parse_args()

    print(f"shortcut : {EDGE_SHORTCUT}")
    print(f"target   : {resolve_launcher()}")
    handle = acquire(profile=args.profile, headless=not args.headed,
                     adopt=not args.no_adopt)
    try:
        version = probe_endpoint(handle.endpoint) or {}
        print(f"endpoint : {handle.endpoint}  owned={handle.owned}")
        print(f"browser  : {version.get('Browser')}")
        print(f"ua       : {version.get('User-Agent')}")
        if args.hold:
            time.sleep(args.hold)
    finally:
        handle.close()
    for line in launch_notes():
        print(f"  note: {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
