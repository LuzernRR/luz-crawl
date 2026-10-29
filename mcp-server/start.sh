#!/bin/sh
set -eu

Xvfb :99 -screen 0 1280x800x16 -nolisten tcp >/dev/null 2>&1 &
attempt=0
until xdpyinfo -display :99 >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 100 ]; then
    echo "虚拟显示器启动失败。" >&2
    exit 1
  fi
  sleep 0.1
done
fluxbox >/dev/null 2>&1 &
x11vnc -display :99 -localhost -forever -shared -nopw -rfbport 5900 >/dev/null 2>&1 &
vnc_pid=$!
attempt=0
until nc -z 127.0.0.1 5900; do
  attempt=$((attempt + 1))
  if ! kill -0 "$vnc_pid" 2>/dev/null || [ "$attempt" -ge 100 ]; then
    echo "验证画面服务启动失败。" >&2
    exit 1
  fi
  sleep 0.1
done
exec node /app/mcp-server/server.mjs
