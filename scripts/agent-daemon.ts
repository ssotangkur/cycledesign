#!/usr/bin/env node
/**
 * Polling-first daemon that watches issue labels and invokes the right
 * fire-and-forget skill via the opencode CLI, resuming after each run.
 *
 * Free-tier-first with failover to Go on gateway-quota and probe-based
 * failback (#107):
 * - Config: root `.agent-daemon.env` (git-ignored, see
 *   `.agent-daemon.env.example`) holds FREE_MODEL / GO_MODEL /
 *   STUCK_TIMEOUT_S / PROBE_INTERVAL_S / PROBE_TIMEOUT_S. Missing file →
 *   exit 2 with setup instructions (supervisor does not restart).
 * - Model ownership: every `opencode run` spawn gets an explicit `--model`
 *   (free by default, Go after failover). The absent static `"model"` pin in
 *   `opencode.jsonc` stays absent (verify-and-keep-absent); this file never
 *   edits `opencode.jsonc`.
 * - Failover (KD-4): a gateway-quota line triggers immediate tree-kill, a
 *   fenced label reset (`implementing` → `ready to implement` only when no
 *   terminal state landed since spawn), then respawn on Go. Max 3 failovers
 *   per issue per daemon lifetime; exhaustion parks the issue at `question`.
 * - Headless (KD-5): every spawn sets inline `OPENCODE_CONFIG_CONTENT` with
 *   `{"permission":{"external_directory":"deny","question":"deny"}}`. Never
 *   pass `--auto`; never write `opencode.jsonc`. Denials that block progress
 *   become `question` comments per the skill; `asking`-with-no-answer counts
 *   as stuck for the watchdog.
 * - Watchdog (KD-6): every STUCK_TIMEOUT_S with zero non-error `--format
 *   json` lines, build a read-only bundle (process tree, event summary, port
 *   ownership, branch state), post `## Watchdog investigation`, apply the
 *   fencing check, reset labels, then tree-kill. Never changes model state;
 *   diagnosis opencode invocations use GO_MODEL. Daemon comments are exempt
 *   from the skill's no-progress-comments rule (that rule binds the skill's
 *   sub-agents, not the daemon).
 * - Failback probe (KD-7): while on Go, at run boundaries only, spawn
 *   `opencode run --model <FREE_MODEL> "return the single word OK"` every
 *   PROBE_INTERVAL_S. First success flips subsequent runs to free and stops
 *   the timer until the next failover. Never switch mid-run (except the
 *   failover kill). An in-flight run's watchdog always wins over the probe.
 * - Observability (KD-8): spawns pipe `--format json`; each raw line is
 *   printed prefixed `[orchestrator]` (root session) or `[sub:<title|id>]`
 *   (children via the `session.created` → `parentID` map when present).
 *   Unknown event types pass through untagged. Only `type`, `sessionID`,
 *   `part.sessionID` are ever parsed structurally. `--dry-run` prints the
 *   full planned command including `--model`.
 * - Sandbox mode (#121): SANDBOX_MODE=1 runs each worker in a disposable
 *   Docker Sandbox microVM via attached `sbx exec` (survives host process
 *   killers like GameGuard). Auth = host auth.json copy, egress =
 *   per-sandbox allowlist. Killing the host client alone orphans the
 *   in-VM worker, so every finish path destroys the sandbox. Off by
 *   default; the watchdog tree section then shows the host sbx proxy.
 *
 * Label -> skill mapping (bare command names, no leading slash):
 *   "ready to plan"      -> gh-plan-with-reason
 *   "ready to implement" -> resolve-issue
 *
 * "question" / "pr ready" are terminal and never re-triggered (not polled).
 * Skills claim via label swap, so the next poll naturally skips claimed issues.
 *
 * Usage:
 *   npx tsx scripts/agent-daemon.ts [--repo OWNER/REPO] [--interval SECONDS] [--once] [--dry-run] [--update-check-interval SECONDS] [--no-update-check] [--help]
 */
import { execSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { loadDaemonConfig, type DaemonConfig } from './agent-daemon-config.js';
import { classifyLine } from './agent-daemon-classify.js';
import {
  applyProbeResult,
  createProbeTracker,
  noteFailover,
  recordFailover,
  shouldFireWatchdog,
  shouldProbe,
  type ProbeTracker,
} from './agent-daemon-policy.js';
import {
  SANDBOX_REPO_DIR,
  destroySandbox,
  execArgs,
  hostAuthJsonPath,
  provisionSandbox,
  resolveGithubToken,
  sandboxNameFor,
  sandboxStatus,
} from './agent-sandbox.js';

const DEFAULT_REPO = 'ssotangkur/cycledesign';
const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_UPDATE_CHECK_INTERVAL_SECONDS = 300;
const UPDATE_FETCH_TIMEOUT_MS = 60_000;
export const EXIT_UPDATE = 42;
const ISSUE_LIMIT = 100;

const LABEL_PLAN = 'ready to plan';
const LABEL_IMPLEMENT = 'ready to implement';
const LABEL_IMPLEMENTING = 'implementing';
const LABEL_QUESTION = 'question';
const LABEL_PR_READY = 'pr ready';

const COMMANDS: Record<string, string> = {
  [LABEL_PLAN]: 'gh-plan-with-reason',
  [LABEL_IMPLEMENT]: 'resolve-issue',
};

/**
 * KD-5: headless-safe spawns. Verified mechanism: inline
 * `OPENCODE_CONFIG_CONTENT` runtime overrides (see opencode docs / config).
 * Deny-by-default, never `--auto` (explicit `deny` wins over `--auto`, so
 * deny-without-auto is the safe posture). Never edit `opencode.jsonc`.
 */
export const HEADLESS_CONFIG_CONTENT = '{"permission":{"external_directory":"deny","question":"deny"}}';

/** KD-7: minimal-cost free-tier probe prompt (Q2: trivial prompt). */
export const PROBE_PROMPT = 'return the single word OK';

/** KD-6: how often the watchdog re-checks silence while a run is in flight. */
const WATCHDOG_POLL_MS = 30_000;

interface ListedIssue {
  number: number;
  title: string;
  createdAt: string;
}

interface PlannedRun {
  issue: ListedIssue;
  label: string;
  command: string;
}

interface DaemonState {
  config: DaemonConfig;
  probe: ProbeTracker;
  failoverCounts: Map<number, number>;
}

/** KD-6/KD-8: per-run stream tracker fed by each piped JSON line. */
interface StreamTracker {
  startMs: number;
  lastNonErrorAtMs: number;
  gatewayCount: number;
  upstreamCount: number;
  otherCount: number;
  linesSeen: number;
  firstGatewayLine: string | null;
  rootSessionId: string | null;
  parentBySession: Map<string, string>;
  titleBySession: Map<string, string>;
}

function createStreamTracker(nowMs: number): StreamTracker {
  return {
    startMs: nowMs,
    lastNonErrorAtMs: nowMs,
    gatewayCount: 0,
    upstreamCount: 0,
    otherCount: 0,
    linesSeen: 0,
    firstGatewayLine: null,
    rootSessionId: null,
    parentBySession: new Map(),
    titleBySession: new Map(),
  };
}

let activeChild: ChildProcess | null = null;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;

function usage(): string {
  return [
    'Usage: agent-daemon.ts [options]',
    '',
    'Poll GitHub issues by label and run fire-and-forget skills via the opencode CLI.',
    '',
    'Options:',
    `  --repo OWNER/REPO     Repository to poll (default: ${DEFAULT_REPO})`,
    `  --interval SECONDS    Poll interval in seconds, positive integer (default: ${DEFAULT_INTERVAL_SECONDS})`,
    '  --once                Single poll pass, then exit',
    '  --dry-run             Print planned invocations without spawning opencode',
    `  --update-check-interval SECONDS  Update-check interval in seconds, 0 disables (default: ${DEFAULT_UPDATE_CHECK_INTERVAL_SECONDS})`,
    '  --no-update-check     Disable origin/main behind-check (same as --update-check-interval 0)',
    '  --help                Show this help and exit',
  ].join('\n');
}

function fail(message: string): never {
  console.error(`[agent-daemon] error: ${message}`);
  console.error(usage());
  process.exit(2);
}

function listIssues(repo: string, label: string): ListedIssue[] {
  const result = spawnSync(
    'gh',
    ['issue', 'list', '--repo', repo, '--label', label, '--limit', String(ISSUE_LIMIT), '--json', 'number,title,createdAt'],
    { encoding: 'utf8' },
  );
  if (result.error) {
    throw new Error(`gh issue list (--label "${label}") failed to spawn: ${(result.error as Error).message}`);
  }
  if (result.status !== 0) {
    throw new Error(`gh issue list (--label "${label}") exited ${result.status}: ${(result.stderr || '').trim()}`);
  }
  return JSON.parse(result.stdout || '[]') as ListedIssue[];
}

/**
 * Merge both label lists client-side: sort oldest-first by issue number,
 * dedupe by number within a pass. An issue carrying both labels is processed
 * once as "ready to implement" (downstream-most state wins).
 */
function planPass(planIssues: ListedIssue[], implementIssues: ListedIssue[]): PlannedRun[] {
  const byNumber = new Map<number, PlannedRun>();
  for (const issue of planIssues) {
    byNumber.set(issue.number, { issue, label: LABEL_PLAN, command: COMMANDS[LABEL_PLAN] });
  }
  for (const issue of implementIssues) {
    byNumber.set(issue.number, { issue, label: LABEL_IMPLEMENT, command: COMMANDS[LABEL_IMPLEMENT] });
  }
  return [...byNumber.values()].sort((a, b) => a.issue.number - b.issue.number);
}

/** KD-2: every spawn gets an explicit `--model`; dry-run shows it. */
export function plannedCommand(command: string, issueNumber: number, model: string): string {
  return `opencode run --command "${command}" "${issueNumber}" --model ${model} --format json`;
}

/** #121: dry-run rendering of the sandboxed spawn (attached sbx exec). */
export function plannedSandboxCommand(sbxBin: string, sandboxName: string, command: string, issueNumber: number, model: string): string {
  return `${sbxBin} ${execArgs(sandboxName, ['opencode', 'run', '--command', command, String(issueNumber), '--model', model, '--format', 'json'], HEADLESS_CONFIG_CONTENT).join(' ')}`;
}

/**
 * KD-8: extract the session tag for a raw JSON line. Only `type`,
 * `sessionID`, and `part.sessionID` are parsed structurally; everything else
 * passes through. Maintains the `session.created` → `parentID` map when the
 * envelope carries it; degrades to short-ID tags when it does not.
 */
export function tagForLine(rawLine: string, tracker: StreamTracker): string {
  let parsed: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(rawLine);
    if (typeof value === 'object' && value !== null) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    return '';
  }
  if (parsed === null) {
    return '';
  }
  const sessionId = typeof parsed['sessionID'] === 'string' ? (parsed['sessionID'] as string) : null;
  const part = parsed['part'];
  const partSessionId =
    typeof part === 'object' && part !== null && typeof (part as Record<string, unknown>)['sessionID'] === 'string'
      ? ((part as Record<string, unknown>)['sessionID'] as string)
      : null;
  const activeSession = sessionId ?? partSessionId;
  if (activeSession === null) {
    return '';
  }
  // Record parent/title edges best-effort (field paths are not locked — see KD-3).
  const parentId = typeof parsed['parentID'] === 'string' ? (parsed['parentID'] as string) : null;
  if (parentId !== null) {
    tracker.parentBySession.set(activeSession, parentId);
  }
  const session = parsed['session'];
  if (typeof session === 'object' && session !== null) {
    const record = session as Record<string, unknown>;
    const pid = typeof record['parentID'] === 'string' ? (record['parentID'] as string) : null;
    if (pid !== null) {
      tracker.parentBySession.set(activeSession, pid);
    }
    const title = typeof record['title'] === 'string' ? (record['title'] as string) : null;
    if (title !== null && title !== '') {
      tracker.titleBySession.set(activeSession, title);
    }
  }
  if (tracker.rootSessionId === null) {
    tracker.rootSessionId = activeSession;
  }
  if (activeSession === tracker.rootSessionId) {
    return '[orchestrator]';
  }
  const title = tracker.titleBySession.get(activeSession);
  const short = activeSession.replace(/^ses_/, '').slice(-6) || activeSession;
  return `[sub:${title ?? short}]`;
}

