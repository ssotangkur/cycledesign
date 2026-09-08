# CycleDesign universal worker image for Docker Sandboxes (microVM).
#
# Stock opencode agent template + GUI stack (Xvfb/openbox/x11vnc/noVNC) +
# Chromium (via Playwright) + chrome-devtools-mcp, so every worker can do
# wrap-up UI verification with zero per-run provisioning decisions (#121).
#
# Base image ref: docker/sandbox-templates:opencode, digest pinned.
# Refresh: docker pull docker/sandbox-templates:opencode, then update DIGEST.
#
# Build + load into the sandbox runtime:
#   docker build -f sbx/sandbox.Dockerfile -t cycledesign-worker .
#   docker save cycledesign-worker | sbx template load   # (see `sbx template load --help`)
# Use:
#   sbx create -t cycledesign-worker opencode <workdir>
# Daemon: SBX_TEMPLATE=cycledesign-worker (default) in .agent-daemon.env.

FROM docker/sandbox-templates:opencode@sha256:88a078fc021d0a2b4c3315f21a6f05dfdda5a6b30369a53d185b5b6544465efc

USER root

ENV DISPLAY=:99 \
    DISPLAY_WIDTH=1920 \
    DISPLAY_HEIGHT=1080 \
    VNC_PORT=5900 \
    NOVNC_PORT=6080 \
    CHROME_DEBUGGING_PORT=9222 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers \
    DEBIAN_FRONTEND=noninteractive

# =============================================================================
# GUI stack (X11, VNC, noVNC, window manager, fonts)
# =============================================================================
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    socat \
    openbox \
    obconf \
    xterm \
    novnc \
    websockify \
    nginx \
    fonts-dejavu-core \
    fonts-noto-core \
    dbus-x11 \
    xdg-utils \
    wmctrl \
    xdotool \
    curl \
    jq \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# =============================================================================
# Chromium via Playwright (Ubuntu 26.04 ships chromium as a snap stub, so apt
# is not viable). World-readable so the `agent` user can launch it.
# =============================================================================
RUN npx -y playwright@latest install --with-deps chromium \
    && npm cache clean --force \
    && chmod -R a+rX /opt/playwright-browsers \
    && rm -rf /tmp/* /var/tmp/*

# =============================================================================
# chrome-devtools-mcp (global, on the agent PATH)
# =============================================================================
RUN npm install -g chrome-devtools-mcp \
    && npm cache clean --force \
    && chmod -R a+rX /usr/local/share/npm-global

# =============================================================================
# nginx as non-root (VM runs as `agent`)
# =============================================================================
RUN mkdir -p /var/log/nginx /var/cache/nginx /var/lib/nginx/body /etc/nginx/conf.d \
    && chown -R agent:agent /var/log/nginx /var/cache/nginx /var/lib/nginx \
    && rm -f /etc/nginx/sites-enabled/default

COPY <<'EOF' /etc/nginx/nginx.conf
worker_processes auto;
pid /tmp/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    sendfile on;
    keepalive_timeout 65;

    include /etc/nginx/conf.d/*.conf;
}
EOF

COPY <<'EOF' /etc/nginx/conf.d/novnc.conf
server {
    listen 6080;
    server_name localhost;

    root /usr/share/novnc;
    index vnc.html;

    location / {
        try_files $uri $uri/ /vnc.html;
    }

    location /websockify {
        proxy_pass http://127.0.0.1:6081/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
EOF

# =============================================================================
# start-gui: backgrounded by the entrypoint wrapper on every boot (universal
# image = GUI always ready, no per-run decision). Logs to /tmp/gui.log.
# =============================================================================
COPY <<'EOF' /usr/local/bin/start-gui
#!/bin/bash
# CycleDesign sandbox GUI bootstrap (Xvfb + openbox + VNC + noVNC + Chromium).
exec >>/tmp/gui.log 2>&1
set -x

# x11vnc refuses to start when WAYLAND_DISPLAY leaks into the VM env.
unset WAYLAND_DISPLAY XDG_SESSION_TYPE

CHROME_BIN="$(echo /opt/playwright-browsers/chromium-*/chrome-linux*/chrome | cut -d' ' -f1)"

mkdir -p /var/run/dbus 2>/dev/null || true
dbus-daemon --system --fork 2>/dev/null || true

Xvfb $DISPLAY -screen 0 ${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}x24 -ac +extension GLX +render -noreset &
sleep 2
xhost +local: 2>/dev/null || true

openbox &
x11vnc -display $DISPLAY -forever -shared -rfbport $VNC_PORT -nopw -listen 0.0.0.0 &
websockify 6081 localhost:$VNC_PORT &
nginx -g 'daemon off;' &

mkdir -p /tmp/chrome-profile
"$CHROME_BIN" \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --remote-debugging-port=$CHROME_DEBUGGING_PORT \
    --user-data-dir=/tmp/chrome-profile \
    --disable-background-networking \
    --disable-default-apps \
    --disable-extensions \
    --disable-sync \
    --no-first-run \
    about:blank &

echo "GUI ready: VNC=$VNC_PORT noVNC=$NOVNC_PORT CDP=$CHROME_DEBUGGING_PORT"
wait
EOF

RUN chmod +x /usr/local/bin/start-gui

# =============================================================================
# Entrypoint wrapper: GUI in background, then the stock agent lifecycle.
# Keeps base semantics (tini + `opencode agent`) untouched.
# =============================================================================
COPY <<'EOF' /usr/local/bin/sbx-entrypoint.sh
#!/bin/sh
set -e
/usr/local/bin/start-gui &
exec /usr/bin/tini -- "$@"
EOF

RUN chmod +x /usr/local/bin/sbx-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/sbx-entrypoint.sh"]

USER agent
WORKDIR /home/agent

EXPOSE 5900 6080 9222

LABEL maintainer="CycleDesign Team" \
      description="Universal opencode sandbox worker: GUI (VNC/noVNC), Chromium, chrome-devtools-mcp" \
      version="1.0.0"
