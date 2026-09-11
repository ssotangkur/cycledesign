/**
 * Read-only diagnostics for the agent daemon (#159 KD-4).
 *
 * Owns the watchdog evidence pipeline end to end: shell captures
 * (`capture`), worker-tree listing (`listProcessTree` + wmic/CIM parsers),
 * port ownership, branch state, and the watchdog comment bundle
 * (`buildWatchdogBundle`, exported) with its pure formatter
 * (`formatWatchdogSections`) and total ≤24KB cap.
 *
 * Also owns the evidence types (`StreamTracker`, `VmLeg`/`VmLiveness` live
 * in `./agent-vm-liveness.js`) so `agent-daemon.js` never forms an import
 * cycle back into this module: daemon → diagnostics → vm-liveness/sandbox.
 * `agent-daemon.js` keeps thin re-exports so existing test imports hold.
 */
import { execSync, spawnSync } from 'node:child_process';
import { oneLine, type TreeProc } from './agent-daemon-policy.js';
import { markNestedVmLine, VM_ERROR_EXCERPT_CHARS, VM_ERROR_EXCERPT_LINES, VM_MIRROR_LINE_CHARS, VM_MIRROR_LINES, type VmLiveness } from './agent-vm-liveness.js';
import { HOST_RING_LINE_CHARS, HOST_RING_LINES, type StreamTracker, type WatchdogSectionsInput, type WatchdogVmTail } from './agent-daemon-types.js';
import { sandboxStatus } from './agent-sandbox.js';

/** Stream-tracker construction + host rings (types in `./agent-daemon-types.js`). */

/** #149: exported for the nested-Task fixture test (KD-6). */
export function createStreamTracker(nowMs: number): StreamTracker {
  return {
    startMs: nowMs,
    lastNonErrorAtMs: nowMs,
    lastChunkAtMs: nowMs,
    pendingBytes: 0,
    gatewayCount: 0,
    upstreamCount: 0,
    otherCount: 0,
    linesSeen: 0,
    firstGatewayLine: null,
    lastErrorLine: null,
    lastLine: null,
    recentOther: [],
    recentError: [],
    rootSessionId: null,
    parentBySession: new Map(),
    titleBySession: new Map(),
    modelBySession: new Map(),
    nestedSessionIds: new Set(),
  };
}

/**
 * #162 KD-4: push a truncated line onto a host ring, shift-evicting beyond
 * HOST_RING_LINES. Exported pure so tests pin retention/eviction.
 */
export function pushRing(ring: string[], rawLine: string): void {
  ring.push(rawLine.slice(0, HOST_RING_LINE_CHARS));
  while (ring.length > HOST_RING_LINES) {
    ring.shift();
  }
}

/** Best-effort shell capture for the watchdog bundle (never throws). */
export function capture(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).trim().slice(0, 4000);
  } catch {
    return '(unavailable)';
  }
}

/**
 * #149 KD-4 (step 6): structured worker-tree listing for the busy-vote.
 * `wmic` is absent on Win11, so fall back to a CIM query; total failure
 * yields an empty list (tree neutral, never a kill gate).
 */
export function listProcessTree(pid: number | undefined): TreeProc[] {
  if (pid === undefined) {
    return [];
  }
  if (process.platform === 'win32') {
    const wmic = parseWmicTree(capture(`wmic process where (ParentProcessId=${pid}) get ProcessId,CreationDate /FORMAT:LIST`));
    if (wmic !== null) {
      return wmic;
    }
    const cim = parseCimTree(
      capture(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} -or $_.ProcessId -eq ${pid} } | Select-Object ProcessId,CreationDate | ConvertTo-Json -Compress"`,
      ),
    );
    if (cim !== null) {
      return cim;
    }
    return [];
  }
  const procs: TreeProc[] = [{ pid, createdMs: null }];
  const out = capture(`ps --ppid ${pid} -o pid=,lstart=`);
  for (const line of out.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)\s*$/.exec(line);
    if (match !== null) {
      const childPid = Number(match[1]);
      const createdMs = Date.parse(match[2]);
      procs.push({ pid: childPid, createdMs: Number.isNaN(createdMs) ? null : createdMs });
    }
  }
  return procs;
}

