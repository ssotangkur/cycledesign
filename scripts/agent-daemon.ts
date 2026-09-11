#!/usr/bin/env node
/**
 * Polling-first daemon that watches the Project board `Status` field first
 * (#146) and issue labels as fallback, invoking the right fire-and-forget
 * skill via the opencode CLI, resuming after each run.
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
 *   sub-agents, not the daemon). #139: the fire log and bundle carry the
 *   full liveness evidence (silence elapsed, last-activity time, line
 *   breakdown, last-chunk age, pending bytes), a heartbeat status line is
 *   logged every third of the window while a run is in flight, and every
 *   non-zero exit carries a one-line causal detail instead of a bare code.
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
 *   full planned command including `--model`. Every live spawn logs that
 *   same full command plus a finish/failover `models:` line pairing the
 *   requested `--model` with the best-effort observed session model(s), so
 *   a "was it really on Go?" dispute settles from the logs alone.
 * - Sandbox mode (#121): SANDBOX_MODE=1 runs each worker in a disposable
 *   Docker Sandbox microVM via attached `sbx exec` (survives host process
 *   killers like GameGuard). Auth = host auth.json copy, egress =
 *   per-sandbox allowlist. Killing the host client alone orphans the
 *   in-VM worker, so every finish path destroys the sandbox. Off by
 *   default; the watchdog tree section then shows the host sbx proxy.
 * - Project mirror (#140): GH_TOKEN (or host `gh` login) needs the
 *   `project` scope or the board Status mirror fails. The daemon
 *   preflights read-only `project view` + `field-list` at boot (exit 2 on
 *   auth/scope with the `gh auth refresh -s project` fix, warn-and-continue
 *   on transport, re-checked every 30 min). See `.agent-daemon.env.example`.
 *
 * Label -> skill mapping (bare command names, no leading slash):
 *   "ready to plan"      -> gh-plan-with-reason
 *   "ready to implement" -> resolve-issue
 *
 * Status is the source of truth for claimable work (#146): Project Status
 * `Ready to plan` / `Ready to implement` triggers the same commands (see
 * `agent-daemon-board.ts`). Each pass unions the board read with the label
 * poll (board wins ties, downstream-most wins conflicts); a board-claimable
 * issue missing its trigger label gets the label added back (fence-gated,
 * add-only reconcile) before claiming.
 *
 * "question" / "pr ready" are terminal and never re-triggered (not polled).
 * The daemon owns the lease (#132): it swaps trigger -> in-progress at
 * spawn and swaps back on every finish path unless the worker reached a
 * terminal state. The worker Phase 0 claim stays as idempotent backup.
 *
 * Usage:
 *   npx tsx scripts/agent-daemon.ts [--repo OWNER/REPO] [--interval SECONDS] [--once] [--dry-run] [--update-check-interval SECONDS] [--no-update-check] [--help]
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { loadDaemonConfig, type DaemonConfig } from './agent-daemon-config.js';
import { classifyLine } from './agent-daemon-classify.js';
import {
  applyProbeResult,
  createProbeTracker,
  exitDetailFor,
  heartbeatIntervalMs,
  isTreeHot,
  livenessSummary,
  noteFailover,
  oneLine,
  recordFailover,
  shouldFireWatchdog,
  shouldProbe,
  suppressionSummary,
  watchdogDecision,
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
  vmProjectEnv,
} from './agent-sandbox.js';
import {
  buildWatchdogBundle,
  createStreamTracker,
  listProcessTree,
  pushRing,
} from './agent-diagnostics.js';
import { HOST_RING_LINE_CHARS, HOST_RING_LINES, type StreamTracker } from './agent-daemon-types.js';
export { HOST_RING_LINES, HOST_RING_LINE_CHARS } from './agent-daemon-types.js';
export {
  WATCHDOG_BUNDLE_MAX_CHARS,
  createStreamTracker,
  formatVmTailForComment,
  formatWatchdogSections,
  parseCimTree,
  parseWmicTree,
  pushRing,
} from './agent-diagnostics.js';
import {
  VM_MIRROR_LINE_CHARS,
  collectVmLiveness,
  logTailNewcomers,
  markNestedVmLine,
  seedVmLiveness,
  vmAgesSummary,
  vmErrorExcerpt,
  vmProgressLines,
  type VmLiveness,
  type ExecFn,
} from './agent-vm-liveness.js';
import { claimIssue, isFenceTransportFailure, leaseForCommand, releaseLease, type IssueLease } from './agent-daemon-lease.js';
import {
  decideReconcile,
  listClaimableByStatus,
  mergeClaimableRuns,
  type BoardHydratedIssue,
} from './agent-daemon-board.js';
import { checkProjectRead, projectNumber, projectOwner, syncStatusForLabelDetailed } from './agent-project.js';
import { tryReturnToMain } from './agent-daemon-return-main.js';
import { createTeardownState, teardownRun, type TeardownDeps } from './agent-daemon-teardown.js';
import { treeKill, treeKillVerified } from './agent-tree-kill.js';

// Re-exported so existing call sites and tests keep working via agent-daemon.js.
export { treeKill, treeKillVerified };
export {
  VM_ERROR_EXCERPT_CHARS,
  VM_ERROR_EXCERPT_LINES,
  VM_MIRROR_LINE_CHARS,
  VM_MIRROR_LINES,
  logTailNewcomers,
  markNestedVmLine,
  maxLogTimestamp,
  parseSessionListTime,
  parseVmVcsTime,
  seedVmLiveness,
  vmAgesSummary,
  vmErrorExcerpt,
  vmProgressLines,
} from './agent-vm-liveness.js';
export type { VmLeg, VmLiveness } from './agent-vm-liveness.js';

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

interface DaemonState {
  config: DaemonConfig;
  probe: ProbeTracker;
  failoverCounts: Map<number, number>;
}

/** KD-6/KD-8: per-run stream tracking lives in `./agent-diagnostics.js` (evidence types). */

let activeChild: ChildProcess | null = null;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;
// #127: run context owned by the daemon (sandbox name + lease live here, so
// the signal path can tear down what the supervisor cannot reach).
let currentSandbox: { sbxBin: string; name: string } | null = null;
let currentLease: { repo: string; issueNumber: number; lease: IssueLease; spawnIso: string } | null = null;
// #127: probe context (function-local child never published before; the
// probe sandbox is disposable like a run sandbox). Run and probe never
// overlap (sequential awaits in pollOnce), so one slot each suffices.
let activeProbe: { child: ChildProcess; sbxBin: string | null; name: string | null } | null = null;

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
 * #146 KD-4: hydrate a board-only candidate via `gh issue view` to confirm
 * it is still OPEN and to fill `planPass`'s `{number,title,createdAt}` shape.
 * Returns null on any failure (fail-soft: the caller skips the candidate).
 */
