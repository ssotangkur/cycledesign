# Sandbox Usage Guide

## Overview

The CycleDesign sandbox runs Qwen Code inside a Docker container with GUI support (VNC, Chromium, chrome-devtools-mcp).

## Important: Node Modules Protection

**The sandbox container runs as root to avoid permission changes on host files.**

### Why?

Windows junction points in `node_modules/@cycledesign/` cause permission conflicts when:
1. Container runs `chown` or `chmod` on `node_modules`
2. Host (Windows user) tries to access `node_modules` afterward  
3. Result: `EACCES: permission denied` errors on junction points

### Solution

The container:
- ✅ Runs as root (no permission changes needed)
- ✅ Mounts host's `~/.qwen` to `/root/.qwen`
- ✅ Does NOT run `chown` or `chmod` on `node_modules`
- ✅ Host `node_modules` permissions remain unchanged

## Starting the Sandbox

```powershell
# Basic start
.\scripts\sandbox-start.ps1

# Start with a command
.\scripts\sandbox-start.ps1 -y "fix the bug in the login form"
```

## Accessing the GUI

Once started, access the sandbox GUI:

- **noVNC (Browser)**: http://localhost:6080
- **VNC Client**: localhost:5900 (no password)
- **Chrome DevTools**: http://localhost:9222/json

## Stopping the Sandbox

```powershell
.\scripts\sandbox-stop.ps1
```

## Troubleshooting

### Permission errors after sandbox use

If you see `EACCES` errors on `node_modules`:

```powershell
# Clean reinstall on host
Remove-Item -Recurse -Force node_modules
npm install
```

### Sandbox build issues

Rebuild the sandbox image:

```powershell
docker build -f .qwen/sandbox.Dockerfile.gui -t cycledesign-sandbox:gui .
```

### GitHub authentication

Ensure `GH_TOKEN` is set:

```powershell
$env:GH_TOKEN = "ghp_your_token_here"
```

For permanent setup, add to your PowerShell profile:

```powershell
Add-Content $PROFILE "`$env:GH_TOKEN = `"ghp_your_token_here`"`"
```
