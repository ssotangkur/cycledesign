# CycleDesign Development Sandbox

This project supports **two sandbox modes** for AI-assisted development with Chrome DevTools integration.

---

## Quick Comparison

| Feature | Mode 1: Qwen Sandbox + MCP | Mode 2: Persistent Container |
|---------|---------------------------|------------------------------|
| **Use case** | AI-assisted coding | Manual testing/debugging |
| **Container lifecycle** | Ephemeral (per command) | Long-running |
| **Browser** | Chrome on host | Chromium inside container |
| **VNC access** | No | Yes (http://localhost:5800) |
| **Chrome DevTools MCP** | ✅ Yes | Manual via VNC |
| **Dev servers** | Started per session | Always running |
| **Git automation** | ✅ Yes | ✅ Yes |

---

## Mode 1: Qwen Code Sandbox + Chrome DevTools MCP (Recommended)

Qwen Code runs in an ephemeral Docker container and controls Chrome on your host machine via Chrome DevTools MCP.

### Setup

#### 1. Start Chrome with Remote Debugging

**Windows (PowerShell):**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:TEMP\chrome-dev-profile"
```

**Or use the helper script:**
```bash
scripts\start-chrome-dev.bat
```

**Verify Chrome is running:**
```bash
curl http://127.0.0.1:9222/json/version
```

You should see browser info with a `webSocketDebuggerUrl`.

#### 2. Configure Qwen Code MCP

The MCP configuration is already set up in `.qwen/settings.json`:

```json
{
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

#### 3. Run Qwen Code in Sandbox Mode

```bash
QWEN_SANDBOX=docker qwen -s
```

### Usage Examples

Once set up, you can ask Qwen Code to:

```
Navigate to http://localhost:3000 and take a screenshot
```

```
Check the browser console for any errors on localhost:3000
```

```
Use Chrome DevTools to inspect the login form and tell me what elements are present
```

```
Navigate to http://localhost:3000, click the submit button, and verify the page updates
```

### How It Works

```
┌─────────────────────────────────────────────────────┐
│ Host Machine                                        │
│                                                     │
│  Chrome (:9222) ← Remote Debugging                 │
│     ↑                                               │
│     │ localhost:9222                                │
│     ↓                                               │
│  chrome-devtools-mcp (MCP Server)                  │
│     ↑                                               │
│     │ MCP Protocol                                  │
│     ↓                                               │
│  Qwen Code CLI                                      │
│     │                                               │
│     └──→ Docker Sandbox Container                   │
│              ├── Code execution                     │
│              └── Access to host localhost:9222      │
└─────────────────────────────────────────────────────┘
```

**Key points:**
- Chrome runs on the **host** (your machine)
- MCP server runs on the **host** (via npx)
- Qwen Code connects to the MCP server
- Qwen can control Chrome to debug your web app

### Stopping Chrome

```bash
scripts\stop-chrome.bat
```

Or end `chrome.exe` in Task Manager.

---

## Mode 2: Persistent Development Container

Long-running container with VNC desktop access for manual browser testing.

### Setup

#### 1. Set Environment Variables

Set your GitHub token for automated pushes:

**Windows (PowerShell):**
```powershell
$env:SANDBOX_GITHUB_TOKEN="your_github_token_here"
```

**Linux/Mac (Bash):**
```bash
export SANDBOX_GITHUB_TOKEN="your_github_token_here"
```

**Optional:** Set permanently in your shell profile or Windows Environment Variables.

#### 2. Start the Container

```bash
scripts\sandbox-start.bat
```

The script will:
- Build the Docker image (first time only)
- Start the container with VNC and dev server ports
- Install npm dependencies
- Launch dev servers

#### 3. Access the Container

| Service | URL | Purpose |
|---------|-----|---------|
| **VNC Web** | http://localhost:5800 | Browser-based desktop |
| **VNC Client** | localhost:5900 | VNC client apps |
| **Web Server** | http://localhost:3000 | Dev server (from host) |
| **API Server** | http://localhost:3001 | API (from host) |
| **Preview** | http://localhost:3002 | Preview server (from host) |

### Usage

#### Manual Browser Testing

1. Open http://localhost:5800 in your browser
2. Enter VNC password (if set)
3. Use the terminal or file manager inside the desktop
4. Launch Chromium manually to test applications

#### Dev Servers

The container automatically starts:
- Vite dev server (port 3000)
- Express API server (port 3001)
- Preview server (port 3002)

Access them from your host browser at http://localhost:3000

#### Git Integration

With `SANDBOX_GITHUB_TOKEN` set, Qwen Code can:
- Make code changes
- Commit with meaningful messages
- Push to GitHub automatically

### Stopping the Container

```bash
scripts\sandbox-stop.bat
```

Or:
```bash
docker stop cycledesign-sandbox
docker rm cycledesign-sandbox
```

---

## Environment Variables

| Variable | Mode | Purpose |
|----------|------|---------|
| `SANDBOX_GITHUB_TOKEN` | Both | GitHub token for automated pushes |
| `VNC_PASSWORD` | Mode 2 | Password for VNC access (max 8 chars) |
| `DISPLAY_WIDTH` | Mode 2 | VNC desktop width (default: 1920) |
| `DISPLAY_HEIGHT` | Mode 2 | VNC desktop height (default: 1080) |

---

## Helper Scripts

| Script | Mode | Purpose |
|--------|------|---------|
| `scripts\start-chrome-dev.bat` | Mode 1 | Start Chrome with remote debugging |
| `scripts\stop-chrome.bat` | Mode 1 | Stop Chrome |
| `scripts\sandbox-start.bat` | Mode 2 | Start persistent container |
| `scripts\sandbox-stop.bat` | Mode 2 | Stop persistent container |

---

## Troubleshooting

### Mode 1: Chrome DevTools MCP

**"MCP server failed to start"**
```bash
curl http://127.0.0.1:9222/json/version
```
If error, restart Chrome: `scripts\start-chrome-dev.bat`

**"Cannot connect to browser"**
1. Close all Chrome windows
2. Run `scripts\stop-chrome.bat`
3. Run `scripts\start-chrome-dev.bat`
4. Restart Qwen Code

### Mode 2: Persistent Container

**Container won't start:**
```bash
docker logs cycledesign-sandbox
```

**VNC connection fails:**
- Check port 5800/5900 is not blocked
- Verify VNC_PASSWORD is set (max 8 characters)
- Try a VNC client instead of web interface

**Dev servers not accessible:**
- Check container is running: `docker ps`
- Restart container: `docker restart cycledesign-sandbox`
- Wait 2-3 minutes for servers to start

### Both Modes

**Git push fails:**
- Verify `SANDBOX_GITHUB_TOKEN` is correct and not expired
- Check token has `repo` scope
- Ensure git user.name and user.email are configured

**Need to rebuild:**
```bash
docker stop cycledesign-sandbox
docker rm cycledesign-sandbox
# Mode 1: QWEN_SANDBOX=docker BUILD_SANDBOX=1 qwen -s
# Mode 2: scripts\sandbox-start.bat (auto-builds)
```

---

## Security Notes

⚠️ **Remote debugging allows any process to control Chrome:**
- Do not browse sensitive sites (banking, email) while debugging is enabled
- Close Chrome when done with your development session
- Do not leave remote debugging enabled permanently

⚠️ **Token security:**
- Use a token with only `repo` scope (no admin access)
- Set expiration to 7-30 days and rotate regularly
- Token is only exposed to the container

---

## Architecture Overview

### Mode 1: Qwen Sandbox + MCP
```
Host Machine:
├── Chrome (port 9222) ← You control this
├── chrome-devtools-mcp ← MCP server
└── Qwen Code CLI
    └── Docker Container (ephemeral)
        └── Your code runs here
```

### Mode 2: Persistent Container
```
Host Machine:
└── Docker Container (always running)
    ├── VNC Desktop (port 5800/5900)
    ├── Chromium Browser
    ├── Dev Servers (3000/3001/3002)
    └── Git integration
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `.qwen/sandbox.Dockerfile` | Mode 1 sandbox image |
| `.qwen/sandbox.Dockerfile.persistent` | Mode 2 container image |
| `.qwen/settings.json` | MCP configuration |
| `.qwen/rootfs/startapp.sh` | Container startup script |

---

**Last updated:** March 2026
