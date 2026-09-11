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
| `agent-daemon.ts` | Polling-first runner: watches board `Status` first, `ready to plan` / `ready to implement` labels as fallback, and invokes fire-and-forget skills via the opencode CLI |
| `agent-daemon-board.ts` | Board-first claimable lookup: Status→label/command map, `item-list` reader, label-union merge, add-only reconcile decision |
| `agent-daemon-lease.ts` | Daemon-owned issue lease: claim/release label swaps, mirrors Status via `agent-project.ts` |
| `agent-project.ts` | Best-effort mirror of label moves onto the Project `Status` field (`npx tsx scripts/agent-project.ts --issue <N> --status "<Status>"`) |
| `agent-supervisor.ts` | Tiny supervisor: restarts the daemon on crash, pulls ff-only on exit 42 |
| `sandbox-start.bat` | Windows CMD launcher (wraps PowerShell) |
| `sandbox-start.ps1` | Windows PowerShell launcher (recommended) |
| `sandbox-start.sh` | Linux/macOS launcher |
| `../.qwen/sandbox.Dockerfile.gui` | Custom sandbox Dockerfile |
| `../.qwen/settings.json` | Qwen Code settings (MCP config) |
| `../.qwen/SANDBOX.md` | Full sandbox documentation |

## Agent Daemon

Polling-first runner (`agent-daemon.ts`, TypeScript via `npx tsx`) that watches
issue labels and invokes the fire-and-forget skills via the opencode CLI,
resuming after each run. Ref: issue #98. `npm run agent-daemon` runs it under
a tiny supervisor (`agent-supervisor.ts`) that restarts the daemon on crash
and pulls updates when the daemon reports them. Ref: issue #114.

