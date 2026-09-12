/**
 * VM liveness collectors for the agent daemon (#149 KD-4, #159 KD-3).
 *
 * The worker lives in-VM, so every liveness leg must be VM-side. Each
 * collector is its own `sbx exec` (a second exec runs concurrently with the
 * attached worker — proven 494ms; `&`-backgrounding inside one exec does NOT
 * detach). Steady-state cost ~0.5s each; 10s timeout each, async batch.
 *
 * Merge semantics live here with the fan-out (they differ per leg):
 * - vm-log: exec failure marks the leg failed (fail-closed); empty but
 *   successful output stays neutral (idle since spawn).
 * - vm-vcs: exec failure or unparseable tip fails closed.
 * - session-log: exec failure fails closed, but unparseable-but-successful
 *   output stays neutral with a warning, so a CLI format drift cannot wedge
 *   the watchdog into permanent silence.
 *
 * New leg #6 adds a collector path + merge case in THIS file (today a
 * hardcoded 5-way `Promise.all` using the `vm*Args` shapes from
 * `./agent-sandbox.js`). Never add a call-site branch in
 * `./agent-daemon.js` — the poll loop only sees `VmCollector`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { oneLine } from './agent-daemon-policy.js';
import {
  VM_COLLECTOR_TIMEOUT_MS,
  vmLogMtimeArgs,
  vmLogTailArgs,
  vmSessionListArgs,
  vmVcsLogArgs,
  vmVcsStatusArgs,
} from './agent-sandbox.js';

/** #149 KD-4: one VM leg (atMs = last observed life, spawn-seeded). */
export interface VmLeg {
  ok: boolean;
  atMs: number;
  detail: string;
}

/** #149 KD-4: async VM liveness snapshot (off-tick, last-good cached). */
export interface VmLiveness {
  log: VmLeg;
  vcs: VmLeg;
  sessions: VmLeg;
  collectorOk: boolean;
  collectedAtMs: number;
  /** #163: quota/error excerpt of the fetched VM log tail (capped, diffed per poll). */
  logErrors: string[];
  /** #163: raw fetched VM log tail (capped by the tail collector) for newcomer mirroring. */
  logTail: string;
}

export function seedVmLiveness(spawnMs: number): VmLiveness {
  const seed = (label: string): VmLeg => ({ ok: true, atMs: spawnMs, detail: `${label} seeded at spawn` });
  return { log: seed('vm-log'), vcs: seed('vm-vcs'), sessions: seed('session-log'), collectorOk: true, collectedAtMs: spawnMs, logErrors: [], logTail: '' };
}

/**
 * #149 KD-4: pure parsers for the VM collector outputs (unit-tested).
 * `maxLogTimestamp` reads `timestamp=<ISO>` prefixes (host and VM logs share
 * the shape); `parseVmVcsTime` reads `git log --format=%ct` epoch seconds;
 * `parseSessionListTime` best-efforts `opencode session list --format json`
 * (array or `{sessions:[...]}` envelope; `updated`/`updatedAt`/`updated_at`/
 * `time`/`timestamp` as ISO or epoch s/ms). Null = no usable time.
 */
export function maxLogTimestamp(tail: string): number | null {
  let max: number | null = null;
  for (const line of tail.split('\n')) {
    const match = /timestamp=(\S+)/.exec(line);
    if (match !== null) {
      const ms = Date.parse(match[1]);
      if (!Number.isNaN(ms) && (max === null || ms > max)) {
        max = ms;
      }
    }
  }
  return max;
}

export function parseVmVcsTime(output: string): number | null {
  const epoch = Number(output.trim().split('\n')[0]);
  if (!Number.isFinite(epoch) || epoch <= 0) {
    return null;
  }
  return epoch * 1000;
}

function sessionTimeOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Epoch s vs ms heuristic (ms epoch > 1e12).
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string' && value !== '') {
    const numeric = Number(value);
    if (value.trim() !== '' && Number.isFinite(numeric) && numeric > 0) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) {
      return ms;
    }
  }
  return null;
}

export function parseSessionListTime(output: string): number | null {
  try {
    const value: unknown = JSON.parse(output);
    const rows: unknown[] = Array.isArray(value)
      ? value
      : typeof value === 'object' && value !== null && Array.isArray((value as Record<string, unknown>)['sessions'])
        ? ((value as Record<string, unknown>)['sessions'] as unknown[])
        : [];
    let max: number | null = null;
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) {
        continue;
      }
      const record = row as Record<string, unknown>;
      for (const key of ['updated', 'updatedAt', 'updated_at', 'time', 'timestamp']) {
        const ms = sessionTimeOf(record[key]);
        if (ms !== null && (max === null || ms > max)) {
          max = ms;
        }
      }
    }
    return max;
  } catch {
    return null;
  }
}