function hydrateIssue(repo: string, issueNumber: number): { state: string; title: string; createdAt: string; labels: string[] } | null {
  const result = spawnSync(
    'gh',
    ['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'state,title,labels,createdAt'],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout || '{}') as {
      state?: string;
      title?: string;
      createdAt?: string;
      labels?: Array<{ name?: string } | string>;
    };
    if (typeof parsed.state !== 'string' || typeof parsed.createdAt !== 'string') {
      return null;
    }
    return {
      state: parsed.state,
      title: parsed.title ?? '',
      createdAt: parsed.createdAt,
      labels: (parsed.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter((l) => l !== ''),
    };
  } catch {
    return null;
  }
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
 * Best-effort observed-model extraction. Field paths are not locked (same
 * caveat as parentID/title above): checks `model`/`modelID` at the top
 * level and inside a `session` object, combining `providerID` + `modelID`
 * when both are present. Returns null when nothing model-shaped is found;
 * callers record it only as an observation, never as control input.
 */
export function extractModel(parsed: Record<string, unknown>): string | null {
  const pick = (record: Record<string, unknown>): string | null => {
    const provider = typeof record['providerID'] === 'string' ? (record['providerID'] as string) : null;
    const modelId = typeof record['modelID'] === 'string' ? (record['modelID'] as string) : null;
    if (provider !== null && modelId !== null) {
      return `${provider}/${modelId}`;
    }
    if (modelId !== null) {
      return modelId;
    }
    const model = typeof record['model'] === 'string' ? (record['model'] as string) : null;
    return model;
  };
  const direct = pick(parsed);
  if (direct !== null) {
    return direct;
  }
  const session = parsed['session'];
  if (typeof session === 'object' && session !== null) {
    return pick(session as Record<string, unknown>);
  }
  return null;
}

/**
 * KD-8: extract the session tag for a raw JSON line. Only `type`,
 * `sessionID`, and `part.sessionID` are parsed structurally; everything else
 * passes through. Maintains the `session.created` → `parentID` map when the
 * envelope carries it; degrades to short-ID tags when it does not.
 * Also records the best-effort observed model per session (see
 * `extractModel`) so logs can show requested `--model` vs actual.
 *
 * #149 KD-6: root stdout buffers nested-Task output until Task-end inside
 * ONE `tool_use` envelope (proven by the Go-model probe: 7 lines, one root
 * sessionID, zero mid-Task lines), so a distinct-session line still tags
 * `[sub:]` when it appears, but nested-Task liveness is NEVER inferred from
 * stdout — the nested ID (`part.state.metadata.sessionId`) goes to the
 * side-table only, and the VM log tail is the authoritative sub-agent source.
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
  const observed = extractModel(parsed);
  if (observed !== null && !tracker.modelBySession.has(activeSession)) {
    tracker.modelBySession.set(activeSession, observed);
  }
  // #149 KD-6: nested-Task completion lines carry the child session at
  // `part.state.metadata.sessionId` (probe-verified; NOT top-level
  // `parentID`). Side-table only — the line keeps its `[orchestrator]` tag.
  const state = part !== null && typeof part === 'object' ? (part as Record<string, unknown>)['state'] : null;
  if (typeof state === 'object' && state !== null) {
    const metadata = (state as Record<string, unknown>)['metadata'];
    if (typeof metadata === 'object' && metadata !== null) {
      const nestedId = (metadata as Record<string, unknown>)['sessionId'];
      if (typeof nestedId === 'string' && nestedId !== '') {
        tracker.nestedSessionIds.add(nestedId);
      }
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
export function observeLine(
  rawLine: string,
  tracker: StreamTracker,
): { tag: string; cls: ReturnType<typeof classifyLine>; nestedSessionId: string | null } {
  // #163: tagForLine adds at most one nested ID per call, so set growth
  // means the last element is the newly-seen child. Returned (not logged)
  // here — pump owns the issue number and logs it, so the ID is no longer
  // buried in the side-table.
  const before = tracker.nestedSessionIds.size;
  const tag = tagForLine(rawLine, tracker);
  let nestedSessionId: string | null = null;
  if (tracker.nestedSessionIds.size > before) {
    const ids = [...tracker.nestedSessionIds];
    nestedSessionId = ids[ids.length - 1] ?? null;
  }
  const cls = classifyLine(rawLine);
  tracker.linesSeen += 1;
  tracker.lastLine = rawLine.slice(0, HOST_RING_LINE_CHARS);
  if (cls === 'gateway-quota') {
    tracker.gatewayCount += 1;
    tracker.lastErrorLine = rawLine.slice(0, HOST_RING_LINE_CHARS);
    pushRing(tracker.recentError, rawLine);
    if (tracker.firstGatewayLine === null) {
      // KD-3: log the full JSON line on first hit so field paths can be locked later.
      tracker.firstGatewayLine = rawLine;
    }
  } else if (cls === 'upstream-transient') {
    tracker.upstreamCount += 1;
    tracker.lastErrorLine = rawLine.slice(0, HOST_RING_LINE_CHARS);
    pushRing(tracker.recentError, rawLine);
  } else {
    tracker.otherCount += 1;
    tracker.lastNonErrorAtMs = Date.now();
    pushRing(tracker.recentOther, rawLine);
  }
  return { tag, cls, nestedSessionId };
}

/**
 * One-line requested-vs-observed model summary for run logs. `observed`
 * collects the distinct best-effort session models seen on the stream;
 * `(none observed)` means the CLI never emitted a model-shaped field, so
 * only the requested `--model` is known.
 */
export function modelsSummary(tracker: StreamTracker, requested: string): string {
  const observed = [...new Set(tracker.modelBySession.values())];
  return `requested=${requested}; observed=${observed.length > 0 ? observed.join(',') : '(none observed)'}`;
}

/**
 * KD-4 (#127): tree-kill lives in `./agent-tree-kill.js` (shared with the
 * supervisor). The local definition was replaced by the import above; this
 * block intentionally left no local copy so the two sides cannot drift.
 */

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
/**
 * #162 KD-3: pure terminal-comment scan behind `checkFencing` (unit-tested).
 * Comments before `sinceIso` are prior-run (ignored). A `## Watchdog
 * investigation` comment at/after `sinceIso` is this run's own just-posted
 * bundle (one run per issue holds via lease) — NOT a terminal signal, so it
 * must not suppress the reset the bundle promises. Every other terminal
 * signal (`## Plan with Reason`, `## Question`, `Q\d+:`) still blocks.
 */
export function hasTerminalCommentSince(
  comments: Array<{ body?: string; createdAt?: string }>,
  sinceIso: string,
): boolean {
  const since = Date.parse(sinceIso || '');
  for (const comment of comments ?? []) {
    const created = Date.parse(comment.createdAt ?? '');
    if (!Number.isNaN(since) && !Number.isNaN(created) && created < since) {
      continue;
    }
    const body = comment.body ?? '';
    // Own-run watchdog bundle (created at/after spawn): skip — it is never
    // a worker terminal signal. Unparseable dates stay fail-closed (fall
    // through to the terminal test below, as before).
    if (
      /^## Watchdog investigation/m.test(body) &&
      !Number.isNaN(since) &&
      !Number.isNaN(created) &&
      created >= since
    ) {
      continue;
    }
    // KD-6 (#132): `## Planning Questions - Round N` is intentionally
    // absent here. The blocked-plan path is suppressed via the `question`
    // label (TERMINAL_LABELS in agent-daemon-lease.ts); matching the Round
    // comment would strand the normal-exit re-queue the no-answer guard
    // relies on. Do not "fix" this by adding it.
    if (/## Plan with Reason|## Watchdog investigation|## Question|^Q\d+:/m.test(body)) {
      return true;
    }
  }
  return false;
}

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
    terminalCommentSince = hasTerminalCommentSince(parsed.comments ?? [], sinceIso);
  } catch {
    return { labels: [], terminalCommentSince: true };
  }
  return { labels, terminalCommentSince };
}