Label → skill mapping (Status is the source of truth for claimable work,
ref: issue #146 — `agent-daemon-board.ts`):

| Project Status | Label | Command |
|-------|---------|---------|
| `Ready to plan` | `ready to plan` | `opencode run --command "gh-plan-with-reason" "<N>"` |
| `Ready to implement` | `ready to implement` | `opencode run --command "resolve-issue" "<N>"` |

Each pass reads claimable Status via `gh project item-list` (explicit
`--limit 100`, first page only — same inherited limitation as the
label→Status mirror) and unions it with the `ready to plan` /
`ready to implement` label poll. Labels stay as fallback: issues off the
board are still claimed via labels (never Status-exclusive). On conflict the
downstream-most command wins (`Ready to plan` Status + `ready to implement`
label → implement). Board-only hits are hydrated via `gh issue view` and
claimed only when still `OPEN`. A board-claimable issue missing its trigger
label gets the label added back (plus its Status mirror) before claiming —
fence-gated, add-only reconcile: `question` / `pr ready` suppress the add,
a fence transport failure skips the issue this pass, nothing is ever removed
here, and `--dry-run` only logs `would-reconcile`. A board outage logs at
error level and the pass continues label-only.

`question` / `pr ready` are terminal and never re-triggered (not polled).
Runs are sequential, oldest-first, one CLI at a time. An issue carrying both
labels is processed once as `ready to implement` (downstream-most state wins).

### Usage

```bash
npx tsx scripts/agent-daemon.ts --once --dry-run   # single pass, no spawning
npm run agent-daemon:once                          # single supervised pass for real
npm run agent-daemon                               # supervised loop forever (60s default)
npx tsx scripts/agent-daemon.ts --once             # raw daemon, one pass, no supervisor
```

### Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--repo OWNER/REPO` | `ssotangkur/cycledesign` | Repository to poll (must match `OWNER/REPO`) |
| `--interval SECONDS` | `60` | Poll interval, positive integer |
| `--once` | — | Single poll pass, then exit |
| `--dry-run` | — | Print planned invocations without spawning opencode |
| `--update-check-interval SECONDS` | `300` | Update-check interval, `0` disables |
| `--no-update-check` | — | Disable update check (same as `--update-check-interval 0`) |
| `--help` | — | Show usage and exit |

Warning: `npm run` swallows its own `--dry-run` flag instead of forwarding
it — `npm run agent-daemon:once -- --dry-run` silently runs a REAL pass and
spawns opencode (verified: it claimed issue #85 for real). Always pass
`--dry-run` via direct invocation
(`npx tsx scripts/agent-daemon.ts --once --dry-run`). The same applies to any
other flag: use the `--` separator with `npm run`
(`npm run agent-daemon -- --update-check-interval 0`), or invoke
`npx tsx` directly. E2E invokes via direct `npx tsx`, never bare `npm run`
with flags.

### Ctrl+C / SIGTERM contract

On SIGINT/SIGTERM the supervisor forwards the signal to the daemon child,
waits ~12s for the daemon's synchronous teardown, tree-kills only on
timeout, and exits `0` (never restarts). A second signal force-tree-kills
and exits non-zero. The daemon's signal teardown owns the active run and
probe: it tree-kills the child(ren), synchronously releases the issue
lease (fail-closed with a manual-reset note when the fence is
unreachable), destroys the current run/probe sandbox (killing the host
`sbx.exe` client alone would orphan the in-VM worker), then exits `0`.
Idle signals skip straight to exit `0`. Every first-signal path exits
`0` — including mid-run and under `--once` (deliberately not `130`, which
would re-enter the supervisor's crash-restart logic).

Verify on a Windows console via BOTH `npm run agent-daemon` and direct
`npx tsx scripts/agent-supervisor.ts` (idle Ctrl+C and, when sandbox
mode is available, mid-run Ctrl+C). The launch chain is unchanged: if
`npm run` demonstrably swallows SIGINT on your setup, invoke
`npx tsx scripts/agent-supervisor.ts` directly as the fallback.

### Daemon log (`tmp/daemon.log`)

`npm run agent-daemon` tees supervisor output to both the console and
`tmp/daemon.log` via `node scripts/spawn-log.js --truncate tmp/daemon.log ...`
(same pattern as `dev:server:log` / `dev:web:log`). The file is truncated on
each wrapper start (one `Starting:` policy line per manual start); within a
single run it still grows unbounded (full `--format json` streams), so
truncate it manually when needed (`: > tmp/daemon.log` on posix,
`Clear-Content tmp/daemon.log` on PowerShell). `tmp/` is gitignored and
per-checkout, and the signal/exit-code contract above is unchanged through
the wrapper (first signal forwards and exits `0`, never `130`).
`agent-daemon:once` / `agent-daemon:raw` stay console-only.

### Supervisor vs daemon (self-update)

The supervisor is dumb and stable (~100 lines, changes almost never): it
spawns the daemon as a child (`npx tsx scripts/agent-daemon.ts` with all
flags passed through verbatim), inherits stdio, and restarts it on exit.
The daemon is smart: every `--update-check-interval` seconds (default 5 min,
checked between passes and between individual runs — never mid-run) it
`git fetch origin main` and compares `HEAD` to `origin/main`. When behind,
it finishes the current run, aborts the remaining queue (unclaimed items
keep their labels and are picked up post-restart), logs
`update available (<local> -> <remote>)`, and exits `42`. The supervisor
then pulls and restarts. The supervisor never needs to self-update itself.

The update check is active only when `HEAD` is on `main` tracking
`origin/main`; on any other branch, detached `HEAD`, or missing upstream it
logs `update-check: skipped (<reason>)` and keeps polling. A failed
`git fetch` (or its 60s hang-guard timeout) also skips the pass — the daemon
never exits `42` on failed evidence. `--dry-run` prints
`update-check: behind|current|skipped(<reason>)` without exiting.

### Exit-code contract

| Exit code | Meaning | Supervisor action |
|---|---|---|
| `0` | Intentional stop (`--once` done, any first SIGINT/SIGTERM: idle, mid-run, or `--once` — always `0`, never `130`) | Do NOT restart |
| `42` | Update available | `git pull --ff-only` if clean, then restart |
| `2` | Usage / arg-parse error | NEVER restart — exit immediately so a bad flag can't hot-loop |
| anything else | Crash / transient (`gh` auth, OOM) | Plain restart with backoff (1s/2s/4s… cap 30s), no pull; >5 crashes in 5 min bails non-zero |

`--once` mode runs the child exactly once and exits with the child code —
no restart loop and no pull (a one-shot scripted invocation must not mutate
the checkout; `42` under `--once` propagates `42` to the caller with the
SHAs logged, without the daemon doing a poll pass first when already behind).

### Dirty-tree rule

The daemon's own `opencode run` children dirty the checkout (branches,
uncommitted work), so the supervisor checks `git status --porcelain` before
pulling: if non-empty it **skips the pull, warns, and restarts the same
code**, retrying the pull on the next update exit (with a 60s cooldown so a
diverged tree can't `42`-loop). Pulls are always `git pull --ff-only` —
never merge, rebase, or stash (auto-resolving dirty trees is out of scope).

### Interval tuning and rate limits

Polling uses the Issues API (`gh issue list --label`) plus one Project board
read (`gh project item-list --limit 100`) per 60s poll, not the Search API
(Search is capped at 30 req/min). Two `issue list` calls plus one `item-list`
call per poll plus one `issue view` per board-only candidate ≈ well under 1%
of the authenticated REST core quota (5000 req/hr, verified
via `gh api rate_limit`; GraphQL board/item writes count separately but stay
in the single digits per claimed issue). Lower `--interval` for latency,
raise it to cut quota further.

### Follow-up: push triggers

Polling is v1 (simple, no infra). If 60s latency becomes a problem, the
deferred options are:

1. **Repo webhooks** (`issues: labeled`, `issue_comment`): instant, but needs
   a public endpoint (tunnel/smee.io) for local dev.
2. **GitHub Actions** (`on: issues: types: [labeled]`) with a self-hosted
   runner invoking opencode: best for cloud, no local daemon.