/**
 * #163: retain (don't discard) the VM log lines that explain a stall.
 * Matches quota/error markers, capped so console use stays small. Pure for
 * tests; the watchdog tick diffs successive polls and logs only newcomers,
 * so quiet polls print nothing. No new `sbx exec` — the tail is already
 * fetched by the collector.
 */
export const VM_ERROR_EXCERPT_LINES = 20;
export const VM_ERROR_EXCERPT_CHARS = 4000;

const VM_ERROR_RE = /Rate limit exceeded|Upstream request failed|level=ERROR/;

export function vmErrorExcerpt(
  tail: string,
  maxLines: number = VM_ERROR_EXCERPT_LINES,
  maxChars: number = VM_ERROR_EXCERPT_CHARS,
): string[] {
  const out: string[] = [];
  let chars = 0;
  for (const line of tail.split('\n')) {
    if (!VM_ERROR_RE.test(line)) {
      continue;
    }
    const one = oneLine(line, 500);
    if (one === '') {
      continue;
    }
    if (out.length >= maxLines || chars + one.length > maxChars) {
      break;
    }
    out.push(one);
    chars += one.length;
  }
  return out;
}

/** #163: compact VM leg recency for the `alive` heartbeat line. */
export function vmAgesSummary(vm: VmLiveness, nowMs: number): string {
  const ageS = (atMs: number): string => `${Math.max(0, Math.round((nowMs - atMs) / 1000))}s ago`;
  return `vm: log ${ageS(vm.log.atMs)}, vcs ${ageS(vm.vcs.atMs)}, sessions ${ageS(vm.sessions.atMs)}`;
}

/**
 * #163 (host-side merge): mirror the VM log to the daemon console without
 * re-printing. Returns the lines present in `nextTail` after the previous
 * poll's overlap, oldest-first, capped — plus how many were cut and whether
 * the overlap vanished (rotation/prune: show the latest, say so).
 */
export const VM_MIRROR_LINES = 50;
export const VM_MIRROR_LINE_CHARS = 300;

export function logTailNewcomers(
  prevTail: string,
  nextTail: string,
  maxLines: number = VM_MIRROR_LINES,
): { lines: string[]; truncated: number; rotated: boolean } {
  const next = nextTail.split('\n').filter((l) => l.trim() !== '');
  if (next.length === 0) {
    return { lines: [], truncated: 0, rotated: false };
  }
  let fresh: string[] = next;
  let rotated = false;
  const prev = prevTail.split('\n').filter((l) => l.trim() !== '');
  if (prev.length > 0) {
    const anchor = prev[prev.length - 1];
    const idx = next.lastIndexOf(anchor);
    if (idx < 0) {
      rotated = true;
    } else {
      fresh = next.slice(idx + 1);
    }
  }
  if (fresh.length <= maxLines) {
    return { lines: fresh, truncated: 0, rotated };
  }
  return { lines: fresh.slice(0, maxLines), truncated: fresh.length - maxLines, rotated };
}

/**
 * #163: mark VM log lines belonging to a known nested (sub-agent) session
 * so sub-agent activity stands out in the mirrored console output.
 */
export function markNestedVmLine(line: string, nestedSessionIds: ReadonlySet<string>): string {
  const match = /session\.id=(ses_[A-Za-z0-9]+)/.exec(line);
  if (match !== null && nestedSessionIds.has(match[1])) {
    return `${line} [sub-agent]`;
  }
  return line;
}

/**
 * #163 (host-side merge): one console line per VM state transition between
 * polls — session progress, VCS movement. Pure so tests pin it; the tick
 * diffs the last-good cache against the fresh poll and logs the result.
 * Log-mtime advances alone stay on the heartbeat ages line (per-poll would
 * be chatty); error content is diffed separately via `logErrors`.
 */
export function vmProgressLines(prev: VmLiveness, next: VmLiveness): string[] {
  const out: string[] = [];
  if (next.sessions.atMs > prev.sessions.atMs) {
    out.push(`session activity: ${next.sessions.detail}`);
  }
  if (next.vcs.detail !== prev.vcs.detail) {
    out.push(`vcs: ${next.vcs.detail}`);
  }
  return out;
}

/**
 * #159 KD-3: thin `sbx exec` seam so the poll loop is testable without a
 * live sandbox. Takes the full `sbx` argv (already including the sandbox
 * name via the `vm*Args` shapes); the sandbox binary is bound by the
 * factory, not passed per call.
 */
export type ExecFn = (args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

/** #159 KD-3: a VM liveness source. Sandbox runs use `SandboxCollector`. */
export interface VmCollector {
  collect(spawnMs: number): Promise<VmLiveness>;
}

/** Async `sbx exec` with timeout (never throws; timeout → ok:false). */
function execSbxAsync(sbxBin: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let child: ChildProcess;
    try {
      child = spawn(sbxBin, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: (err as Error).message });
      return;
    }
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // Best-effort.
        }
        resolve({ ok: false, stdout, stderr: `${stderr}\ntimeout after ${timeoutMs}ms`.trim() });
      }
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, stdout, stderr: err.message });
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, stdout, stderr });
      }
    });
  });
}

