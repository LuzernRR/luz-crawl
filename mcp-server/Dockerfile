FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_GC=1 \
    NODE_OPTIONS=--max-old-space-size=256 \
    HOME=/home/node \
    LUZ_PROJECT_ROOT=/app \
    LUZ_CRAWL_STATE=/data/state \
    LUZ_OUTPUT_ROOT=/data/outputs \
    LUZ_OPENCLI_ROOT=/usr/local/lib/node_modules/@jackwener/opencli \
    LUZ_MCP_HOST=0.0.0.0 \
    DISPLAY=:99

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb x11vnc fluxbox novnc x11-utils netcat-openbsd tini fonts-noto-cjk ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/mcp-server
COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npx playwright install --with-deps --no-shell chromium \
    && npm install -g @jackwener/opencli@1.8.8 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY browser-extension/ ./browser-extension/
COPY opencli/ ./opencli/
COPY references/ ./references/
COPY scripts/luz-crawl.mjs ./scripts/luz-crawl.mjs
COPY mcp-server/ ./mcp-server/
RUN mkdir -p /data /home/node/.opencli \
    && chown -R node:node /app /data /home/node/.opencli \
    && chmod 0755 /app/mcp-server/start.sh

USER node
RUN opencli plugin install /app/opencli
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8765/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "-g", "--", "/app/mcp-server/start.sh"]