/** Feed one piped line into tagging + classification + watchdog tracking. */
export function observeLine(rawLine: string, tracker: StreamTracker): { tag: string; cls: ReturnType<typeof classifyLine> } {
  const tag = tagForLine(rawLine, tracker);
  const cls = classifyLine(rawLine);
  tracker.linesSeen += 1;
  if (cls === 'gateway-quota') {
    tracker.gatewayCount += 1;
    if (tracker.firstGatewayLine === null) {
      // KD-3: log the full JSON line on first hit so field paths can be locked later.
      tracker.firstGatewayLine = rawLine;
    }
  } else if (cls === 'upstream-transient') {
    tracker.upstreamCount += 1;
  } else {
    tracker.otherCount += 1;
    tracker.lastNonErrorAtMs = Date.now();
  }
  return { tag, cls };
}

/**
 * KD-4: tree-kill the CLI (`shell:true` wrapper may have grandchildren).
 * win32 needs `taskkill /T /F`; posix kills the process group.
 */
export function treeKill(child: ChildProcess | null): void {
  if (child === null || child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Best-effort: the process may already be gone.
    }
  }
}

interface IssueState {
  labels: string[];
  terminalCommentSince: boolean;
}

/**
 * KD-4/KD-6 fencing check: only reset labels when the issue is still
 * `implementing` AND no terminal state landed since spawn (the skill moves to
 * `pr ready`/`question` itself, or posts a plan/question comment — racing
 * those would flap or lose blocker questions).
 */
export function checkFencing(repo: string, issueNumber: number, sinceIso: string): IssueState {
  const result = spawnSync(
    'gh',
    ['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'labels,comments'],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    // Fencing data unavailable: fail closed (do not reset).
    return { labels: [], terminalCommentSince: true };
  }
  let labels: string[] = [];
  let terminalCommentSince = false;
  try {
    const parsed = JSON.parse(result.stdout || '{}') as {
      labels?: Array<{ name?: string } | string>;
      comments?: Array<{ body?: string; createdAt?: string }>;
    };
    labels = (parsed.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? '')));
    const since = Date.parse(sinceIso || '');
    for (const comment of parsed.comments ?? []) {
      const created = Date.parse(comment.createdAt ?? '');
      if (!Number.isNaN(since) && !Number.isNaN(created) && created < since) {
        continue;
      }
      const body = comment.body ?? '';
      if (/## Plan with Reason|## Watchdog investigation|## Question|^Q\d+:/m.test(body)) {
        terminalCommentSince = true;
        break;
      }
    }
  } catch {
    return { labels: [], terminalCommentSince: true };
  }
  return { labels, terminalCommentSince };
}

export function isFenceClear(state: IssueState): boolean {
  return state.labels.includes(LABEL_IMPLEMENTING) && !state.terminalCommentSince;
}

