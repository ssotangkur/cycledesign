# CycleDesign Qwen Sandbox Scripts

Quick launch scripts for running Qwen Code in Docker sandbox mode with GUI support.

## Quick Start

### Windows (PowerShell)
```powershell
$env:GH_TOKEN="ghp_your_token_here"
scripts\sandbox-start.ps1 -y "fix the bug"
```

### Windows (CMD)
```cmd
set GH_TOKEN=ghp_your_token_here
scripts\sandbox-start.bat -y "fix the bug"
```

### Linux/macOS
```bash
export GH_TOKEN=ghp_your_token_here
./scripts/sandbox-start.sh -y "fix the bug"
```

## What It Does

The script sets up environment variables and runs `qwen` with all arguments passed through:

- **QWEN_SANDBOX=true** - Enables sandbox mode
- **QWEN_SANDBOX_IMAGE=cycledesign-sandbox:gui** - Uses custom GUI-enhanced image
- **SANDBOX_FLAGS** - Passes port mappings to Docker
- **GH_TOKEN** - GitHub authentication for `gh` CLI and git operations

All arguments are passed directly to `qwen`.

## Access URLs

Once running, you can access:

| Service | URL | Client |
|---------|-----|--------|
| noVNC (Browser) | `http://localhost:6080` | Any web browser |
| VNC Client | `localhost:5900` | RealVNC, TightVNC |

**Note:** Chrome DevTools runs inside the container and is accessible to Qwen Code at `http://127.0.0.1:9222`

## Usage Examples

### Interactive mode
```powershell
$env:GH_TOKEN="ghp_your_token_here"
scripts\sandbox-start.ps1
```

### YOLO mode (auto-approve)
```powershell
scripts\sandbox-start.ps1 -y
```

### With a prompt
```powershell
scripts\sandbox-start.ps1 -y "fix the bug in app.ts"
```

### Interactive prompt
```powershell
scripts\sandbox-start.ps1 -i "explain this codebase"
```

### Any other qwen flags
```powershell
scripts\sandbox-start.ps1 -y --model coder-model "analyze the project"
```

### Stopping the sandbox
```powershell
scripts\sandbox-stop.ps1  # Windows
./scripts/sandbox-stop.sh  # Linux/macOS
```

## First-Time Setup

### 1. Build the Sandbox Image

```bash
cd .qwen
docker build -f sandbox.Dockerfile.gui -t cycledesign-sandbox:gui .
```

### 2. Set GitHub Token

**Windows (Permanent):**
```powershell
# Add to PowerShell profile
Add-Content $PROFILE '$env:GH_TOKEN = "ghp_your_token_here"'
```

**Linux/macOS (Add to ~/.bashrc or ~/.zshrc):**
```bash
export GH_TOKEN=ghp_your_token_here
```

### 3. Install VNC Client (Optional)

For browser-free access:
- [RealVNC Viewer](https://www.realvnc.com/en/connect/download/viewer/windows/) (free)
- [TightVNC](https://www.tightvnc.com/download.php) (free)

Connect to: `localhost:5900` (no password)

## How It Works

The script runs `qwen` with sandbox mode enabled. Qwen Code will:

1. Start a Docker container using `cycledesign-sandbox:gui`
2. Mount the workspace and `.qwen` config directory into the container
3. Run qwen commands inside the isolated container
4. Clean up the container when done

The container includes:
- **Chromium browser** with DevTools Protocol
- **VNC server** for desktop access
- **noVNC** for browser-based VNC
- **gh CLI** pre-authenticated with your token
- **chrome-devtools-mcp** for browser automation

## Troubleshooting

### "GH_TOKEN is not set"
Set the environment variable:
```powershell
$env:GH_TOKEN="ghp_your_token_here"  # PowerShell
export GH_TOKEN=ghp_your_token_here  # Linux/macOS
```

### "Image not found"
Build the image first:
```bash
cd .qwen
docker build -f sandbox.Dockerfile.gui -t cycledesign-sandbox:gui .
```

### "Port already in use"
Stop existing containers:
```bash
docker ps | findstr cycledesign-sandbox
docker kill <container-id>
```
Or use the stop script:
```powershell
scripts\sandbox-stop.ps1  # Windows
./scripts/sandbox-stop.sh  # Linux/macOS
```

### VNC connection refused
Wait a few seconds for the container to fully start. The GUI services take ~5 seconds to initialize.

### Docker not running
Start Docker Desktop before running the script.

### Sandbox build issues

Rebuild the sandbox image:
```bash
cd .qwen
docker build -f sandbox.Dockerfile.gui -t cycledesign-sandbox:gui .
```

## Related Files

| File | Purpose |
|------|---------|
| `agent-daemon.ts` | Polling-first runner: watches `ready to plan` / `ready to implement` labels and invokes fire-and-forget skills via the opencode CLI |
| `sandbox-start.bat` | Windows CMD launcher (wraps PowerShell) |
| `sandbox-start.ps1` | Windows PowerShell launcher (recommended) |
| `sandbox-start.sh` | Linux/macOS launcher |
| `../.qwen/sandbox.Dockerfile.gui` | Custom sandbox Dockerfile |
| `../.qwen/settings.json` | Qwen Code settings (MCP config) |
| `../.qwen/SANDBOX.md` | Full sandbox documentation |

## Agent Daemon

Polling-first runner (`agent-daemon.ts`, TypeScript via `npx tsx`) that watches
issue labels and invokes the fire-and-forget skills via the opencode CLI,
resuming after each run. Ref: issue #98.

Label → skill mapping:

| Label | Command |
|-------|---------|
| `ready to plan` | `opencode run --command "gh-plan-with-reason" "<N>"` |
| `ready to implement` | `opencode run --command "resolve-issue" "<N>"` |

`question` / `pr ready` are terminal and never re-triggered (not polled).
Runs are sequential, oldest-first, one CLI at a time.

### Usage

```bash
npx tsx scripts/agent-daemon.ts --once --dry-run   # single pass, no spawning
npm run agent-daemon:once                          # single pass for real
npm run agent-daemon                               # loop forever (60s default)
```

### Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--repo OWNER/REPO` | `ssotangkur/cycledesign` | Repository to poll (must match `OWNER/REPO`) |
| `--interval SECONDS` | `60` | Poll interval, positive integer |
| `--once` | — | Single poll pass, then exit |
| `--dry-run` | — | Print planned invocations without spawning opencode |
| `--help` | — | Show usage and exit |

Note: `npm run` swallows its own `--dry-run` flag instead of forwarding it,
so always pass `--dry-run` via direct invocation
(`npx tsx scripts/agent-daemon.ts --once --dry-run`).

### Interval tuning and rate limits

Polling uses the Issues API (`gh issue list --label`), not the Search API
(Search is capped at 30 req/min). Two `issue list` calls per 60s poll ≈
120 req/hr, ~2% of the authenticated REST core quota (5000 req/hr, verified
via `gh api rate_limit`). Lower `--interval` for latency, raise it to cut
quota further.

### Follow-up: push triggers

Polling is v1 (simple, no infra). If 60s latency becomes a problem, the
deferred options are:

1. **Repo webhooks** (`issues: labeled`, `issue_comment`): instant, but needs
   a public endpoint (tunnel/smee.io) for local dev.
2. **GitHub Actions** (`on: issues: types: [labeled]`) with a self-hosted
   runner invoking opencode: best for cloud, no local daemon.