export function isFenceClear(state: IssueState): boolean {
  return state.labels.includes(LABEL_IMPLEMENTING) && !state.terminalCommentSince;
}

/** KD-5 (#132): blocking sleep for the single fence retry (finish is sync). */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // Best-effort: a failed sleep just means the retry fires immediately.
  }
}

/**
 * KD-3/KD-5 (#132): fence + release with one bounded retry. On the
 * fail-closed transport-failure signature (`labels:[]` +
 * `terminalCommentSince:true`) the fence is re-queried once after a short
 * delay; on persistent failure the caller logs and accepts the best-effort
 * gap (never fail-open, so a just-landed terminal state is never clobbered).
 *
 * #159: `firstFence` reuses the fence `teardownRun` already fetched so the
 * release path fences once (destroy-before-fence stays structural); omitted
 * it fences itself (signal path).
 */
function releaseLeaseWithRetry(
  repo: string,
  issueNumber: number,
  lease: { trigger: string; inProgress: string },
  spawnIso: string,
  firstFence?: IssueState,
): { result: 'released' | 'suppressed' | 'failed'; fence: IssueState } {
  let fence = firstFence ?? checkFencing(repo, issueNumber, spawnIso);
  if (isFenceTransportFailure(fence)) {
    sleepSync(1500);
    fence = checkFencing(repo, issueNumber, spawnIso);
    if (isFenceTransportFailure(fence)) {
      // Fail-closed means releaseLease below reports 'suppressed' (no
      // in-progress label in the empty fence), which callers do not log —
      // so log here, or a stranded lease is invisible in the logs.
      console.error(
        `[agent-daemon] lease fence unavailable for #${issueNumber} after retry; keeping ${lease.inProgress} (fail-closed, may need manual reset to ${lease.trigger})`,
      );
    }
  }
  return { result: releaseLease(repo, issueNumber, lease, fence), fence };
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
  } else {
    const mirror = syncStatusForLabelDetailed(repo, issueNumber, LABEL_IMPLEMENT);
    if (mirror.result === 'failed') {
      console.warn(`[agent-daemon] project Status mirror failed for #${issueNumber} (${LABEL_IMPLEMENT}) [step: ${mirror.step}] [kind: ${mirror.kind}] ${mirror.stderr}`);
    }
  }
}

function parkAtQuestion(repo: string, issueNumber: number, body: string): void {
  // NOTE: '--body' here is safe — spawnSync arg-array (no shell), so backticks/$/quotes bypass PowerShell escaping. Do NOT "fix" to --body-file.
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
  } else {
    const mirror = syncStatusForLabelDetailed(repo, issueNumber, LABEL_QUESTION);
    if (mirror.result === 'failed') {
      console.warn(`[agent-daemon] project Status mirror failed for #${issueNumber} (${LABEL_QUESTION}) [step: ${mirror.step}] [kind: ${mirror.kind}] ${mirror.stderr}`);
    }
  }
}

/**
 * #159 KD-2: shared destroy-failure park body (was inline in the per-path
 * `handleDestroyFailure` closure). A failed destroy parks at `question`
 * fail-closed — a blind reset would re-queue a duplicate run behind the
 * orphan — with the manual-reset hint in the log and the comment.
 */
function destroyParkBody(destroyed: { ok: boolean; output: string }, extra?: string): string {
  return `Sandbox destroy failed after kill, so the worker may still be alive in-VM. Parked at \`question\` (fail-closed); reset to \`ready to implement\` only after confirming the sandbox is gone (\`sbx ls\`).${extra ?? ''}\n\nDestroy output:\n${destroyed.output}`;
}

/**
 * KD-1 (#140): fail-fast project preflight. Read-only `project view` +
 * `field-list` (no mutation), skipped under `--dry-run`.
 * - auth/scope failure -> exit 2 with setup instructions (supervisor never
 *   restarts on exit 2, same channel as missing `.agent-daemon.env`).
 * - config failure (bad field/option, unparseable JSON) -> exit 2 as well.
 * - transport failure at boot -> warn + continue (mid-run outage must not
 *   strand issues; KD-2 keeps claims non-blocking).
 * Re-checked every 30 min with error-level log on failure.
 */
export const PROJECT_RECHECK_MS = 30 * 60 * 1000;

export type PreflightAction = 'ok' | 'fail-auth' | 'fail-config' | 'fail-transport';

/** Pure decision for the preflight result (unit-tested without exiting). */
export function classifyPreflight(check: { ok: boolean; kind: string }): PreflightAction {
  if (check.ok) {
    return 'ok';
  }
  if (check.kind === 'auth') {
    return 'fail-auth';
  }
  if (check.kind === 'transport') {
    return 'fail-transport';
  }
  return 'fail-config';
}

function ghAuthStatus(): string {
  try {
    const result = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
    return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 1000);
  } catch {
    return '(gh auth status unavailable)';
  }
}

/** Exit-2 message for a permanent mirror break (auth/scope or config). */
export function projectScopeHelp(step: string, kind: string, stderr: string): string {
  const authStatus = ghAuthStatus();
  return [
    `[agent-daemon] project Status mirror unavailable [step: ${step}] [kind: ${kind}] ${stderr}`,
    `Board project: ${projectOwner()}/${projectNumber()} (Status field).`,
    `Fix: grant the 'project' scope, then restart the daemon:`,
    `  gh auth refresh -s project`,
    `or set GH_TOKEN to a token with the 'project' scope (see .agent-daemon.env.example).`,
    `gh auth status: ${authStatus || '(empty)'}`,
  ].join('\n');
}

/** Shell captures + tree/port/branch diagnostics live in `./agent-diagnostics.js`. */

/** #149 KD-4: VM liveness lives in `./agent-vm-liveness.js` (collectors + parsers). */

/** #163: VM console surfacing lives in `./agent-vm-liveness.js` (excerpt + mirror). */