function resetToReady(repo: string, issueNumber: number): void {
  const result = spawnSync(
    'gh',
    [
      'issue',
      'edit',
      String(issueNumber),
      '--repo',
      repo,
      '--remove-label',
      LABEL_IMPLEMENTING,
      '--add-label',
      LABEL_IMPLEMENT,
    ],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    console.error(
      `[agent-daemon] label reset failed for #${issueNumber}: ${result.error ? (result.error as Error).message : (result.stderr || '').trim()}`,
    );
  }
}

function parkAtQuestion(repo: string, issueNumber: number, body: string): void {
  const comment = spawnSync('gh', ['issue', 'comment', String(issueNumber), '--repo', repo, '--body', body], {
    encoding: 'utf8',
  });
  if (comment.error || comment.status !== 0) {
    console.error(`[agent-daemon] park comment failed for #${issueNumber}`);
  }
  const edit = spawnSync(
    'gh',
    ['issue', 'edit', String(issueNumber), '--repo', repo, '--remove-label', LABEL_IMPLEMENTING, '--add-label', LABEL_QUESTION],
    { encoding: 'utf8' },
  );
  if (edit.error || edit.status !== 0) {
    console.error(`[agent-daemon] park label move failed for #${issueNumber}`);
  }
}

/** Best-effort shell capture for the watchdog bundle (never throws). */
function capture(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).trim().slice(0, 4000);
  } catch {
    return '(unavailable)';
  }
}

function childProcessTree(pid: number | undefined): string {
  if (pid === undefined) {
    return '(no child pid)';
  }
  if (process.platform === 'win32') {
    const list = capture(`tasklist /FI "PID eq ${pid}" /FO TABLE /NH`);
    const children = capture(`wmic process where (ParentProcessId=${pid}) get ProcessId,CommandLine /FORMAT:LIST`);
    return `PID ${pid}: ${list}\nchildren:\n${children}`.slice(0, 4000);
  }
  return capture(`ps --ppid ${pid} -o pid,etime,pcpu,comm; ps -p ${pid} -o pid,etime,pcpu,comm`);
}

function portOwnership(): string {
  // Best-effort reuse of the checkout's mode-scoped port helpers (KD AD-8).
  // check-ports.cjs exits 1 when a port is busy and reports BUSY on stderr,
  // so read output regardless of exit status — busy is the interesting case.
  try {
    const portsOut = execSync('node scripts/ports.cjs', { encoding: 'utf8', timeout: 10_000 }).trim();
    const ports = JSON.parse(portsOut) as { web: number; server: number; preview: number };
    const lines: string[] = [];
    for (const [name, port] of Object.entries(ports)) {
      if (name === 'offset' || name === 'e2e') {
        continue;
      }
      try {
        const result = spawnSync('node', ['scripts/check-ports.cjs', '--port', String(port)], {
          encoding: 'utf8',
          timeout: 10_000,
        });
        const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().replace(/\s+/g, ' ');
        lines.push(`${name}:${port} -> ${out.slice(0, 500) || '(no output)'}`);
      } catch {
        lines.push(`${name}:${port} -> (unavailable)`);
      }
    }
    return lines.join('\n').slice(0, 4000);
  } catch {
    return '(port lookup unavailable)';
  }
}

function branchState(): string {
  const branch = capture('git rev-parse --abbrev-ref HEAD');
  const log = capture('git log --oneline -5');
  return `branch: ${branch}\n${log}`;
}

function buildWatchdogBundle(
  issueNumber: number,
  tracker: StreamTracker,
  childPid: number | undefined,
  sandbox?: { sbxBin: string; name: string },
): string {
  const lastActivity = new Date(tracker.lastNonErrorAtMs).toISOString();
  const summary = [
    `last non-error activity: ${lastActivity}`,
    `lines seen: ${tracker.linesSeen} (other=${tracker.otherCount}, upstream-transient=${tracker.upstreamCount}, gateway-quota=${tracker.gatewayCount})`,
    tracker.firstGatewayLine !== null ? `first gateway line: ${tracker.firstGatewayLine.slice(0, 500)}` : 'first gateway line: (none)',
  ].join('\n');
  const sandboxSection =
    sandbox === undefined
      ? ''
      : [
          '',
          '### Sandbox status',
          // #121: the process tree above shows the host sbx.exe proxy, not
          // the in-VM worker. This is the VM-side truth.
          sandboxStatus(sandbox.sbxBin, sandbox.name),
        ].join('\n');
  return [
    '### Process tree',
    childProcessTree(childPid),
    '',
    '### Session event summary',
    summary,
    '',
    '### Port ownership',
    portOwnership(),
    '',
    '### Branch state',
    branchState(),
    sandboxSection,
    '',
    `_Run had zero non-error stream activity for the full stuck interval; issue #${issueNumber} will be reset for a fresh Phase 0 resume._`,
  ].join('\n');
}

function postWatchdogComment(repo: string, issueNumber: number, bundle: string): void {
  const body = ['## Watchdog investigation', '', bundle].join('\n');
  const result = spawnSync('gh', ['issue', 'comment', String(issueNumber), '--repo', repo, '--body', body], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    console.error(`[agent-daemon] watchdog comment failed for #${issueNumber}`);
  }
}

