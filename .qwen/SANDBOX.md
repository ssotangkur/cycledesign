# CycleDesign Sandbox Documentation

## Overview

This project uses a **custom GUI-enhanced sandbox image** for AI-assisted development with integrated Chrome DevTools support.

### Features

- **VNC Server** (port 5900) - Full desktop access via VNC client
- **noVNC Web Interface** (port 6080) - Browser-based VNC access  
- **Chromium Browser** - Pre-installed with DevTools Protocol support
- **chrome-devtools-mcp** - Ready-to-use MCP server for browser automation
- **Openbox** - Lightweight window manager
- **X11/Xvfb** - Virtual display server

---

## Quick Start

### 1. Build the Image (First Time Only)

```bash
cd d:\Projects\cycledesign\.qwen
docker build -f sandbox.Dockerfile.gui -t cycledesign-sandbox:gui .
```

### 2. Run Qwen Code

```bash
qwen --sandbox --sandbox-image cycledesign-sandbox:gui -y
```

That's it! The sandbox automatically:
- Starts a virtual desktop with Chromium
- Enables Chrome DevTools Protocol
- Configures chrome-devtools-mcp
- Cleans up when done

---

## Access Methods

### 1. noVNC Web Interface (Recommended)

While Qwen Code is running in sandbox mode, open in your browser:

```
http://localhost:6080
```

**What you can do:**
- Visually see what the AI sees
- Manually navigate pages
- Debug layout issues
- Take screenshots via the UI

### 2. VNC Client

Connect to:
```
Host: localhost
Port: 5900
Password: (none)
```

**Recommended VNC Clients:**
- RealVNC Viewer (cross-platform)
- TigerVNC (Linux)
- Chicken of the VNC (macOS)

### 3. AI Commands (via MCP)

Ask Qwen Code to:

```
Open http://localhost:3000 in Chrome and check for console errors
```

```
Navigate to http://localhost:3000 and take a screenshot
```

```
Use Chrome DevTools to inspect the login form and tell me what elements are present
```

```
Click the submit button and verify the page updates
```

---

## Container Output

When the sandbox starts, you'll see:

```
hopping into sandbox (command: docker) ...
Checking for sandbox image: cycledesign-sandbox:gui
Sandbox image cycledesign-sandbox:gui found locally.

=== CycleDesign GUI Sandbox Starting ===
Display: :99
Resolution: 1920x1080
VNC Port: 5900
noVNC Web Interface: http://localhost:6080
Chrome Debugging Port: 9222

=== Services Started ===
- VNC Server: localhost:5900
- noVNC Web UI: http://localhost:6080/vnc.html?host=localhost&port=6081
- Chrome DevTools: http://localhost:9222
```

---

## Configuration

### Sandbox Settings

The settings are pre-configured in `.qwen/settings.json`:

```json
{
  "sandbox": {
    "image": "cycledesign-sandbox:gui",
    "docker": {
      "runArgs": [
        "-p", "5900:5900",
        "-p", "6080:6080",
        "-p", "9222:9222"
      ]
    }
  },
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest", "--browser-url=http://127.0.0.1:9222"],
      "timeout": 60000,
      "trust": true
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DISPLAY_WIDTH` | `1920` | Virtual display width |
| `DISPLAY_HEIGHT` | `1080` | Virtual display height |
| `SANDBOX_GITHUB_TOKEN` | - | GitHub token for automated pushes |

---

## Architecture

```
Host Machine:
└── Docker Container (ephemeral)
    ├── noVNC Web UI (port 6080) ← Access via browser
    ├── VNC Server (port 5900) ← Access via VNC client
    ├── Chromium (port 9222) ← DevTools Protocol
    ├── chrome-devtools-mcp ← MCP server
    └── Qwen Code CLI
        └── Your code runs here
```

**Key points:**
- Container is **ephemeral** - created per command, cleaned up after
- **All services start automatically** when sandbox launches
- **No host Chrome needed** - Chromium runs inside container
- **Visual + AI debugging** - Use noVNC for manual, MCP for automated

---

## Port Mapping Reference

| Port | Service | Access URL |
|------|---------|------------|
| 6080 | noVNC Web UI | `http://localhost:6080` |
| 5900 | VNC Server | `localhost:5900` (VNC client) |
| 9222 | Chrome DevTools | `http://localhost:9222/json` |

---

## Troubleshooting

### noVNC not loading

1. Check container is running:
   ```bash
   docker ps
   ```

2. View container logs:
   ```bash
   docker logs <container_name>
   ```

3. Try direct URL:
   ```
   http://localhost:6080/vnc.html?host=localhost&port=6081
   ```

### Chrome not responding

Inside the container, test Chrome connection:
```bash
test-chrome-connection
```

Check Chrome process:
```bash
docker exec <container> ps aux | grep chromium
```

### Permission errors

```bash
docker exec -u root <container> bash
chown -R node:node /tmp/chrome-profile
```

### Git push fails

- Verify `SANDBOX_GITHUB_TOKEN` is correct and not expired
- Check token has `repo` scope
- Ensure git user.name and user.email are configured

### Need to rebuild image

```bash
cd d:\Projects\cycledesign\.qwen
docker build -f sandbox.Dockerfile.gui -t cycledesign-sandbox:gui .
```

---

## Security Notes

⚠️ **Remote debugging allows any process to control Chrome:**
- Do not browse sensitive sites (banking, email) while debugging is enabled
- Close Chrome when done with your development session

⚠️ **VNC has no password by default:**
- Only expose ports to localhost
- Do not expose VNC ports to public networks

⚠️ **Chrome runs with --no-sandbox:**
- This is acceptable for development containers
- Do not use in production environments

⚠️ **Token security:**
- Use a token with only `repo` scope (no admin access)
- Set expiration to 7-30 days and rotate regularly

---

## Customization

### Change Display Resolution

Add to Docker run args:
```bash
-e DISPLAY_WIDTH=2560 -e DISPLAY_HEIGHT=1440
```

### Add VNC Password

Modify the `start-gui` script in the Dockerfile:
```bash
# Set VNC password
x11vnc -storepasswd yourpassword /etc/vncpass
x11vnc -display $DISPLAY -forever -shared -rfbport $VNC_PORT -usepw /etc/vncpass
```

### Install Additional Software

Extend the Dockerfile:
```dockerfile
FROM cycledesign-sandbox:gui

RUN apt-get update && apt-get install -y \
    firefox \
    gimp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
```

---

## Performance Tips

1. **Limit Chrome Extensions** - Already disabled by default

2. **Lower Resolution** - Uses less resources:
   ```bash
   -e DISPLAY_WIDTH=1280 -e DISPLAY_HEIGHT=720
   ```

3. **Resource Limits** - Consider Docker limits:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2'
         memory: 2G
   ```

---

## Files Reference

| File | Purpose |
|------|---------|
| `.qwen/sandbox.Dockerfile.gui` | GUI sandbox Docker image |
| `.qwen/settings.json` | MCP and sandbox configuration |
| `.qwen/SANDBOX.md` | This documentation |

---

## Related Resources

- [Qwen Code Documentation](https://qwenlm.github.io/qwen-code-docs/)
- [chrome-devtools-mcp](https://www.npmjs.com/package/chrome-devtools-mcp)
- [noVNC Project](https://novnc.com/)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)

---

**Last updated:** March 2026
