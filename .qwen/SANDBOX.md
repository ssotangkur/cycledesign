# CycleDesign Qwen Sandbox

## Overview

Custom GUI-enhanced sandbox image for AI-assisted development with Chrome DevTools integration.

### Features

- **VNC Server** (port 5900) - Full desktop access
- **noVNC Web Interface** (port 6080) - Browser-based VNC
- **Chromium Browser** - DevTools Protocol support
- **chrome-devtools-mcp** - Browser automation via MCP
- **GitHub CLI** - Pre-configured with your token

---

## Quick Start

### 1. Build the Image

```bash
cd .qwen
docker build -f sandbox.Dockerfile.gui -t cycledesign-sandbox:gui .
```

### 2. Set Environment Variables

**Windows (PowerShell):**
```powershell
$env:GH_TOKEN = "ghp_your_token_here"
.\scripts\sandbox-start.ps1 -y "your prompt"
```

**Linux/macOS:**
```bash
export GH_TOKEN="ghp_your_token_here"
./scripts/sandbox-start.sh -y "your prompt"
```

**Or set permanently:**
- Windows: Add to PowerShell profile
- Linux/macOS: Add to `~/.bashrc` or `~/.zshrc`

### 3. Access the GUI

While running:
- **Browser:** http://localhost:6080
- **VNC Client:** localhost:5900 (no password)

---

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `GH_TOKEN` | GitHub Personal Access Token (scope: `repo`) |

### Optional Settings

Edit `~/.qwen/settings.json` for:
- MCP server configuration
- Model preferences
- Authentication settings

The project's `.qwen/settings.json` contains the Chrome DevTools MCP configuration.

---

## Architecture

```
Host → Docker Container (ephemeral)
  ├─ VNC Server (5900)
  ├─ noVNC Web UI (6080)
  ├─ Chromium (9222 internal)
  ├─ chrome-devtools-mcp
  └─ Qwen Code CLI
```

**Key points:**
- Container created per command, cleaned up after
- Chromium runs inside container (no host Chrome needed)
- GitHub token mounted from `~/.qwen` to `/root/.qwen`

---

## Troubleshooting

**noVNC not loading:**
```bash
docker ps  # Check container is running
docker logs cycledesign-sandbox-gui-0  # View logs
```

**Chrome not responding:**
```bash
docker exec cycledesign-sandbox-gui-0 curl http://127.0.0.1:9222/json/version
```

**Rebuild image:**
```bash
cd .qwen && docker build -f sandbox.Dockerfile.gui -t cycledesign-sandbox:gui .
```

---

## Security Notes

⚠️ **VNC has no password** - Only expose to localhost  
⚠️ **Chrome DevTools open** - Don't browse sensitive sites while debugging  
⚠️ **Token scope** - Use `repo` scope only, rotate regularly

---

**Last updated:** March 2026