/**
 * #149: parse `wmic ... /FORMAT:LIST` (`CreationDate=20260910120000.000000+060`
 * + `ProcessId=1234` pairs). Null when the output is not wmic-shaped
 * (wmic absent) so the caller falls through to CIM.
 */
export function parseWmicTree(output: string): TreeProc[] | null {
  if (output === '' || output === '(unavailable)') {
    return null;
  }
  // wmic /FORMAT:LIST separates instances with blank lines; properties are
  // alphabetical, so CreationDate precedes ProcessId within a block.
  const procs: TreeProc[] = [];
  let sawField = false;
  for (const block of output.split(/\n\s*\n/)) {
    let pid: number | null = null;
    let createdMs: number | null = null;
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      const pidMatch = /^ProcessId=(\d+)\s*$/.exec(line);
      if (pidMatch !== null) {
        sawField = true;
        pid = Number(pidMatch[1]);
        continue;
      }
      const dateMatch = /^CreationDate=(\d{14})/.exec(line);
      if (dateMatch !== null) {
        sawField = true;
        const d = dateMatch[1];
        createdMs = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)), Number(d.slice(8, 10)), Number(d.slice(10, 12)), Number(d.slice(12, 14)));
      }
    }
    if (pid !== null) {
      procs.push({ pid, createdMs });
    }
  }
  return sawField ? procs : null;
}

/**
 * #149: parse CIM `[{ProcessId,CreationDate}]` JSON (single object or array;
 * `/Date(1234567890123)/` or ISO dates). Null when not CIM-shaped.
 */
export function parseCimTree(output: string): TreeProc[] | null {
  if (output === '' || output === '(unavailable)') {
    return null;
  }
  try {
    const value: unknown = JSON.parse(output);
    const rows = Array.isArray(value) ? value : [value];
    const procs: TreeProc[] = [];
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) {
        continue;
      }
      const record = row as Record<string, unknown>;
      const pid = record['ProcessId'];
      if (typeof pid !== 'number') {
        continue;
      }
      let createdMs: number | null = null;
      const raw = record['CreationDate'];
      if (typeof raw === 'string') {
        const ticks = /\/Date\((\d+)([+-]\d+)?\)\//.exec(raw);
        createdMs = ticks !== null ? Number(ticks[1]) : Date.parse(raw);
        if (Number.isNaN(createdMs)) {
          createdMs = null;
        }
      }
      procs.push({ pid, createdMs });
    }
    return procs;
  } catch {
    return null;
  }
}

export function childProcessTree(pid: number | undefined): string {
  if (pid === undefined) {
    return '(no child pid)';
  }
  if (process.platform === 'win32') {
    const list = capture(`tasklist /FI "PID eq ${pid}" /FO TABLE /NH`);
    const tree = listProcessTree(pid);
    const children =
      tree.length > 0
        ? tree.map((p) => `pid=${p.pid} created=${p.createdMs !== null ? new Date(p.createdMs).toISOString() : '(unknown)'}`).join('\n')
        : '(tree listing unavailable — wmic/CIM both failed)';
    return `PID ${pid}: ${list}\nchildren:\n${children}`.slice(0, 4000);
  }
  return capture(`ps --ppid ${pid} -o pid,etime,pcpu,comm; ps -p ${pid} -o pid,etime,pcpu,comm`);
}

