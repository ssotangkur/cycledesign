# CycleDesign Docker Sandbox Workers (#121)

## Overview

Daemon workers (`scripts/agent-daemon.ts`, `SANDBOX_MODE=1`) run inside
disposable **Docker Sandbox microVMs** (own kernel via Windows Hypervisor
Platform) instead of host-direct `opencode` processes, so they survive
host-level process killers (proven: Helldivers 2 GameGuard kills host
`bun.exe` but cannot reach VM-isolated processes). The daemon stays on the
host; only the spawn target changes.

**Key points:**
- One sandbox per run (`cycledesign-issue-<N>`), destroyed on every finish
  path (exit, failover kill, watchdog kill). Killing the host `sbx.exe`
  client alone **orphans** the in-VM worker — the sandbox itself is the kill.
- Idle VMs stop ~30–60s after the last client disconnects, so there are no
  long-lived worker sandboxes. Cold starts are fast; provision adds ~30s/run.
- `sbx exec` is attached foreground (no `-t`): stdout/stderr stay separate,
  exit codes propagate, `--format json` streams line-by-line.

---

## Quick Start

### 1. Install and log in (one time)

```powershell
winget install Docker.sbx
# Re-login so %LOCALAPPDATA%\DockerSandboxes\bin lands on PATH
sbx login        # Docker device flow
sbx policy init balanced
```

The daemon resolves `sbx` via `SBX_BIN`, else
`%LOCALAPPDATA%\DockerSandboxes\bin\sbx.exe` on Windows, else PATH.

### 2. Enable sandbox mode

In `.agent-daemon.env` (see `.agent-daemon.env.example`):

```
SANDBOX_MODE=1
# SBX_BIN=sbx   # only if the default resolution fails
```

Off by default (`SANDBOX_MODE=0` = host-direct spawn, unchanged behavior).

### 3. Run

```
npm run agent-daemon:once -- --dry-run   # prints the sbx spawn, no sandbox created
npm run agent-daemon                     # supervised loop (supervisor unchanged)
```

---

## Environment Definition

Universal worker image **`cycledesign-worker`**, built from
`sbx/sandbox.Dockerfile` (IaC, pinned base digest): stock opencode agent
template + GUI stack (Xvfb, openbox, x11vnc on 5900, noVNC on 6080) +
Chromium via Playwright (CDP on 9222) + `chrome-devtools-mcp`. GUI services
autostart backgrounded on every boot, so all workers are wrap-up capable
with no per-run template decision. Daemon selects it via `SBX_TEMPLATE`
(default `cycledesign-worker`).

Build + load (after Dockerfile changes):

```powershell
docker build -f sbx/sandbox.Dockerfile -t cycledesign-worker .
docker save cycledesign-worker -o $env:TEMP\opencode\cycledesign-worker.tar
sbx template load $env:TEMP\opencode\cycledesign-worker.tar
sbx template ls   # expect cycledesign-worker / latest / opencode flavor
```

Verified in-VM: noVNC 200, VNC RFB handshake, Chrome CDP
(`Chrome/153`, protocol 1.3), `chrome-devtools-mcp` 1.9.0.

---

## Required Env / Proxy Creds

Model auth (v1): the daemon copies the host TUI auth file
(`~/.local/share/opencode/auth.json`, provider id `opencode` = Zen key,
`opencode-go` = Go subscription) into the VM before each run. Models are
already pinned in `.agent-daemon.env`:
free `opencode/muse-spark-1.3-contributor-free` first, Go
`opencode-go/muse-spark-1.3-contributor` after gateway-quota failover.

Egress allowlist (applied per sandbox, see `SANDBOX_NETWORK_HOSTS` in
`scripts/agent-sandbox.ts`): `opencode.ai`, `models.opencode.ai`,
`*.opencode.ai`,
`github.com`, `api.github.com`, `raw.githubusercontent.com`,
`registry.npmjs.org`.