interface RunOutcome {
  code: number;
  failover: boolean;
  watchdogFired: boolean;
}

/**
 * KD-2/KD-5/KD-8: spawn with explicit `--model` + `--format json` piped,
 * headless deny-via-env, raw tagged console output, classifier + watchdog
 * tracking. Resolves on close; failover/watchdog paths tree-kill first.
 */
function runSkill(command: string, issueNumber: number, opts: { dryRun: boolean; model: string; repo: string; state: DaemonState }): Promise<RunOutcome> {
  const { dryRun, model, repo, state } = opts;
  const sandbox = state.config.sandboxMode;
  const sandboxName = sandbox ? sandboxNameFor(issueNumber) : null;
  const opencodeArgv = ['run', '--command', command, String(issueNumber), '--model', model, '--format', 'json'];
  if (dryRun) {
    console.log(
      `[agent-daemon] dry-run: ${sandbox && sandboxName !== null ? plannedSandboxCommand(state.config.sbxBin, sandboxName, command, issueNumber, model) : plannedCommand(command, issueNumber, model)}`,
    );
    return Promise.resolve({ code: 0, failover: false, watchdogFired: false });
  }
  const spawnIso = new Date().toISOString();
  const tracker = createStreamTracker(Date.now());
  const stuckTimeoutMs = state.config.stuckTimeoutS * 1000;
  let child: ChildProcess;
  if (sandbox && sandboxName !== null) {
    // #121: disposable per-run microVM. Provision first (create -> github
    // secret -> auth -> allowlist -> clone); the sbx.exe client is a real
    // binary (no shell shim needed). #129: the worker runs in the in-VM
    // clone (the workdir mount's `.git` is a host-path worktree pointer).
    const githubToken = resolveGithubToken(process.env['GH_TOKEN']);
    const provisioned = provisionSandbox(state.config.sbxBin, sandboxName, process.cwd(), hostAuthJsonPath(homedir()), state.config.sbxTemplate, {
      repoSlug: repo,
      githubToken,
    });
    if (!provisioned.ok) {
      console.error(`[agent-daemon] sandbox provision failed for #${issueNumber} at step ${provisioned.step}: ${provisioned.output}`);
      destroySandbox(state.config.sbxBin, sandboxName);
      return Promise.resolve({ code: 1, failover: false, watchdogFired: false });
    }
    child = spawn(state.config.sbxBin, execArgs(sandboxName, ['opencode', ...opencodeArgv], HEADLESS_CONFIG_CONTENT, SANDBOX_REPO_DIR), {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env },
    });
  } else {
    // shell: true so Windows resolves the opencode .ps1/.cmd shim (bare spawn risks ENOENT).
    child = spawn('opencode', opencodeArgv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, OPENCODE_CONFIG_CONTENT: HEADLESS_CONFIG_CONTENT },
    });
  }
  activeChild = child;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: RunOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (watchdogTimer !== null) {
        clearInterval(watchdogTimer);
      }
      activeChild = null;
      if (sandboxName !== null) {
        // #121: client kill/exit alone orphans the in-VM worker; the
        // sandbox itself is the kill. Runs on every finish path.
        treeKill(child);
        destroySandbox(state.config.sbxBin, sandboxName);
      }
      resolve(outcome);
    };

    const handleGatewayQuota = (): void => {
      // Guard: piped lines keep flowing until the tree-kill lands; without
      // this a second gateway line would double-count the failover budget.
      if (settled) {
        return;
      }
      console.error(`[agent-daemon] gateway-quota detected for #${issueNumber}; failing over to Go`);
      if (tracker.firstGatewayLine !== null) {
        console.error(`[agent-daemon] first gateway line: ${tracker.firstGatewayLine}`);
      }
      // KD-4 ordering: tree-kill → fencing-check → label-reset → respawn.
      treeKill(child);
      const fence = checkFencing(repo, issueNumber, spawnIso);
      const { count, allowed } = recordFailover(state.failoverCounts, issueNumber);
      if (!allowed) {
        console.error(`[agent-daemon] failover budget exhausted for #${issueNumber} (${count}); parking at question`);
        parkAtQuestion(
          repo,
          issueNumber,
          `Failover budget exhausted (${count} gateway-quota failovers this daemon lifetime). Parking for a human; reset to \`ready to implement\` to retry.`,
        );
        finish({ code: 1, failover: true, watchdogFired: false });
        return;
      }
      if (isFenceClear(fence)) {
        resetToReady(repo, issueNumber);
      } else {
        console.error(`[agent-daemon] fencing blocked label reset for #${issueNumber} (labels: ${fence.labels.join(', ') || '(unknown)'})`);
      }
      noteFailover(state.probe, Date.now());
      finish({ code: 1, failover: true, watchdogFired: false });
    };

    const handleWatchdog = (): void => {
      // Guard: a gateway-quota failover may have already settled the run.
      if (settled) {
        return;
      }
      console.error(`[agent-daemon] watchdog: no non-error activity for ${state.config.stuckTimeoutS}s on #${issueNumber}; investigating`);
      const bundle = buildWatchdogBundle(
        issueNumber,
        tracker,
        child.pid,
        sandboxName !== null ? { sbxBin: state.config.sbxBin, name: sandboxName } : undefined,
      );
      // Diagnosis opencode invocations must use Go (KD-6); gh/git need no model.
      // The bundle itself is read-only shell/gh/git, so no model is consumed here.
      postWatchdogComment(repo, issueNumber, bundle);
      const fence = checkFencing(repo, issueNumber, spawnIso);
      if (isFenceClear(fence)) {
        resetToReady(repo, issueNumber);
      } else {
        console.error(`[agent-daemon] fencing blocked watchdog label reset for #${issueNumber}`);
      }
      // Watchdog never changes model state (KD-6): respawn follows current failover/probe state.
      treeKill(child);
      finish({ code: 1, failover: false, watchdogFired: true });
    };

    const watchdogTimer: ReturnType<typeof setInterval> = setInterval(() => {
      if (settled) {
        return;
      }
      if (shouldFireWatchdog(tracker.lastNonErrorAtMs, Date.now(), stuckTimeoutMs)) {
        handleWatchdog();
      }
    }, WATCHDOG_POLL_MS);

    let stdoutBuf = '';
    const pump = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      stdoutBuf += chunk.toString('utf8');
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') {
          continue;
        }
        const { tag, cls } = observeLine(line, tracker);
        // Raw JSON passthrough with session tags; unknown types untagged.
        console.log(tag !== '' ? `${tag} ${line}` : line);
        if (cls === 'gateway-quota') {
          handleGatewayQuota();
          return;
        }
      }
      if (stream === 'stderr' && chunk.length > 0) {
        // stderr text is already surfaced line-by-line above when JSON;
        // non-JSON stderr lines are printed by the loop as well.
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => pump(chunk, 'stdout'));
    child.stderr?.on('data', (chunk: Buffer) => pump(chunk, 'stderr'));

    child.on('error', (err) => {
      console.error(`[agent-daemon] failed to spawn opencode for issue #${issueNumber}: ${err.message}`);
      finish({ code: 1, failover: false, watchdogFired: false });
    });
    child.on('close', (code) => {
      if (stdoutBuf.trim() !== '') {
        const { tag, cls } = observeLine(stdoutBuf, tracker);
        console.log(tag !== '' ? `${tag} ${stdoutBuf}` : stdoutBuf);
        if (cls === 'gateway-quota' && !settled) {
          handleGatewayQuota();
          return;
        }
      }
      finish({ code: code ?? 1, failover: false, watchdogFired: false });
    });
  });
}