export function portOwnership(): string {
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

export function branchState(): string {
  const branch = capture('git rev-parse --abbrev-ref HEAD');
  const log = capture('git log --oneline -5');
  return `branch: ${branch}\n${log}`;
}

/**
 * #162 KD-6: total watchdog bundle cap (chars). Worst case without a cap
 * (~19KB existing sections + ~29KB new evidence) exceeds the Windows
 * CreateProcess ~32K argv limit, so `spawnSync --body` would fail and the
 * actionable comment would never land. Truncation order: host rings →
 * VM tail → VM excerpt → existing sections. What-happened / Next-run are
 * never truncated.
 */
export const WATCHDOG_BUNDLE_MAX_CHARS = 24_000;

/** Watchdog outcome, tail slice, and section inputs live in `./agent-daemon-types.js`. */

/**
 * #162 KD-4: last ≤maxLines non-empty lines sliced directly from the
 * fire-time `vm.logTail` (NOT `logTailNewcomers(prevTail, vm.logTail)` —
 * vacuous at fire time since the tick sets `prevTail = next.logTail`),
 * each `oneLine(_,300)` → `markNestedVmLine`. `prevTail` is only the
 * rotation witness (anchor lost → `rotated`). `empty` flags the
 * seeded/idle case for the bundle note.
 */
export function formatVmTailForComment(
  logTail: string,
  prevTail: string,
  nestedSessionIds: ReadonlySet<string>,
  maxLines: number = VM_MIRROR_LINES,
): WatchdogVmTail {
  const next = logTail.split('\n').filter((l) => l.trim() !== '');
  if (next.length === 0) {
    return { lines: [], truncated: 0, rotated: false, empty: true };
  }
  let rotated = false;
  const prev = prevTail.split('\n').filter((l) => l.trim() !== '');
  const anchor = prev.at(-1);
  if (anchor !== undefined && next.lastIndexOf(anchor) < 0) {
    rotated = true;
  }
  const truncated = next.length > maxLines ? next.length - maxLines : 0;
  const lines = next
    .slice(Math.max(0, next.length - maxLines))
    .map((l) => markNestedVmLine(oneLine(l, VM_MIRROR_LINE_CHARS), nestedSessionIds));
  return { lines, truncated, rotated, empty: false };
}

/** #162 KD-2: conditional-intent header + outcome matrix prose. */
function watchdogWhatHappened(input: Pick<WatchdogSectionsInput, 'silenceS' | 'timeoutS' | 'elapsedS' | 'childPid' | 'sandboxName' | 'outcome'>): string {
  const pid = input.childPid === undefined ? '(unknown PID)' : `PID ${input.childPid}`;
  const destroyBit = input.sandboxName !== null ? ` + destroyed sandbox ${input.sandboxName}` : ' (non-sandbox run, no VM to destroy)';
  const fired = `Watchdog fired after ${input.silenceS}s of zero non-error stream activity (timeout ${input.timeoutS}s; run elapsed ${input.elapsedS}s). Action taken: tree-killed worker ${pid}${destroyBit}.`;
  switch (input.outcome) {
    case 'reset-intended':
      return [
        fired,
        'Label intent: reset `implementing`→`ready to implement` for a fresh Phase 0 resume iff the fence is still clear after teardown — fence-blocked keeps `implementing` (no reset), fence-transport-failure stays fail-closed (no reset), destroy-failure parks at `question` instead. Model unchanged; respawn follows current failover/probe state.',
      ].join('\n');
    case 'fence-blocked':
      return [
        fired,
        'Outcome: fence check after teardown found a terminal signal, so labels were kept at `implementing` (no reset). Model unchanged; respawn follows current failover/probe state.',
      ].join('\n');
    case 'transport-fail-closed':
      return [
        fired,
        'Outcome: fence unreadable after teardown (transport failure), so labels were kept at `implementing` fail-closed (no reset). Model unchanged; respawn follows current failover/probe state.',
      ].join('\n');
    case 'destroy-failed':
      return [
        `Watchdog fired after ${input.silenceS}s of zero non-error stream activity (timeout ${input.timeoutS}s; run elapsed ${input.elapsedS}s). Action taken: tree-killed worker ${pid} but sandbox ${input.sandboxName ?? '(unknown)'} destroy FAILED.`,
        'Outcome: parked at `question` fail-closed (no reset) — the worker may still be alive in-VM. Reset to `ready to implement` only after confirming the sandbox is gone (`sbx ls`). Model unchanged.',
      ].join('\n');
  }
}

/** #162 KD-5: MUST investigate + verdict + avoidance; method suggestive, never mandated. */
const WATCHDOG_NEXT_RUN = [
  '### Next run',
  '- MUST (1) investigate the root cause of this stall against the evidence below, (2) post your verdict (`busy` | `rate-limited` | `wedged` + cause) and how you will avoid the same stall in your first comment, so future runs do not repeat the same wedge.',
  '- Suggested path (not required): work through the `diagnose-stuck-run` checklist.',
].join('\n');

/** #162: existing diagnostic captures (truncatable last-resort under KD-6). */
function renderWatchdogExisting(input: WatchdogSectionsInput): string {
  const parts = [
    '### Session event summary',
    input.sessionSummary,
    '',
    '### Process tree',
    input.processTree,
    '',
    '### Port ownership',
    input.portOwnership,
    '',
    '### Branch state',
    input.branchState,
  ];
  if (input.sandboxStatus !== null) {
    parts.push('', '### Sandbox status', input.sandboxStatus);
  }
  if (input.vmLegs !== null) {
    parts.push('', '### VM liveness (conjunctive legs)', input.vmLegs);
  }
  return parts.join('\n');
}

/**
 * #162 KD-1/KD-2/KD-4/KD-5/KD-6/KD-7: pure watchdog-comment formatter —
 * header wording, outcome matrix, evidence pipeline, directive block, and
 * the total ≤24KB cap (truncation order host-rings → vm-tail → vm-excerpt
 * → existing; What-happened / Next-run never truncated).
 */
export function formatWatchdogSections(input: WatchdogSectionsInput): string {
  // Most-recent-last everywhere; shrinkers keep the tail (most recent).
  let other = [...input.hostRecentOther];
  let errors = [...input.hostRecentError];
  let tailLines = [...input.vmTail.lines];
  let tailCut = 0;
  let excerpt = [...input.vmExcerpt];
  let excerptCut = 0;
  let existing = renderWatchdogExisting(input);

  const render = (): string => {
    const evidence: string[] = ['### Evidence'];
    evidence.push(`#### Host stream (last ${HOST_RING_LINES} non-error + last ${HOST_RING_LINES} error-class lines, ${HOST_RING_LINE_CHARS} chars each; most recent last)`);
    evidence.push(other.length > 0 ? other.join('\n') : '(no non-error lines captured)');
    evidence.push(errors.length > 0 ? errors.join('\n') : '(no error-class lines captured)');
    if (!input.vmPresent) {
      evidence.push('(no VM evidence — non-sandbox run)');
    } else {
      const excerptNote = excerptCut > 0 ? `; +${excerptCut} cut to fit cap` : '';
      evidence.push(`#### VM log errors (${VM_ERROR_EXCERPT_LINES} lines / ${VM_ERROR_EXCERPT_CHARS} chars as retained${excerptNote})`);
      evidence.push(excerpt.length > 0 ? excerpt.join('\n') : '(no VM error lines retained)');
      evidence.push(`#### VM log tail (last ${VM_MIRROR_LINES} lines x ${VM_MIRROR_LINE_CHARS} chars)`);
      if (input.vmTail.empty) {
        evidence.push('(VM log tail empty — seeded/idle since spawn)');
      } else {
        evidence.push(tailLines.length > 0 ? tailLines.join('\n') : '(all tail lines cut to fit cap)');
        const more = input.vmTail.truncated + tailCut;
        if (more > 0 || input.vmTail.rotated) {
          evidence.push(`… +${more} more lines (${input.vmTail.rotated ? 'overlap lost' : 'cap'})`);
        }
      }
    }
    return [['### What happened', watchdogWhatHappened(input)].join('\n'), '', evidence.join('\n'), '', existing, '', WATCHDOG_NEXT_RUN].join('\n');
  };

  const shrinkEnd = <T>(arr: T[]): T[] => arr.slice(arr.length - Math.floor(arr.length / 2));
  let out = render();
  while (out.length > WATCHDOG_BUNDLE_MAX_CHARS && other.length > 0) {
    other = shrinkEnd(other);
    out = render();
  }
  while (out.length > WATCHDOG_BUNDLE_MAX_CHARS && errors.length > 0) {
    errors = shrinkEnd(errors);
    out = render();
  }
  while (out.length > WATCHDOG_BUNDLE_MAX_CHARS && tailLines.length > 0) {
    const next = shrinkEnd(tailLines);
    tailCut += tailLines.length - next.length;
    tailLines = next;
    out = render();
  }
  while (out.length > WATCHDOG_BUNDLE_MAX_CHARS && excerpt.length > 0) {
    const next = shrinkEnd(excerpt);
    excerptCut += excerpt.length - next.length;
    excerpt = next;
    out = render();
  }
  if (out.length > WATCHDOG_BUNDLE_MAX_CHARS) {
    const note = '\n[truncated to fit 24KB watchdog cap]';
    const keep = Math.max(0, WATCHDOG_BUNDLE_MAX_CHARS - (out.length - existing.length) - note.length);
    existing = existing.slice(0, keep) + note;
    out = render();
  }
  return out;
}

export function buildWatchdogBundle(
  issueNumber: number,
  tracker: StreamTracker,
  childPid: number | undefined,
  stuckTimeoutMs: number,
  sandbox?: { sbxBin: string; name: string },
  vm?: VmLiveness,
  prevTail = '',
): string {
  const nowMs = Date.now();
  void issueNumber;
  const lastActivity = new Date(tracker.lastNonErrorAtMs).toISOString();
  // KD-4: host rings replace the lastLine/lastErrorLine singletons (kept on
  // the tracker for exit diagnosis); firstGatewayLine keeps unique value.
  const sessionSummary = [
    `spawned: ${new Date(tracker.startMs).toISOString()}`,
    `stuck timeout: ${Math.round(stuckTimeoutMs / 1000)}s; silence at fire: ${Math.round((nowMs - tracker.lastNonErrorAtMs) / 1000)}s; run elapsed: ${Math.round((nowMs - tracker.startMs) / 1000)}s`,
    `last non-error activity: ${lastActivity}`,
    `last stream bytes: ${new Date(tracker.lastChunkAtMs).toISOString()} (pending unflushed: ${tracker.pendingBytes}B)`,
    `lines seen: ${tracker.linesSeen} (other=${tracker.otherCount}, upstream-transient=${tracker.upstreamCount}, gateway-quota=${tracker.gatewayCount})`,
    tracker.firstGatewayLine !== null ? `first gateway line: ${tracker.firstGatewayLine.slice(0, HOST_RING_LINE_CHARS)}` : 'first gateway line: (none)',
  ].join('\n');
  // #121: the process tree above shows the host sbx.exe proxy, not the
  // in-VM worker. Sandbox status is the VM-side truth.
  const sandboxStatusText = sandbox === undefined ? null : sandboxStatus(sandbox.sbxBin, sandbox.name);
  // #149 KD-4: the VM legs that drove the conjunctive decision (or the
  // collector failure that fail-closed it).
  const vmLegs =
    vm === undefined
      ? null
      : [
          `collectorOk: ${vm.collectorOk} (collected ${new Date(vm.collectedAtMs).toISOString()})`,
          `vm-log: ${vm.log.detail}`,
          `vm-vcs: ${vm.vcs.detail}`,
          `session-log: ${vm.sessions.detail}`,
          `nested stdout sessions: ${tracker.nestedSessionIds.size > 0 ? [...tracker.nestedSessionIds].join(',') : '(none)'}`,
        ].join('\n');
  return formatWatchdogSections({
    silenceS: Math.round((nowMs - tracker.lastNonErrorAtMs) / 1000),
    timeoutS: Math.round(stuckTimeoutMs / 1000),
    elapsedS: Math.round((nowMs - tracker.startMs) / 1000),
    childPid,
    sandboxName: sandbox?.name ?? null,
    outcome: 'reset-intended',
    hostRecentOther: tracker.recentOther,
    hostRecentError: tracker.recentError,
    vmExcerpt: vm?.logErrors ?? [],
    vmTail: vm === undefined ? { lines: [], truncated: 0, rotated: false, empty: true } : formatVmTailForComment(vm.logTail, prevTail, tracker.nestedSessionIds),
    vmPresent: vm !== undefined,
    sessionSummary,
    processTree: childProcessTree(childPid),
    portOwnership: portOwnership(),
    branchState: branchState(),
    sandboxStatus: sandboxStatusText,
    vmLegs,
  });
}