/** Live `ExecFn` bound to a sandbox binary (default when no fake is given). */
export function defaultExecFn(sbxBin: string, timeoutMs: number = VM_COLLECTOR_TIMEOUT_MS): ExecFn {
  return (args) => execSbxAsync(sbxBin, args, timeoutMs);
}

/**
 * #149 KD-4/KD-7: the 5-way VM leg fan-out (each leg its own `sbx exec`) +
 * merge. Owns the `vm*Args` argv shapes from `./agent-sandbox.js` and the
 * per-leg merge semantics documented at the top of this file.
 */
export class SandboxCollector implements VmCollector {
  constructor(
    private readonly sbxBin: string,
    private readonly name: string,
    private readonly exec: ExecFn | null = null,
  ) {}

  private execFn(): ExecFn {
    return this.exec ?? defaultExecFn(this.sbxBin);
  }

  async collect(spawnMs: number): Promise<VmLiveness> {
    const exec = this.execFn();
    const [tailRes, mtimeRes, vcsRes, statusRes, sessRes] = await Promise.all([
      exec(vmLogTailArgs(this.name)),
      exec(vmLogMtimeArgs(this.name)),
      exec(vmVcsLogArgs(this.name)),
      exec(vmVcsStatusArgs(this.name)),
      exec(vmSessionListArgs(this.name)),
    ]);
    const collectedAtMs = Date.now();
    let log: VmLeg;
    if (!tailRes.ok || !mtimeRes.ok) {
      const err = !tailRes.ok ? tailRes.stderr : mtimeRes.stderr;
      log = { ok: false, atMs: spawnMs, detail: `vm-log exec failed: ${oneLine(err || 'unknown')}` };
    } else {
      const tailMax = maxLogTimestamp(tailRes.stdout);
      const mtimeS = Number(mtimeRes.stdout.trim().split('\n')[0]);
      const mtimeMs = Number.isFinite(mtimeS) && mtimeS > 0 ? mtimeS * 1000 : null;
      const atMs = Math.max(tailMax ?? Number.NEGATIVE_INFINITY, mtimeMs ?? Number.NEGATIVE_INFINITY);
      log = Number.isFinite(atMs)
        ? { ok: true, atMs, detail: `vm-log ${new Date(atMs).toISOString()}` }
        : { ok: true, atMs: spawnMs, detail: 'vm-log empty (idle since spawn)' };
    }
    let vcs: VmLeg;
    if (!vcsRes.ok) {
      vcs = { ok: false, atMs: spawnMs, detail: `vm-vcs exec failed: ${oneLine(vcsRes.stderr || 'unknown')}` };
    } else {
      const tipMs = parseVmVcsTime(vcsRes.stdout);
      const dirty = statusRes.ok && statusRes.stdout.trim() !== '';
      vcs =
        tipMs !== null
          ? { ok: true, atMs: tipMs, detail: `vm-vcs tip ${new Date(tipMs).toISOString()}${dirty ? ' +dirty' : ''}` }
          : { ok: false, atMs: spawnMs, detail: 'vm-vcs unparseable (fail-closed)' };
    }
    let sessions: VmLeg;
    if (!sessRes.ok) {
      sessions = { ok: false, atMs: spawnMs, detail: `session-log exec failed: ${oneLine(sessRes.stderr || 'unknown')}` };
    } else {
      const maxMs = parseSessionListTime(sessRes.stdout);
      sessions =
        maxMs !== null
          ? { ok: true, atMs: maxMs, detail: `session-log ${new Date(maxMs).toISOString()}` }
          : { ok: true, atMs: spawnMs, detail: 'session-log empty/unparseable (neutral, idle since spawn)' };
    }
    return { log, vcs, sessions, collectorOk: log.ok && vcs.ok && sessions.ok, collectedAtMs, logErrors: tailRes.ok ? vmErrorExcerpt(tailRes.stdout) : [], logTail: tailRes.ok ? tailRes.stdout : '' };
  }
}

/**
 * Non-sandbox runs keep `vm=null` (the watchdog predicate stays stdout-only
 * there); where a collector value is required, `NoopCollector` returns the
 * spawn-seeded snapshot.
 */
export class NoopCollector implements VmCollector {
  async collect(spawnMs: number): Promise<VmLiveness> {
    return seedVmLiveness(spawnMs);
  }
}

/**
 * Backward-compatible entry (the poll tick calls this). `exec` defaults to
 * the live `sbx` spawn; tests pass a fake. New call sites should hold a
 * `VmCollector` instead.
 */
export async function collectVmLiveness(sbxBin: string, name: string, spawnMs: number, exec?: ExecFn): Promise<VmLiveness> {
  return new SandboxCollector(sbxBin, name, exec ?? null).collect(spawnMs);
}