/**
 * KD-7: minimal-cost probe at a run boundary. Success = clean exit with no
 * gateway-quota line. Gateway-quota → stay on Go; upstream-transient /
 * inconclusive → neither success nor failover, timer keeps running.
 */
async function probeFreeTier(state: DaemonState): Promise<'success' | 'quota' | 'inconclusive'> {
  const { freeModel, probeTimeoutS } = state.config;
  console.log(`[agent-daemon] probing free tier with ${freeModel}${state.config.sandboxMode ? ' [sandbox]' : ''}`);
  return new Promise((resolve) => {
    let settled = false;
    // #121: the probe sandbox is disposable like a run sandbox.
    const probeSandbox = state.config.sandboxMode ? 'cycledesign-probe' : null;
    const finish = (outcome: 'success' | 'quota' | 'inconclusive'): void => {
      if (!settled) {
        settled = true;
        if (probeSandbox !== null) {
          treeKill(child);
          destroySandbox(state.config.sbxBin, probeSandbox);
        }
        resolve(outcome);
      }
    };
    let child: ChildProcess;
    try {
      if (probeSandbox !== null) {
        const provisioned = provisionSandbox(state.config.sbxBin, probeSandbox, process.cwd(), hostAuthJsonPath(homedir()), state.config.sbxTemplate);
        if (!provisioned.ok) {
          console.error(`[agent-daemon] probe sandbox provision failed at step ${provisioned.step}: ${provisioned.output}`);
          destroySandbox(state.config.sbxBin, probeSandbox);
          finish('inconclusive');
          return;
        }
        child = spawn(
          state.config.sbxBin,
          execArgs(probeSandbox, ['opencode', 'run', '--model', freeModel, '--format', 'json', PROBE_PROMPT], HEADLESS_CONFIG_CONTENT),
          { stdio: ['ignore', 'pipe', 'pipe'], shell: false, env: { ...process.env } },
        );
      } else {
        child = spawn('opencode', ['run', '--model', freeModel, '--format', 'json', PROBE_PROMPT], {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
          env: { ...process.env, OPENCODE_CONFIG_CONTENT: HEADLESS_CONFIG_CONTENT },
        });
      }
    } catch {
      finish('inconclusive');
      return;
    }
    let sawQuota = false;
    let buf = '';
    const onChunk = (chunk: Buffer): void => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') {
          continue;
        }
        console.log(`[probe] ${line}`);
        if (classifyLine(line) === 'gateway-quota') {
          sawQuota = true;
        }
      }
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    const timer = setTimeout(() => {
      treeKill(child);
      finish('inconclusive');
    }, probeTimeoutS * 1000);
    child.on('error', () => {
      clearTimeout(timer);
      finish('inconclusive');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim() !== '' && classifyLine(buf) === 'gateway-quota') {
        sawQuota = true;
      }
      if (sawQuota) {
        finish('quota');
      } else if (code === 0) {
        finish('success');
      } else {
        finish('inconclusive');
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      resolve();
    }, ms);
  });
}