/** Watchdog bundle cap, outcome, tail, and section types live in `./agent-diagnostics.js`. */

/** Watchdog section inputs, header prose, and the pure formatter live in `./agent-diagnostics.js`. */

/**
 * #149 KD-5 (AD-16): bounded comment post — an unbounded `gh` hang widens
 * the close-race window opened by the sync bundle build. Returns false on
 * failure/timeout (caller still proceeds to kill; the fire is logged).
 */
function postWatchdogComment(repo: string, issueNumber: number, bundle: string): boolean {
  const body = ['## Watchdog investigation', '', bundle].join('\n');
  // NOTE: '--body' here is safe — spawnSync arg-array (no shell), so backticks/$/quotes bypass PowerShell escaping. Do NOT "fix" to --body-file.
  const result = spawnSync('gh', ['issue', 'comment', String(issueNumber), '--repo', repo, '--body', body], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if ((result as { error?: unknown }).error || result.status !== 0) {
    console.error(`[agent-daemon] watchdog comment failed for #${issueNumber}`);
    return false;
  }
  return true;
}

interface RunOutcome {
  code: number;
  failover: boolean;
  watchdogFired: boolean;
  /** #139: one-line human cause for non-zero exits (null on clean exit). */
  detail: string | null;
}

/**
 * KD-2/KD-5/KD-8: spawn with explicit `--model` + `--format json` piped,
 * headless deny-via-env, raw tagged console output, classifier + watchdog
 * tracking. Resolves on close; failover/watchdog paths tree-kill first.
 */
function runSkill(
  command: string,
  issueNumber: number,
  opts: { dryRun: boolean; model: string; repo: string; state: DaemonState; execFn?: ExecFn },
): Promise<RunOutcome> {
  const { dryRun, model, repo, state, execFn } = opts;
  const sandbox = state.config.sandboxMode;
  const sandboxName = sandbox ? sandboxNameFor(issueNumber) : null;
  const opencodeArgv = ['run', '--command', command, String(issueNumber), '--model', model, '--format', 'json'];
  if (dryRun) {
    console.log(
      `[agent-daemon] dry-run: ${sandbox && sandboxName !== null ? plannedSandboxCommand(state.config.sbxBin, sandboxName, command, issueNumber, model) : plannedCommand(command, issueNumber, model)}`,
    );
    return Promise.resolve({ code: 0, failover: false, watchdogFired: false, detail: null });
  }
  const spawnIso = new Date().toISOString();
  const tracker = createStreamTracker(Date.now());
  const stuckTimeoutMs = state.config.stuckTimeoutS * 1000;
  // #132: daemon-owned lease. Claim before spawn (host gh, deterministic);
  // a missing trigger label means another worker holds it -> skip, not fail.
  const lease = leaseForCommand(command);
  if (lease !== null && !claimIssue(repo, issueNumber, lease)) {
    console.log(`[agent-daemon] lease not acquired for #${issueNumber} (${lease.trigger} already gone); skipping run`);
    return Promise.resolve({ code: 1, failover: false, watchdogFired: false, detail: 'lease not acquired (trigger label already gone)' });
  }
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
      // KD-4 (#132): the lease was already claimed above, and this early
      // return never enters finish() — release here or the issue strands at
      // `planning`/`implementing` (poll only lists triggers).
      // #159 KD-2: destroy-before-release (was release-then-destroy; the
      // reorder is behavior-neutral and stated explicitly).
      const provisionTeardown = teardownRun(
        {
          child: null,
          sbxBin: state.config.sbxBin,
          sandboxName,
          repo,
          issueNumber,
          lease,
          spawnIso,
          reason: 'provision',
          leaseAction: 'release',
          state: createTeardownState(),
        },
        {
          kill: () => true,
          destroy: (sbxBin, name) => destroySandbox(sbxBin, name),
          fence: (fenceRepo, fenceIssue, fenceIso) => checkFencing(fenceRepo, fenceIssue, fenceIso),
          release: (relRepo, relIssue, relLease, relIso, fence) =>
            releaseLeaseWithRetry(relRepo, relIssue, relLease, relIso, fence).result,
          reset: () => {},
          park: (parkRepo, parkIssue, destroyed, extra) => parkAtQuestion(parkRepo, parkIssue, destroyParkBody(destroyed, extra)),
        },
      );
      if (provisionTeardown.leaseResult === 'released' && lease !== null) {
        console.log(`[agent-daemon] lease released for #${issueNumber} (back to ${lease.trigger})`);
      } else if (provisionTeardown.leaseResult === 'failed' && lease !== null) {
        console.error(
          `[agent-daemon] lease release failed for #${issueNumber} (labels: ${provisionTeardown.fence?.labels.join(', ') || '(unknown)'})`,
        );
      }
      return Promise.resolve({ code: 1, failover: false, watchdogFired: false, detail: `sandbox provision failed at step ${provisioned.step}: ${oneLine(provisioned.output)}` });
    }
    // #140: forward the host board into the VM so the in-VM Status mirror
    // uses it instead of defaults (worker Phase 0 claim + done/blocked moves).
    child = spawn(
      state.config.sbxBin,
      execArgs(sandboxName, ['opencode', ...opencodeArgv], HEADLESS_CONFIG_CONTENT, SANDBOX_REPO_DIR, vmProjectEnv(projectOwner(), projectNumber())),
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env: { ...process.env },
      },
    );
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
  // #127: publish run context for the signal teardown (set next to
  // activeChild; cleared in finish below so a stale name can never leak
  // into the next run's signal path).
  currentSandbox = sandboxName !== null ? { sbxBin: state.config.sbxBin, name: sandboxName } : null;
  currentLease = lease !== null ? { repo, issueNumber, lease, spawnIso } : null;
  // Requested-vs-observed model audit: the exact `--model` argv is logged
  // here; the observed session model(s) are logged at finish/failover, so a
  // "was it really on Go?" dispute can be settled from the logs alone.
  console.log(
    `[agent-daemon] run #${issueNumber} spawn: ${sandbox && sandboxName !== null ? plannedSandboxCommand(state.config.sbxBin, sandboxName, command, issueNumber, model) : plannedCommand(command, issueNumber, model)}`,
  );

  return new Promise((resolve) => {
    let settled = false;
    // #159 KD-2: per-run teardown state + injected deps shared by every
    // finish path (finish/failover/watchdog). `teardownRun` owns the
    // destroy-before-fence/lease ordering structurally, so paths can never
    // double-destroy (once-cache) or double-park (once-flag).
    const tdState = createTeardownState();
    const tdDeps: TeardownDeps = {
      kill: (target, reason) => (target === null ? true : killClientTree(reason)),
      destroy: (sbxBin, name) => destroySandbox(sbxBin, name),
      fence: (fenceRepo, fenceIssue, fenceIso) => checkFencing(fenceRepo, fenceIssue, fenceIso),
      release: (relRepo, relIssue, relLease, relIso, fence) => releaseLeaseWithRetry(relRepo, relIssue, relLease, relIso, fence).result,
      reset: (resetRepo, resetIssue) => resetToReady(resetRepo, resetIssue),
      park: (parkRepo, parkIssue, destroyed, extra) => parkAtQuestion(parkRepo, parkIssue, destroyParkBody(destroyed, extra)),
    };
    // #149 KD-4: VM liveness cache (async off-tick, last-good) + tree pids.
    // Seeded at spawn so early polls read sane ages; collectors refresh.
    let vm: VmLiveness | null = sandboxName !== null ? seedVmLiveness(tracker.startMs) : null;
    let vmCollectInFlight = false;
    let prevTreePids: number[] = [];
    // #163: previous poll's VM error excerpt + raw tail — the tick logs
    // only newcomers (errors in full, rest capped per poll).
    let prevVmErrors: string[] = [];
    let prevTail = '';

    /** #149 KD-5: verified client tree-kill (logs when the tree survives). */
    const killClientTree = (reason: string): boolean => {
      const dead = treeKillVerified(child);
      if (!dead) {
        console.error(`[agent-daemon] run #${issueNumber} client tree still alive after verify-retry (${reason})`);
      }
      return dead;
    };

    const finish = (outcome: RunOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (watchdogTimer !== null) {
        clearInterval(watchdogTimer);
      }
      console.log(`[agent-daemon] run #${issueNumber} models: ${modelsSummary(tracker, model)}`);
      activeChild = null;
      // #127: run context belongs to this finish — clear before the sync
      // lease/sandbox teardown so a signal landing mid-teardown sees null.
      currentSandbox = null;
      currentLease = null;
      // #159 KD-2: one teardown call owns destroy-before-fence/release.
      // #121: client kill/exit alone orphans the in-VM worker; the sandbox
      // itself is the kill. A failed destroy parks (fail-closed) and
      // suppresses the release instead of re-queueing behind the orphan.
      const td = teardownRun(
        {
          child,
          sbxBin: state.config.sbxBin,
          sandboxName,
          repo,
          issueNumber,
          lease,
          spawnIso,
          reason: 'finish',
          leaseAction: 'release',
          state: tdState,
        },
        tdDeps,
      );
      if (td.parked) {
        resolve(outcome);
        return;
      }
      // #132: guaranteed lease release on every finish path. Failover and
      // watchdog paths already reset labels themselves, so this suppresses
      // there; terminal moves by the worker suppress it everywhere else.
      // Residual best-effort gap (KD-5): persistent fence transport failure
      // keeps fail-closed (no clobber) and is only logged below.
      if (td.leaseResult === 'released' && lease !== null) {
        console.log(`[agent-daemon] lease released for #${issueNumber} (back to ${lease.trigger})`);
      } else if (td.leaseResult === 'failed' && lease !== null) {
        console.error(`[agent-daemon] lease release failed for #${issueNumber} (labels: ${td.fence?.labels.join(', ') || '(unknown)'})`);
      }
      resolve(outcome);
    };

    const handleGatewayQuota = (): void => {
      // Guard: piped lines keep flowing until the tree-kill lands; without
      // this a second gateway line would double-count the failover budget.
      if (settled) {
        return;
      }
      console.error(`[agent-daemon] gateway-quota detected for #${issueNumber}; ${modelsSummary(tracker, model)}; failing over to Go`);
      if (tracker.firstGatewayLine !== null) {
        console.error(`[agent-daemon] first gateway line: ${tracker.firstGatewayLine}`);
      }
      // #159 KD-2: failover budget pre-records before teardown. Neutral
      // reorder: the per-issue lifetime counter is independent of the
      // destroy outcome, and the budget park still lands after the destroy
      // via the reset closure below (never before it — no orphan).
      const { count, allowed } = recordFailover(state.failoverCounts, issueNumber);
      // #149 KD-5 ordering: tree-kill → verify → destroy → fencing-check →
      // label-reset → respawn. A failed destroy parks (fail-closed) instead
      // of resetting behind the orphan.
      const failoverTd = teardownRun(
        {
          child,
          sbxBin: state.config.sbxBin,
          sandboxName,
          repo,
          issueNumber,
          lease,
          spawnIso,
          reason: 'failover',
          leaseAction: 'reset',
          state: tdState,
        },
        {
          ...tdDeps,
          reset: (resetRepo, resetIssue, fence) => {
            if (!allowed) {
              console.error(`[agent-daemon] failover budget exhausted for #${issueNumber} (${count}); parking at question`);
              parkAtQuestion(
                resetRepo,
                resetIssue,
                `Failover budget exhausted (${count} gateway-quota failovers this daemon lifetime). Parking for a human; reset to \`ready to implement\` to retry.`,
              );
            } else if (isFenceClear(fence)) {
              resetToReady(resetRepo, resetIssue);
            } else {
              console.error(`[agent-daemon] fencing blocked label reset for #${issueNumber} (labels: ${fence.labels.join(', ') || '(unknown)'})`);
            }
          },
        },
      );
      if (failoverTd.parked) {
        finish({ code: 1, failover: true, watchdogFired: false, detail: 'sandbox destroy failed on failover; parked at question' });
        return;
      }
      if (!allowed) {
        finish({ code: 1, failover: true, watchdogFired: false, detail: `failover budget exhausted (${count}); parked at question` });
        return;
      }
      noteFailover(state.probe, Date.now());
      finish({
        code: 1,
        failover: true,
        watchdogFired: false,
        detail: `gateway-quota failover #${count} (${oneLine(tracker.firstGatewayLine ?? tracker.lastErrorLine ?? '')})`,
      });
    };

    const handleWatchdog = (treeReason: string): void => {
      // Guard: a gateway-quota failover may have already settled the run.
      if (settled) {
        return;
      }
      // #139: log the full liveness evidence at fire time so a "not enough
      // time passed" dispute can be settled from the logs alone.
      console.error(`[agent-daemon] watchdog: no non-error activity on #${issueNumber}; ${livenessSummary(tracker, Date.now(), stuckTimeoutMs)}; tree: ${treeReason}; investigating`);
      const bundle = buildWatchdogBundle(
        issueNumber,
        tracker,
        child.pid,
        stuckTimeoutMs,
        sandboxName !== null ? { sbxBin: state.config.sbxBin, name: sandboxName } : undefined,
        vm ?? undefined,
        prevTail,
      );
      // #149 KD-5 (AD-16): re-guard after the sync bundle build — shell
      // captures are slow, and the run may have settled meanwhile.
      if (settled) {
        return;
      }
      // Diagnosis opencode invocations must use Go (KD-6); gh/git need no model.
      // The bundle itself is read-only shell/gh/git, so no model is consumed here.
      postWatchdogComment(repo, issueNumber, bundle);
      // #149 KD-5 ordering: destroy BEFORE fence-check/label-reset. A failed
      // destroy parks (fail-closed) instead of resetting behind the orphan.
      const watchdogTd = teardownRun(
        {
          child,
          sbxBin: state.config.sbxBin,
          sandboxName,
          repo,
          issueNumber,
          lease,
          spawnIso,
          reason: 'watchdog',
          leaseAction: 'reset',
          // #162 KD-6: thread watchdog context into the existing park comment
          // (no new follow-up comment per fire).
          destroyExtra: `\n\nWatchdog context: fired after ${Math.round((Date.now() - tracker.lastNonErrorAtMs) / 1000)}s of zero non-error stream activity on worker PID ${child.pid ?? '(unknown)'} (${livenessSummary(tracker, Date.now(), stuckTimeoutMs)}). The next run MUST investigate against the watchdog evidence above and post its verdict + avoidance plan.`,
          state: tdState,
        },
        {
          ...tdDeps,
          reset: (resetRepo, resetIssue, fence) => {
            if (isFenceClear(fence)) {
              resetToReady(resetRepo, resetIssue);
            } else {
              console.error(`[agent-daemon] fencing blocked watchdog label reset for #${issueNumber}`);
            }
          },
        },
      );
      if (watchdogTd.parked) {
        finish({
          code: 1,
          failover: false,
          watchdogFired: true,
          detail: `watchdog fired but sandbox destroy failed; parked at question (${livenessSummary(tracker, Date.now(), stuckTimeoutMs)})`,
        });
        return;
      }
      // Watchdog never changes model state (KD-6): respawn follows current failover/probe state.
      finish({
        code: 1,
        failover: false,
        watchdogFired: true,
        detail: `watchdog fired (${livenessSummary(tracker, Date.now(), stuckTimeoutMs)})`,
      });
    };

    // #139: heartbeat proves liveness between spawn and finish — one status
    // line per third of the stuck window (bounded 60s..300s) while a run is
    // in flight, so silence duration is always visible in recent logs.
    const heartbeatMs = heartbeatIntervalMs(stuckTimeoutMs);
    let lastHeartbeatMs = Date.now();
    const watchdogTimer: ReturnType<typeof setInterval> = setInterval(() => {
      if (settled) {
        return;
      }
      const nowMs = Date.now();
      if (sandboxName !== null && vm !== null) {
        // #149 KD-4: conjunctive predicate in sandboxMode — stdout alone is
        // NOT enough (buffered until Task-end). Collectors refresh async
        // off-tick (last-good cached); the predicate reads the cache.
        // #159 KD-5: `execFn` is injected (tests pass a fake); default is live.
        if (!vmCollectInFlight) {
          vmCollectInFlight = true;
          void collectVmLiveness(state.config.sbxBin, sandboxName, tracker.startMs, execFn).then(
            (next) => {
              if (!settled) {
                // #163: surface newcomer VM error lines in full (quiet polls
                // print nothing). String-compare is fine — capped ~20/poll.
                for (const err of next.logErrors) {
                  if (!prevVmErrors.includes(err)) {
                    console.log(`[agent-daemon] run #${issueNumber} VM log error: ${err}`);
                  }
                }
                prevVmErrors = next.logErrors;
                // #163 (host-side merge): mirror newcomer VM log lines —
                // sub-agent lines included (same file), errors excluded
                // (logged above), rest capped with a `+N more` note.
                const errSet = new Set(next.logErrors);
                const fresh = logTailNewcomers(prevTail, next.logTail);
                prevTail = next.logTail;
                const rest = fresh.lines.filter((l) => !errSet.has(oneLine(l, 500)));
                for (const line of rest) {
                  console.log(`[agent-daemon] run #${issueNumber} VM: ${markNestedVmLine(oneLine(line, VM_MIRROR_LINE_CHARS), tracker.nestedSessionIds)}`);
                }
                if (fresh.truncated > 0 || fresh.rotated) {
                  console.log(`[agent-daemon] run #${issueNumber} VM: … +${fresh.truncated} more lines (${fresh.rotated ? 'overlap lost' : 'cap'})`);
                }
                // #163 (host-side merge): log VM state transitions so the
                // console mirrors what the legs see.
                for (const line of vmProgressLines(vm, next)) {
                  console.log(`[agent-daemon] run #${issueNumber} ${line}`);
                }
                vm = next;
              }
              vmCollectInFlight = false;
            },
            () => {
              vmCollectInFlight = false;
            },
          );
        }
        const treeNow = listProcessTree(child.pid);
        const hot = isTreeHot(treeNow, prevTreePids, nowMs, stuckTimeoutMs);
        prevTreePids = treeNow.map((p) => p.pid);
        const decision = watchdogDecision({
          stdoutIdleMs: nowMs - tracker.lastNonErrorAtMs,
          vmLogIdleMs: nowMs - vm.log.atMs,
          vmVcsIdleMs: nowMs - vm.vcs.atMs,
          sessionLogIdleMs: nowMs - vm.sessions.atMs,
          treeBusy: hot.hot,
          collectorOk: vm.collectorOk,
          stuckTimeoutMs,
        });
        if (decision.fire) {
          handleWatchdog(hot.reason);
        } else if (nowMs - lastHeartbeatMs >= heartbeatMs) {
          lastHeartbeatMs = nowMs;
          console.log(`[agent-daemon] run #${issueNumber} alive; ${livenessSummary(tracker, nowMs, stuckTimeoutMs)}; ${suppressionSummary(decision)}; ${vmAgesSummary(vm, nowMs)}; tree: ${hot.reason}`);
        }
        return;
      }
      if (shouldFireWatchdog(tracker.lastNonErrorAtMs, nowMs, stuckTimeoutMs)) {
        handleWatchdog('non-sandbox (no tree vote)');
      } else if (nowMs - lastHeartbeatMs >= heartbeatMs) {
        lastHeartbeatMs = nowMs;
        console.log(`[agent-daemon] run #${issueNumber} alive; ${livenessSummary(tracker, nowMs, stuckTimeoutMs)}`);
      }
    }, WATCHDOG_POLL_MS);

    let stdoutBuf = '';
    const pump = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      // #139: raw-byte liveness — a run streaming a giant partial line (no
      // newline yet) is alive but invisible to line-based tracking. Record
      // it for the bundle; the fire predicate stays line-based on purpose
      // (an upstream retry storm must still count as stuck).
      tracker.lastChunkAtMs = Date.now();
      stdoutBuf += chunk.toString('utf8');
      tracker.pendingBytes = Buffer.byteLength(stdoutBuf, 'utf8');
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      tracker.pendingBytes = Buffer.byteLength(stdoutBuf, 'utf8');
      for (const line of lines) {
        if (line.trim() === '') {
          continue;
        }
        const { tag, cls, nestedSessionId } = observeLine(line, tracker);
        // Raw JSON passthrough with session tags; unknown types untagged.
        console.log(tag !== '' ? `${tag} ${line}` : line);
        if (nestedSessionId !== null) {
          console.log(`[agent-daemon] run #${issueNumber} nested Task session ${nestedSessionId} (parent ${tracker.rootSessionId ?? 'unknown'})`);
        }
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
      finish({ code: 1, failover: false, watchdogFired: false, detail: `spawn failed: ${oneLine(err.message)}` });
    });
    child.on('close', (code, signal) => {
      if (stdoutBuf.trim() !== '') {
        const { tag, cls, nestedSessionId } = observeLine(stdoutBuf, tracker);
        console.log(tag !== '' ? `${tag} ${stdoutBuf}` : stdoutBuf);
        if (nestedSessionId !== null) {
          console.log(`[agent-daemon] run #${issueNumber} nested Task session ${nestedSessionId} (parent ${tracker.rootSessionId ?? 'unknown'})`);
        }
        if (cls === 'gateway-quota' && !settled) {
          handleGatewayQuota();
          return;
        }
      }
      const exitCode = code ?? 1;
      // #139: never report a bare exit code — attach the causal detail.
      finish({ code: exitCode, failover: false, watchdogFired: false, detail: exitDetailFor(tracker, code, signal ?? null) });
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
        // #127: probe context belongs to this finish — clear first.
        activeProbe = null;
        if (probeSandbox !== null) {
          treeKillVerified(child);
          // #149 KD-5: log the destroy status (probe is best-effort; a
          // failed destroy here only logs — the next provision recreates).
          const destroyed = destroySandbox(state.config.sbxBin, probeSandbox);
          if (!destroyed.ok) {
            console.error(`[agent-daemon] probe sandbox destroy failed for ${probeSandbox}:\n${destroyed.output}`);
          }
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
    // #127: publish probe context for the signal teardown (bare-opencode
    // branch tracks the child with name:null — nothing to destroy there).
    activeProbe = {
      child,
      sbxBin: probeSandbox !== null ? state.config.sbxBin : null,
      name: probeSandbox,
    };
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
      treeKillVerified(child);
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

function runGit(args: string[], timeoutMs?: number): { ok: boolean; stdout: string; stderr: string; status: number | null; error?: string } {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: timeoutMs });
  if (result.error) {
    return { ok: false, stdout: '', stderr: (result.stderr as string | undefined) ?? '', status: result.status ?? null, error: (result.error as Error).message };
  }
  return { ok: result.status === 0, stdout: (result.stdout || '').trim(), stderr: (result.stderr as string | undefined) ?? '', status: result.status };
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

async function pollOnce(
  repo: string,
  dryRun: boolean,
  updateState: UpdateCheckState,
  state: DaemonState,
  daemonOpts?: { execFn?: ExecFn },
): Promise<void> {
  await maybeCheckForUpdate(updateState, dryRun);
  // #120: heal crash/empty-queue stranded state (no runSkill may run this pass).
  tryReturnToMain(dryRun);
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

  // #146 KD-2: board-first Status read, labels as fallback (never
  // Status-exclusive). A failed board read logs at error level and the pass
  // continues label-only (KD-5 fail-soft).
  const boardHydrated: BoardHydratedIssue[] = [];
  const boardRead = listClaimableByStatus(repo);
  if (!boardRead.ok) {
    console.error(
      `[agent-daemon] project board read failed [step: ${boardRead.step}] [kind: ${boardRead.kind}] ${boardRead.stderr}; continuing with labels only`,
    );
  } else {
    const known = new Set<number>([...planIssues, ...implementIssues].map((issue) => issue.number));
    for (const candidate of boardRead.candidates) {
      if (known.has(candidate.number)) {
        continue;
      }
      // KD-4: board-only hits must still be OPEN (item-list returns Done and
      // closed items too, while issue list is open-only).
      const hydrated = hydrateIssue(repo, candidate.number);
      if (hydrated === null) {
        console.warn(`[agent-daemon] board candidate #${candidate.number} (${candidate.status}) unreadable; skipping`);
        continue;
      }
      if (hydrated.state !== 'OPEN') {
        continue;
      }
      boardHydrated.push({
        number: candidate.number,
        title: hydrated.title !== '' ? hydrated.title : candidate.title,
        createdAt: hydrated.createdAt,
        status: candidate.status,
        labels: hydrated.labels,
      });
    }
  }

  const runs = mergeClaimableRuns(planIssues, implementIssues, boardHydrated);
  if (runs.length === 0) {
    console.log('[agent-daemon] no claimable issues found');
    return;
  }

  const passIso = new Date().toISOString();
  let lastHealReturned = false;
  for (const run of runs) {
    // A respawned failover run re-enters here on the next pass via its reset label.
    const model = modelForRun(state);
    let boardSuffix = run.boardStatus !== null ? ` [board: ${run.boardStatus}]` : '';
    // #146 KD-3: fence-gated add-only reconcile. A board-claimable run whose
    // trigger label is absent gets the label ADDED (plus its Status mirror);
    // nothing is ever removed here. Label-list runs already carry their
    // trigger and skip this entirely.
    if (run.boardStatus !== null && run.liveLabels !== null && !run.liveLabels.includes(run.label)) {
      const decision = decideReconcile(run.boardStatus, run.liveLabels, dryRun);
      if (decision.action === 'suppressed') {
        console.log(`[agent-daemon] reconcile suppressed for #${run.issue.number} (terminal label present); skipping this pass`);
        continue;
      } else if (decision.action === 'would-reconcile') {
        boardSuffix += ` [would-reconcile: ${decision.label}]`;
      } else if (decision.action === 'add') {
        const fence = checkFencing(repo, run.issue.number, passIso);
        if (isFenceTransportFailure(fence)) {
          console.error(`[agent-daemon] reconcile fence unavailable for #${run.issue.number}; skipping this pass`);
          continue;
        }
        const fresh = decideReconcile(run.boardStatus, fence.labels, false);
        if (fresh.action === 'suppressed' || fence.terminalCommentSince) {
          console.log(`[agent-daemon] reconcile suppressed for #${run.issue.number} on fresh fence; skipping this pass`);
          continue;
        }
        if (fresh.action === 'add') {
          const edit = spawnSync(
            'gh',
            ['issue', 'edit', String(run.issue.number), '--repo', repo, '--add-label', decision.label],
            { encoding: 'utf8' },
          );
          if (edit.error || edit.status !== 0) {
            console.error(`[agent-daemon] reconcile label add failed for #${run.issue.number}; skipping this pass`);
            continue;
          }
          const mirror = syncStatusForLabelDetailed(repo, run.issue.number, decision.label);
          if (mirror.result === 'failed') {
            console.warn(
              `[agent-daemon] project Status mirror failed for #${run.issue.number} (${decision.label}) [step: ${mirror.step}] [kind: ${mirror.kind}] ${mirror.stderr}`,
            );
          }
          boardSuffix += ` [reconciled: ${decision.label}]`;
        }
      }
    }
    console.log(`[agent-daemon] claiming issue #${run.issue.number} ("${run.issue.title}") via ${run.command} [label: ${run.label}] [model: ${model}] [stuck-timeout: ${state.config.stuckTimeoutS}s]${boardSuffix}`);
    const outcome = await runSkill(run.command, run.issue.number, { dryRun, model, repo, state, execFn: daemonOpts?.execFn });
    console.log(
      `[agent-daemon] completed issue #${run.issue.number} via ${run.command} exit code ${outcome.code} [model: ${model}]${outcome.detail !== null ? ` (${outcome.detail})` : ''}`,
    );
    if (outcome.failover) {
      // KD-4: respawn on Go happens on the next poll via the reset label;
      // continue the queue rather than recursing mid-pass.
      console.log(`[agent-daemon] failover armed Go model (${state.config.goModel}); respawn on next poll`);
    }
    // #120: best-effort return to main before the inter-run update check
    // (try-then-check lets a just-returned main exit 42 same-pass). Heal
    // failures never block the queue, failover accounting, or probe.
    const heal = tryReturnToMain(dryRun);
    if (run === runs[runs.length - 1]) {
      lastHealReturned = heal.action === 'returned-to-main';
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
  // #120: the inter-run check is skipped for the last run, so a single-run
  // pass would otherwise wait a full interval before self-updating.
  if (lastHealReturned) {
    await maybeCheckForUpdate(updateState, dryRun);
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

  // KD-1 (#140): fail-fast project preflight (read-only, no mutation; skipped under --dry-run).
  let lastProjectCheckMs = 0;
  if (!dryRun) {
    const check = checkProjectRead();
    const action = classifyPreflight(check);
    if (action === 'fail-auth' || action === 'fail-config') {
      console.error(projectScopeHelp(check.step, check.kind, check.stderr));
      process.exit(2);
    } else if (action === 'fail-transport') {
      console.warn(
        `[agent-daemon] project Status mirror unavailable at boot [step: ${check.step}] [kind: ${check.kind}] ${check.stderr}; continuing (labels still drive the daemon)`,
      );
      lastProjectCheckMs = Date.now();
    } else {
      console.log(`[agent-daemon] project Status mirror ready (owner/${projectOwner()} project ${projectNumber()}, field Status)`);
      lastProjectCheckMs = Date.now();
    }
  }

  const state: DaemonState = {
    config: daemonConfig,
    probe: createProbeTracker(Date.now()),
    failoverCounts: new Map(),
  };

  function handleStopSignal(signal: 'SIGINT' | 'SIGTERM'): void {
    console.log(`[agent-daemon] received ${signal}, tearing down`);
    // #127 run-first, then probe, then exit. treeKill before the sync
    // teardown so the in-VM worker cannot outlive the sandbox destroy
    // (killing the host sbx.exe client alone orphans it).
    if (activeChild !== null) {
      treeKillVerified(activeChild);
      activeChild = null;
    }
    if (activeProbe !== null) {
      const probe = activeProbe;
      activeProbe = null;
      treeKillVerified(probe.child);
      if (probe.sbxBin !== null && probe.name !== null) {
        try {
          destroySandbox(probe.sbxBin, probe.name);
        } catch (err) {
          console.error(`[agent-daemon] probe sandbox destroy threw for ${probe.name}: ${(err as Error).message}`);
        }
      }
    }
    // Sync lease release (all-spawnSync, signal-safe): without it the issue
    // strands at planning/implementing — no reaper exists.
    if (currentLease !== null) {
      const { repo: leaseRepo, issueNumber, lease, spawnIso: leaseSpawnIso } = currentLease;
      currentLease = null;
      try {
        const { result, fence } = releaseLeaseWithRetry(leaseRepo, issueNumber, lease, leaseSpawnIso);
        if (result === 'released') {
          console.log(`[agent-daemon] lease released for #${issueNumber} (back to ${lease.trigger})`);
        } else if (result === 'failed') {
          console.error(`[agent-daemon] lease release failed for #${issueNumber} (labels: ${fence.labels.join(', ') || '(unknown)'})`);
        }
      } catch (err) {
        console.error(`[agent-daemon] lease release threw for #${issueNumber}: ${(err as Error).message} (fail-closed, may need manual reset)`);
      }
    }
    if (currentSandbox !== null) {
      const { sbxBin, name } = currentSandbox;
      currentSandbox = null;
      try {
        destroySandbox(sbxBin, name);
      } catch (err) {
        console.error(`[agent-daemon] sandbox destroy threw for ${name}: ${(err as Error).message}`);
      }
    }
    if (sleepTimer) {
      clearTimeout(sleepTimer);
      sleepTimer = null;
    }
    // Signal path always exits 0 (intentional stop, never restart) — even
    // mid-run and even under --once (deliberately not 130).
    console.log('[agent-daemon] interrupted, exiting');
    process.exit(0);
  }

  process.on('SIGINT', () => handleStopSignal('SIGINT'));
  process.on('SIGTERM', () => handleStopSignal('SIGTERM'));

  console.log(
    `[agent-daemon] polling ${repo} every ${interval}s ("${LABEL_PLAN}" -> ${COMMANDS[LABEL_PLAN]}, "${LABEL_IMPLEMENT}" -> ${COMMANDS[LABEL_IMPLEMENT]})${dryRun ? ' [dry-run]' : ''}${updateInterval > 0 ? ` [update-check every ${updateInterval}s]` : ' [update-check disabled]'} [free: ${daemonConfig.freeModel}, go: ${daemonConfig.goModel}]${daemonConfig.sandboxMode ? ` [sandbox: ${daemonConfig.sbxBin} template: ${daemonConfig.sbxTemplate}]` : ''}`,
  );

  for (;;) {
    // KD-1: re-run the read-only probe every 30 min; error-level log on failure (never exits here).
    if (!dryRun && Date.now() - lastProjectCheckMs >= PROJECT_RECHECK_MS) {
      const check = checkProjectRead();
      lastProjectCheckMs = Date.now();
      if (!check.ok) {
        console.error(`[agent-daemon] project Status mirror recheck failed [step: ${check.step}] [kind: ${check.kind}] ${check.stderr}`);
      }
    }
    await pollOnce(repo, dryRun, updateState, state);
    if (once) {
      break;
    }
    await sleep(interval * 1000);
  }
}

// #149: only boot the daemon when invoked as the CLI entry point — tests
// import pure helpers (tagForLine, VM parsers, tracker) from this module,
// and an unconditional `void main()` would boot the poll loop on import.
const invokedAsCli = ((): boolean => {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('agent-daemon.ts') || entry.endsWith('agent-daemon.js');
})();
if (invokedAsCli) {
  void main();
}
