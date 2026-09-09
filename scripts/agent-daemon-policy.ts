/**
 * Pure daemon policy helpers (KD-4, KD-6, KD-7): failover ordering + circuit
 * breaker, watchdog predicate, and probe state machine.
 *
 * Kept dependency-free so `node:test` can pin the state transitions without
 * spawning processes or touching the network.
 */

export const MAX_FAILOVERS_PER_ISSUE = 3;

export type ModelState = 'free' | 'go';

export interface ProbeTracker {
  model: ModelState;
  /** Wall-clock ms of the last failover or probe attempt. */
  lastTransitionAtMs: number;
  /** True while on Go and still looking for free-tier recovery. */
  probing: boolean;
}

export function createProbeTracker(nowMs: number): ProbeTracker {
  return { model: 'free', lastTransitionAtMs: nowMs, probing: false };
}

/** KD-4: failover arms the Go state and (re)starts the probe clock. */
export function noteFailover(tracker: ProbeTracker, nowMs: number): void {
  tracker.model = 'go';
  tracker.probing = true;
  tracker.lastTransitionAtMs = nowMs;
}

/**
 * KD-7: probe fires only at a run boundary — model-state is Go, probing is
 * armed, no run is in flight, and a full PROBE_INTERVAL has elapsed.
 * Watchdog-vs-probe precedence falls out naturally: an in-flight run sets
 * `runInFlight=true`, so the probe never fires mid-run.
 */
export function shouldProbe(
  tracker: ProbeTracker,
  nowMs: number,
  probeIntervalMs: number,
  runInFlight: boolean,
): boolean {
  if (tracker.model !== 'go' || !tracker.probing || runInFlight) {
    return false;
  }
  return nowMs - tracker.lastTransitionAtMs >= probeIntervalMs;
}

export type ProbeOutcome = 'success' | 'quota' | 'inconclusive';

/**
 * KD-7: success flips subsequent runs to free and disarms the timer until
 * the next failover; quota/inconclusive stay on Go with the timer running.
 */
export function applyProbeResult(tracker: ProbeTracker, outcome: ProbeOutcome, nowMs: number): void {
  if (outcome === 'success') {
    tracker.model = 'free';
    tracker.probing = false;
    tracker.lastTransitionAtMs = nowMs;
    return;
  }
  tracker.model = 'go';
  tracker.probing = true;
  tracker.lastTransitionAtMs = nowMs;
}

/**
 * KD-6: fire after a full STUCK_TIMEOUT with zero non-error JSON lines.
 * Upstream-transient-only streams still count as stuck (retry storm, no
 * progress) — callers pass the last *non-error* activity timestamp.
 */
export function shouldFireWatchdog(
  lastNonErrorActivityMs: number,
  nowMs: number,
  stuckTimeoutMs: number,
): boolean {
  return nowMs - lastNonErrorActivityMs >= stuckTimeoutMs;
}

/** KD-4 circuit breaker: max 3 failovers per issue per daemon lifetime. */
export function recordFailover(counts: Map<number, number>, issueNumber: number): { count: number; allowed: boolean } {
  const count = (counts.get(issueNumber) ?? 0) + 1;
  counts.set(issueNumber, count);
  return { count, allowed: count <= MAX_FAILOVERS_PER_ISSUE };
}

/**
 * KD-4 normative failover ordering (kill → fence → reset → respawn).
 * On circuit-breaker exhaustion the run parks at `question` instead of
 * respawning. Exported so tests pin the ordering without live quota burn.
 */
export function failoverSteps(exhausted: boolean): string[] {
  if (exhausted) {
    return ['tree-kill', 'fencing-check', 'park-at-question'];
  }
  return ['tree-kill', 'fencing-check', 'label-reset', 'respawn-on-go'];
}

/**
 * #139: minimal liveness surface for watchdog observability. The daemon's
 * StreamTracker satisfies this structurally; the helpers below stay pure so
 * `node:test` can pin the log/exit-detail wording without spawning.
 */
export interface LivenessSnapshot {
  startMs: number;
  lastNonErrorAtMs: number;
  lastChunkAtMs: number;
  pendingBytes: number;
  gatewayCount: number;
  upstreamCount: number;
  otherCount: number;
  linesSeen: number;
  lastErrorLine: string | null;
  lastLine: string | null;
}

/** #139: single-line truncation for log/error-detail strings. */
export function oneLine(value: string, max = 300): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * #139: auditable one-line summary of run liveness. Logged on watchdog
 * fire, on periodic heartbeats, and posted into the watchdog bundle, so a
 * future "not enough time passed" dispute can be settled from logs alone.
 */
export function livenessSummary(tracker: LivenessSnapshot, nowMs: number, stuckTimeoutMs: number): string {
  const silenceS = Math.max(0, Math.round((nowMs - tracker.lastNonErrorAtMs) / 1000));
  const elapsedS = Math.max(0, Math.round((nowMs - tracker.startMs) / 1000));
  const chunkAgeS = Math.max(0, Math.round((nowMs - tracker.lastChunkAtMs) / 1000));
  return (
    `silent ${silenceS}s (timeout ${Math.round(stuckTimeoutMs / 1000)}s)` +
    `; run elapsed ${elapsedS}s` +
    `; last non-error ${new Date(tracker.lastNonErrorAtMs).toISOString()}` +
    `; lines=${tracker.linesSeen} (other=${tracker.otherCount}, upstream-transient=${tracker.upstreamCount}, gateway-quota=${tracker.gatewayCount})` +
    `; last chunk ${chunkAgeS}s ago, pending ${tracker.pendingBytes}B`
  );
}

/**
 * #139: pick the most informative one-line error detail for a non-zero
 * exit. Prefers the last classified error line; falls back to the last raw
 * line; falls back to the close code/signal. Null for clean exits.
 */
export function exitDetailFor(
  tracker: Pick<LivenessSnapshot, 'lastErrorLine' | 'lastLine'>,
  code: number | null,
  signal: string | null,
): string | null {
  if (code === 0) {
    return null;
  }
  if (tracker.lastErrorLine !== null) {
    return `last error: ${oneLine(tracker.lastErrorLine)}`;
  }
  if (tracker.lastLine !== null) {
    return `last line before exit(${code ?? 'null'}${signal ? `/${signal}` : ''}): ${oneLine(tracker.lastLine)}`;
  }
  return `exit(${code ?? 'null'}${signal ? `/${signal}` : ''}) with no stream output`;
}