type UpdateStatus = 'current' | 'behind' | 'skipped';

interface UpdateCheckResult {
  status: UpdateStatus;
  reason?: string;
  local?: string;
  remote?: string;
}

interface UpdateCheckState {
  intervalSeconds: number;
  lastCheck: number;
}

function runGit(args: string[], timeoutMs?: number): { ok: boolean; stdout: string; status: number | null; error?: string } {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: timeoutMs });
  if (result.error) {
    return { ok: false, stdout: '', status: result.status ?? null, error: (result.error as Error).message };
  }
  return { ok: result.status === 0, stdout: (result.stdout || '').trim(), status: result.status };
}

function checkForUpdate(): UpdateCheckResult {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch.ok || !branch.stdout) {
    return { status: 'skipped', reason: 'git-error' };
  }
  if (branch.stdout !== 'main') {
    return { status: 'skipped', reason: `not-on-main:${branch.stdout}` };
  }
  const upstream = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!upstream.ok || !upstream.stdout) {
    return { status: 'skipped', reason: 'no-upstream' };
  }
  if (upstream.stdout !== 'origin/main') {
    return { status: 'skipped', reason: `upstream-${upstream.stdout}` };
  }
  const fetch = runGit(['fetch', 'origin', 'main'], UPDATE_FETCH_TIMEOUT_MS);
  if (!fetch.ok) {
    return { status: 'skipped', reason: `fetch-failed${fetch.error ? `:${fetch.error}` : ''}` };
  }
  const local = runGit(['rev-parse', 'HEAD']);
  const remote = runGit(['rev-parse', 'origin/main']);
  if (!local.ok || !remote.ok || !local.stdout || !remote.stdout) {
    return { status: 'skipped', reason: 'rev-parse-failed' };
  }
  if (local.stdout === remote.stdout) {
    return { status: 'current', local: local.stdout, remote: remote.stdout };
  }
  const ancestor = runGit(['merge-base', '--is-ancestor', local.stdout, remote.stdout]);
  if (ancestor.ok) {
    return { status: 'behind', local: local.stdout, remote: remote.stdout };
  }
  return { status: 'skipped', reason: 'diverged' };
}

/**
 * Time-based behind-check. Never kills a run: call only when no run is in
 * flight (between passes / between individual runs). On behind (non-dry-run)
 * logs SHAs and exits EXIT_UPDATE; dry-run only reports.
 */
