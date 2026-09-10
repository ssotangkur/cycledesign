---
name: diagnose-stuck-run
description: Diagnose a stuck daemon CLI run for a GitHub issue and produce a postable Watchdog investigation verdict (busy, rate-limited, wedged)
---

# Diagnose Stuck Run Skill

Given a GitHub issue number `<N>` (repo defaults to `ssotangkur/cycledesign`),
produce a stuck-run diagnosis postable as #107's `## Watchdog investigation`
comment. This codifies the thrice-manual checklist from #85 (rate-limit stall),
#104 (foreground-server wedge), and #109 (busy-vs-stuck check).

## Rules

- **Read-only by default.** Do not kill any process unless unblocking was
  explicitly approved. See §8 for the mandatory pre-kill gate.
- **Pin the model.** Every `opencode` invocation inside this skill pins
  `--model opencode-go/muse-spark-1.3-contributor`, so diagnosis cannot wedge
  on the same quota exhaustion it is diagnosing (#107 §3).
- **Windows-first.** All process commands are PowerShell-first
  (`Get-CimInstance Win32_Process`). POSIX alternatives are footnotes only.
- **Optional fallback args:** `run=<hex>` or `sessionID=<id>` when the
  issue→run join (§1) is ambiguous (e.g. multiple runs for the same issue
  after respawns). Never guess — report candidates instead.

## §1 Map issue → CLI process

Deterministic resolution order:

1. `Get-CimInstance` cmdline match — find the daemon CLI for this issue:
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='opencode.exe' OR Name='node.exe'" |
     Where-Object { $_.CommandLine -match 'opencode run --command resolve-issue <N>' } |
     Select-Object ProcessId, ParentProcessId, CreationDate, CommandLine,
       @{n='CpuSeconds';e={[double]($_.KernelModeTime + $_.UserModeTime) / 1e7}}
   ```
   Record PID + `CreationDate` (100-ns ticks → seconds: divide
   `KernelModeTime`+`UserModeTime` by 10,000,000). Zero CPU over hours is the
   tell — but never judge from a single snapshot, see §7 CPU-rate rule.
2. `opencode session list` filtered by checkout-cwd + start-window to
   candidate sessionIDs.
3. Correlate `run=<hex>` lines in
   `$env:USERPROFILE\.local\share\opencode\log\opencode.log` within that
   window (note: `$env:LOCALAPPDATA\opencode\log\opencode.log` does NOT exist).
4. Ambiguous (multiple runs, same `<N>` after respawn) → report candidates,
   do NOT guess. Accept explicit `run=`/`sessionID` fallback arg instead.

## §2 Run activity (tail only — never dump the ~7 MB log)

Tail the session log / `opencode.log` for the run from
`$env:USERPROFILE\.local\share\opencode\log\opencode.log`:

```powershell
Get-Content $env:USERPROFILE\.local\share\opencode\log\opencode.log -Tail 500 |
  Select-String 'run=<hex>|stream|loop|tool|session\.error|Rate limit exceeded|Upstream request failed'
```

Record: last `stream`/`loop`/`tool` timestamp, and error classification counts
over the last 15 min (see §7 classifier). Classify from BOTH sources when
available: piped `--format json` `session.error` (structured), else
`Select-String` on the tailed log as fallback.

## §3 Child process tree

Walk `ParentProcessId` down from the §1 CLI PID — what subprocesses exist,
their CPU/age. Distinguishes the three shapes:

```powershell
$cliPid = <PID-from-§1>
Get-CimInstance Win32_Process | Where-Object {
  $_.ParentProcessId -eq $cliPid -or $_.ProcessId -eq $cliPid
} | Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate,
    @{n='CpuSeconds';e={[double]($_.KernelModeTime + $_.UserModeTime) / 1e7}}
# Repeat for each child PID to walk the full wrapper chain
# (daemon spawns via shell:true per scripts/agent-daemon.ts:103-108, so expect
# a shell/shim level; #104 additionally showed concurrently/npm levels —
# walk whatever levels actually exist).
```

- High child CPU + recent output = "long test running".
- Child holding a foreground server (`npm run dev`, `dev:e2e`) = wedge
  candidate (cf. #104; but see #110 note in §7 — that cause is now
  preventable at skill level via the wrap-up "Long-lived servers" section).
- Idle tree, nothing live = wedge/rate-limit candidate.
- Runner-that-should-exit still alive (`vitest run` — not watch, not a
  server) = open-handle wedge (third variant seen on #109).

## §4 Port ownership

Which PIDs hold this checkout's mode-scoped dev/E2E ports, since when
(`node scripts/check-ports.cjs` names owners but has no start time — join
with `CreationDate` per owner PID):

```powershell
node scripts/ports.cjs        # this checkout's dev ports
node scripts/ports.cjs --e2e  # E2E ports (Playwright-owned, +50 offset)
node scripts/check-ports.cjs
node scripts/check-ports.cjs --e2e
# For each owner PID from check-ports.cjs output:
Get-CimInstance Win32_Process -Filter "ProcessId=<ownerPid>" |
  Select-Object ProcessId, Name, CreationDate, CommandLine
```

Windows mechanism underneath: `netstat -ano -p TCP | findstr` +
`tasklist /FI PID` (scripts/check-ports.cjs:37-43). Cross-checkout guard:
owner PIDs may belong to sibling checkouts (offsets per
scripts/ports.cjs:91; owner string is PID+image only) — never attribute a
foreign checkout's ports to this run.

## §5 Branch / commit recency

Tip commit age on `issue/<N>/*` — commits landing means progress despite
log silence:

```powershell
git branch -a | Select-String 'issue/<N>/'
git log --oneline -5 issue/<N>/*
git log -1 --format='%h %ad %s' --date=relative issue/<N>/*
```

Rule: branch recency overrides log silence ONLY when combined with live
child CPU — never on commits alone during the free-tier all-day flap
(#107: reset is "not learnable from logs").

## §6 Labels

Current label state on the issue:

```powershell
gh issue view <N> --repo ssotangkur/cycledesign --json labels --jq '.labels[].name'
```

Note whether `implementing` is stuck (watchdog resets
`implementing`→`ready to implement` on kill, since the daemon never
re-polls `implementing`).

## §7 Verdict (classifier + precedence + output contract)

### Error classifier (verbatim from #107)

- `/Upstream request failed: \[([a-z_]+)\]/` present → upstream
  (transient if `rate_limit_exceeded` — auto-retries, no action).
- Else `/Rate limit exceeded/` → gateway-quota (dangerous — retrying is
  pointless, fail over).
- Apply to BOTH sources (§2): structured `session.error` first, message-regex
  fallback second. Windowed rule: counts over the last 15 min; require N
  consecutive gateway-quota errors to flip (single last-error-wins
  misclassifies the all-day Zen flap).

### CPU tell as rate (never a single snapshot)

"Zero CPU over hours" means: `(KernelModeTime + UserModeTime)` delta over
wall-age ratio ≈ 0. Cumulative counters can't detect idle from one sample —
take two samples N min apart (or delta vs the 15-min watchdog window),
convert 100-ns ticks to seconds (÷ 1e7), and compare CPU-seconds gained vs
wall-seconds elapsed. Explicit threshold: < 1 CPU-second per 15-min window
with an idle child tree = idle.

### Precedence table

| Signals | Verdict |
|---|---|
| High child CPU + recent commits/output | `busy` (long test running — leave alone) |
| Gateway-quota burst (windowed) + idle tree | `rate-limited` (tier per classifier) |
| Silent + idle tree + stale branch | `wedged` (cause + holder) |
| `vitest run` (should-exit runner) alive, silent, no server | `wedged` open-handle variant (#109 third hang) |
| Foreground server held under CLI | `wedged` foreground-server variant (#104 shape; note #110: now preventable — wrap-up forbids foreground boots, so a fresh occurrence means the run bypassed the skill) |

### #149 daemon predicate (conjunctive VM-side liveness, no CPU)

Root stdout buffers nested-`Task` output until `Task`-end inside ONE
`tool_use` envelope (proven by live Go-model probe: 7 lines, one root
sessionID, zero mid-`Task` lines — see `scripts/agent-daemon-nested-task.fixture.jsonl`),
so stdout silence during a `Task` phase is normal, NOT evidence of stuckness.
`opencode.log` (`created parentID` edges + `mode=subagent` streams) is the
authoritative interleaved sub-agent source.

In `sandboxMode` the daemon fires only when ALL legs are idle for the full
window — no non-error stdout lines AND VM log-tail stalled
(`/home/agent/.local/share/opencode/log/opencode.log` via `sbx exec`,
`sessionID` ↔ `session.id`/`created id=` join; Spike 0: `tmp/spike-149-report.md`)
AND no VM branch/commit activity AND sandbox session-log tail stalled AND the
worker-tree busy-vote cold. Host file/VCS is ignored in `sandboxMode`.
CPU-rate is excluded from the daemon predicate entirely (sampling is not a
reliable activity proxy — false positives both ways); the skill's §7 CPU-rate
rule above is unchanged and still applies to MANUAL diagnosis. Byte chunks
stay diagnostic-only (#104 had 0B pending).

Any collector error suppresses the fire (fail-closed, Q9a) with per-signal
suppression reasons logged at heartbeat cadence, so fail-closed silence stays
visible. The tree is a busy-vote only: a hot tree (recent spawn/churn)
suppresses, otherwise it is neutral — a live-but-idle tree still fires (#109).

### Output contract — literal template

Post exactly this (fixed headings so #107 can consume it):

```markdown
## Watchdog investigation

**Process:** `opencode run --command resolve-issue <N>` PID <pid>, age <age>, CPU <cpu-s over window> (rate: <x> s/min)
**Events:** last stream/loop/tool at <ts>; last-15-min errors: gateway-quota <a>, upstream-transient <b>, tool <c>
**Child tree:** <PIDs + image + cmdline + CPU/age, or "idle — nothing live">
**Ports:** dev <ports> — <free|owner PID + since>; E2E <ports> — <free|owner PID + since>
**Branch/commits:** `issue/<N>/*` tip <sha> (<age>): <subject>
**Labels:** <current labels>
**Verdict:** `busy` | `rate-limited (<tier>)` | `wedged (<cause>, held by <holder>)`
**Notes:** label reset `implementing`→`ready to implement` on kill; no model change on respawn (respawn follows current failover/probe state per #107); foreground-server wedges are preventable per #110.
```

## §8 Intervention order (only when unblocking is approved)

Pre-kill gate (mandatory): `CommandLine` must contain this checkout's path
(or matching `--dir`), ports must be this checkout's mode-scoped set from
`node scripts/ports.cjs` (+ `--e2e` for E2E scope), explicit approval
recorded. Sibling-checkout PIDs/ports must never be killed (cross-checkout
kill guard).

Kill closest-to-the-call first — evidence: on #109, killing the hung
`vitest run` child released the bash call and the run self-resumed; on #104,
killing the leaf servers did NOT release it because the pipe was held
further up the wrapper chain (`concurrently`/npm, `shell:true` per
scripts/agent-daemon.ts:103-108 — note orphan risk), and only killing the
CLI worked. So: hung test/child process → wrapper chain
(`concurrently`/npm) → CLI last.

Daemon kill order (#149 KD-5, strict + fail-closed): the daemon tree-kills
(with post-kill verification + retry — `treeKillVerified` in
scripts/agent-tree-kill.ts) → verifies tree death → `destroySandbox` (now
returning `{ok, output}`) BEFORE fence-check/label-reset, leaf→wrapper→CLI.
The daemon's atomic mechanism is `taskkill /PID /T /F` (win32) or process-group
`SIGKILL` (posix) — the child-first walk above is the MANUAL equivalent for
diagnosis sessions; both serve the same leaf-first intent. A failed destroy
suppresses the lease release and parks at `question` (never reset to ready —
a blind reset would re-queue a duplicate run behind the orphan), with a
manual-reset hint in the log. Sandbox kills always destroy (killing the host
`sbx.exe` client alone orphans the in-VM worker).

## Appendix — synthetic fixtures (deterministic)

### Fixture A — busy (expected: `busy`)

- `Get-CimInstance`: CLI PID 1234 age 40 min, CPU +95 s over last 15 min;
  child `vitest run` PID 5678 age 12 min, CPU +80 s.
- Log tail: `tool` lines every ~30 s, 0 gateway-quota, 1 upstream-transient.
- Ports: dev busy (owner PID 5678 since 12 min ago).
- Branch: tip 3 min ago ("test: add session label cases").
- Verdict: `busy` — long test running, leave alone.

### Fixture B — rate-limited (expected: `rate-limited (gateway-quota)`)

- `Get-CimInstance`: CLI PID 2345 age 3.5 h, CPU +1.6 s total (~0 gained over
  last 15 min); no live children.
- Log tail: ~20 consecutive `Rate limit exceeded` (no `Upstream` marker),
  last stream 3 h ago (#85 shape).
- Ports: all free.
- Branch: tip 3 h ago, stale.
- Verdict: `rate-limited (gateway-quota)` — fail over, retrying is pointless.

### Fixture C — wedged open-handle (expected: `wedged (open-handle, held by vitest run)`)

- `Get-CimInstance`: CLI PID 3456 age 2 h, CPU ~0 over last 15 min; child
  `vitest run` PID 7890 age 1.8 h, CPU ~0 — runner that should exit still
  alive (#109 third variant).
- Log tail: no stream/loop/tool for 1.8 h; 0 gateway-quota, 0 upstream.
- Ports: all free.
- Branch: tip 2 h ago, stale.
- Verdict: `wedged (open-handle, held by vitest run PID 7890)` — kill child
  first per §8 (cf. #109 self-resume), wrapper chain next, CLI last.

## §9 Self-improvement (file an issue, never self-modify)

After posting the verdict, consider whether this skill itself needs
improvement: stale information (moved paths, changed scripts/line refs,
outdated shapes), steps that were too verbose, or steps that were too
prescriptive (commands that didn't help or over-constrained the diagnosis).

- If an improvement exists, file it as a GitHub issue with the specific
  change to make (section, what's wrong, suggested fix). Compose the body
  with the `Write` tool to `tmp/diagnose-<N>.md` with real newlines first
  (never inline `--body "..."` — backtick is PowerShell's escape character
  and `\n` stays literal), then:
  ```powershell
  gh issue create --repo ssotangkur/cycledesign `
    --title "diagnose-stuck-run: <short description>" `
    --body-file tmp/diagnose-<N>.md
  ```
- File one issue per improvement. Keep the verdict post clean — do not mix
  skill feedback into `## Watchdog investigation`.
- Never edit `SKILL.md` in-session. Diagnosis runs read-only; skill changes
  land via a separate issue/PR.