`GH_TOKEN` for `gh`/git inside the VM (#129): the daemon resolves the host
token (`GH_TOKEN` env, else `gh auth token`) and stores it per sandbox via
`sbx secret set github --sandbox <name>` during provision. The proxy
authenticates `gh` and git HTTPS; the token never enters the VM env. Do NOT
pass an empty `GH_TOKEN` with `sbx exec -e` — the runtime injects an empty
one itself and it poisons `gh` ("The token in GH_TOKEN is invalid").

Repo in the VM (#129): the daemon clones `https://github.com/<owner>/<repo>.git`
to `/home/agent/repo` during provision and runs the worker with
`sbx exec -w /home/agent/repo`, because the workdir mount's `.git` is a
linked-worktree pointer to a host path and unusable in-VM.

**Proxy-migration follow-up:** `sbx secret set-custom -g --host
models.opencode.ai --env OPENCODE_API_KEY` (Zen API domain confirmed via
`sbx policy log`; env-var pickup untested) so secrets never enter the VM.
OAuth-in-sandbox is broken for opencode upstream — API keys only.

---

## Run ↔ Sandbox Mapping + Port Scheme

| Run | Sandbox | Workdir mount |
|-----|---------|---------------|
| Issue `#N` worker | `cycledesign-issue-N` | daemon cwd |
| Free-tier probe | `cycledesign-probe` | daemon cwd |

No slot pool yet — the daemon mounts its own cwd directly (worktree
acquire/release = sandbox create/destroy around the run).

**Ports:** never pin host ports at create time (create-time `-p` showed an
accept-then-reset anomaly). For wrap-up HTTP verification use `sbx ports
<name> --publish <vm-port>` (ephemeral host port, verified host→VM 200).

---

## `sbx` Invocation Shape (what the daemon runs)

```
sbx create --name cycledesign-issue-N opencode <daemon-cwd>
sbx cp <host-auth.json> cycledesign-issue-N:/home/agent/.local/share/opencode/auth.json
sbx policy allow network --sandbox cycledesign-issue-N <allowlist>
sbx exec cycledesign-issue-N -e OPENCODE_CONFIG_CONTENT=<headless-deny> opencode run --command <skill> <N> --model <m> --format json
sbx stop cycledesign-issue-N        # best-effort
sbx rm --force cycledesign-issue-N  # the actual kill
```

Pure builders + thin executors live in `scripts/agent-sandbox.ts`
(unit-tested via `npm run test:daemon`).

---

## Troubleshooting Probes

```powershell
$SBX = "$env:LOCALAPPDATA\DockerSandboxes\bin\sbx.exe"
& $SBX ls                                   # sandbox states
& $SBX policy log <name>                    # allowed/blocked hosts per sandbox (allowlist discovery)
& $SBX exec <name> sh -c 'echo hi; exit 3'; $LASTEXITCODE   # stdio + exit-code path
& $SBX ports <name> --publish 8099          # publish a VM port, probe the printed host port
```

- `Blocked by network policy: domain X` → `sbx policy allow network --sandbox <name> X`
  (check `policy log` for the exact host, e.g. Zen = `models.opencode.ai`).
- `API key not valid` → wrong/absent provider auth in the VM; re-check the
  auth copy step and `--model`.
- `No payment method .../billing` → Zen workspace account state (fails on
  host too), not sandbox delivery. Use free/Go models.
- `stdin is not a terminal` → pass `--force` (non-interactive `rm`).
- `sbx` not found in a fresh shell → re-login (PATH) or use the full
  `%LOCALAPPDATA%` path / `SBX_BIN`.

---

## Security Notes

- Threat model is host process killers, not exfiltration — v1 auth copy
  puts real keys in the VM fs. Proxy migration removes that.
- Token scope: `repo` for `GH_TOKEN`; rotate regularly.
- Don't browse sensitive sites during wrap-up verification; keep published
  ports on loopback (the default).