async function maybeCheckForUpdate(state: UpdateCheckState, dryRun: boolean): Promise<UpdateStatus | 'disabled' | 'not-due'> {
  if (state.intervalSeconds <= 0) {
    if (dryRun) {
      console.log('[agent-daemon] update-check: skipped (disabled)');
    }
    return 'disabled';
  }
  const now = Date.now();
  if (now - state.lastCheck < state.intervalSeconds * 1000) {
    return 'not-due';
  }
  state.lastCheck = now;
  const result = checkForUpdate();
  if (result.status === 'behind') {
    if (dryRun) {
      console.log(`[agent-daemon] update-check: behind (${result.local} -> ${result.remote})`);
      return 'behind';
    }
    console.log(`[agent-daemon] update available (${result.local} -> ${result.remote}), exiting for supervisor restart`);
    process.exit(EXIT_UPDATE);
  }
  if (dryRun) {
    console.log(`[agent-daemon] update-check: ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
  } else if (result.status === 'skipped') {
    console.log(`[agent-daemon] update-check: skipped (${result.reason})`);
  }
  return result.status;
}

/** KD-7: probe only at run boundaries when no run is in flight. */
async function maybeProbe(state: DaemonState, dryRun: boolean): Promise<void> {
  const intervalMs = state.config.probeIntervalS * 1000;
  if (!shouldProbe(state.probe, Date.now(), intervalMs, false)) {
    return;
  }
  if (dryRun) {
    console.log(`[agent-daemon] dry-run: probe ${state.config.freeModel} "${PROBE_PROMPT}"`);
    return;
  }
  const outcome = await probeFreeTier(state);
  applyProbeResult(state.probe, outcome, Date.now());
  if (outcome === 'success') {
    console.log(`[agent-daemon] free tier recovered; subsequent runs use ${state.config.freeModel}`);
  } else {
    console.log(`[agent-daemon] probe ${outcome}; staying on ${state.config.goModel}`);
  }
}

function modelForRun(state: DaemonState): string {
  return state.probe.model === 'go' ? state.config.goModel : state.config.freeModel;
}

async function pollOnce(repo: string, dryRun: boolean, updateState: UpdateCheckState, state: DaemonState): Promise<void> {
  await maybeCheckForUpdate(updateState, dryRun);
  // Failback probe fires at this run boundary (no run in flight here).
  await maybeProbe(state, dryRun);
  let planIssues: ListedIssue[];
  let implementIssues: ListedIssue[];
  try {
    planIssues = listIssues(repo, LABEL_PLAN);
    implementIssues = listIssues(repo, LABEL_IMPLEMENT);
  } catch (err) {
    // Transient gh/network/auth failure: log, skip this pass, retry next interval.
    console.error(`[agent-daemon] ${(err as Error).message}; skipping pass`);
    return;
  }

  const runs = planPass(planIssues, implementIssues);
  if (runs.length === 0) {
    console.log('[agent-daemon] no labeled issues found');
    return;
  }

  for (const run of runs) {
    // A respawned failover run re-enters here on the next pass via its reset label.
    const model = modelForRun(state);
    console.log(`[agent-daemon] claiming issue #${run.issue.number} ("${run.issue.title}") via ${run.command} [label: ${run.label}] [model: ${model}]`);
    const outcome = await runSkill(run.command, run.issue.number, { dryRun, model, repo, state });
    console.log(`[agent-daemon] completed issue #${run.issue.number} via ${run.command} exit code ${outcome.code} [model: ${model}]`);
    if (outcome.failover) {
      // KD-4: respawn on Go happens on the next poll via the reset label;
      // continue the queue rather than recursing mid-pass.
      console.log(`[agent-daemon] failover armed Go model (${state.config.goModel}); respawn on next poll`);
    }
    // Behind-check between runs only (never mid-run): a behind result exits
    // 42 inside maybeCheckForUpdate, aborting the remaining queue. Unclaimed
    // queued items keep their labels and are picked up post-restart.
    if (run !== runs[runs.length - 1]) {
      await maybeCheckForUpdate(updateState, dryRun);
      // Probe between queued runs as well (still a run boundary).
      await maybeProbe(state, dryRun);
    }
  }
}

async function main(): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      options: {
        repo: { type: 'string' },
        interval: { type: 'string' },
        once: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'update-check-interval': { type: 'string' },
        'no-update-check': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    });
  } catch (err) {
    fail((err as Error).message);
  }

  const values = (parsed as ReturnType<typeof parseArgs>).values;
  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const repo = (values.repo as string | undefined) ?? DEFAULT_REPO;
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    fail(`--repo must match OWNER/REPO, got "${repo}"`);
  }

  const rawInterval = (values.interval as string | undefined) ?? String(DEFAULT_INTERVAL_SECONDS);
  const interval = Number(rawInterval);
  if (!Number.isInteger(interval) || interval <= 0) {
    fail(`--interval must be a positive integer (seconds), got "${rawInterval}"`);
  }

  const once = Boolean(values.once);
  const dryRun = Boolean(values['dry-run']);

  let updateInterval: number;
  if (Boolean(values['no-update-check'])) {
    updateInterval = 0;
  } else {
    const rawUpdateInterval = (values['update-check-interval'] as string | undefined) ?? String(DEFAULT_UPDATE_CHECK_INTERVAL_SECONDS);
    updateInterval = Number(rawUpdateInterval);
    if (!Number.isInteger(updateInterval) || updateInterval < 0) {
      fail(`--update-check-interval must be a non-negative integer (seconds), got "${rawUpdateInterval}"`);
    }
  }
  const updateState: UpdateCheckState = { intervalSeconds: updateInterval, lastCheck: 0 };

  let daemonConfig: DaemonConfig;
  try {
    daemonConfig = loadDaemonConfig();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(2);
  }

  const state: DaemonState = {
    config: daemonConfig,
    probe: createProbeTracker(Date.now()),
    failoverCounts: new Map(),
  };

  function handleStopSignal(signal: 'SIGINT' | 'SIGTERM'): void {
    if (activeChild) {
      // Forward to the running skill; the loop resumes/completes via its close handler.
      activeChild.kill(signal);
    } else {
      if (sleepTimer) {
        clearTimeout(sleepTimer);
        sleepTimer = null;
      }
      console.log('[agent-daemon] interrupted, exiting');
      process.exit(0);
    }
  }

  process.on('SIGINT', () => handleStopSignal('SIGINT'));
  process.on('SIGTERM', () => handleStopSignal('SIGTERM'));

  console.log(
    `[agent-daemon] polling ${repo} every ${interval}s ("${LABEL_PLAN}" -> ${COMMANDS[LABEL_PLAN]}, "${LABEL_IMPLEMENT}" -> ${COMMANDS[LABEL_IMPLEMENT]})${dryRun ? ' [dry-run]' : ''}${updateInterval > 0 ? ` [update-check every ${updateInterval}s]` : ' [update-check disabled]'} [free: ${daemonConfig.freeModel}, go: ${daemonConfig.goModel}]${daemonConfig.sandboxMode ? ` [sandbox: ${daemonConfig.sbxBin} template: ${daemonConfig.sbxTemplate}]` : ''}`,
  );

  for (;;) {
    await pollOnce(repo, dryRun, updateState, state);
    if (once) {
      break;
    }
    await sleep(interval * 1000);
  }
}

void main();
