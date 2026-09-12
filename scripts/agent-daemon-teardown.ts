/**
 * Single-owner run teardown for the agent daemon (#159 KD-2).
 *
 * Every finish path used to repeat its own destroy-before-reset ordering
 * (tree-kill -> destroySandbox -> fence-check -> lease-action) with subtle
 * differences per path; the fifth path would forget it and orphan a worker
 * (shotgun surgery). `teardownRun` makes the ordering structural:
 *
 *   kill (host client tree) -> destroy (sandbox, once-cached) ->
 *   park-at-question on destroy failure (once-flag, suppresses the lease
 *   action) -> fence-check -> lease action (`release` swaps in-progress back
 *   to the trigger; `reset` delegates the fence/budget matrix to the caller).
 *
 * Adaptations over the KD-2 sketch (intent preserved, KDs outrank steps):
 * - `leaseAction: 'release' | 'reset'` selects the lease half. Finish and
 *   provision-failure release; failover and watchdog pass a `reset` closure
 *   owning their fence/budget matrix (failover budget pre-records before the
 *   call — a neutral reorder, documented at the call site).
 * - `reset` receives the fresh fence so callers gate without re-querying.
 * - `release` receives the fresh fence so the retry helper reuses it instead
 *   of fencing twice (see `releaseLeaseWithRetry`'s `firstFence` param).
 * - The signal path (`handleStopSignal`) and the probe finish stay
 *   standalone: sync/signal-safe + `process.exit(0)` semantics, and kill +
 *   log-only-destroy best-effort respectively. Explicitly out of scope.
 *
 * All side effects are injected via `deps` (no import from
 * `./agent-daemon.js`, so no cycle); unit tests drive it with fakes. Never
 * throws — a throwing dep is treated as a failed step, fail-closed.
 */

export interface DestroyResult {
  ok: boolean;
  output: string;
}

export interface FenceState {
  labels: string[];
  terminalCommentSince: boolean;
}

export interface LeaseLabels {
  trigger: string;
  inProgress: string;
}

export type LeaseResult = 'released' | 'suppressed' | 'failed';

/** Per-run mutable teardown state (once-cache + once-flag, KD-2). */
export interface TeardownState {
  /** Cached `destroySandbox` outcome; null until the first destroy. */
  sandboxGone: DestroyResult | null;
  /** True once a destroy-failure park has landed (no double parks). */
  destroyParked: boolean;
}

export function createTeardownState(): TeardownState {
  return { sandboxGone: null, destroyParked: false };
}

export interface TeardownContext {
  /** Host client to tree-kill (null when nothing was spawned, e.g. provision failure). */
  child: { pid?: number } | null;
  sbxBin: string;
  /** Null on non-sandbox runs (destroy step skipped). */
  sandboxName: string | null;
  repo: string;
  issueNumber: number;
  /** Null skips the lease half (defensive; mapped commands always carry one). */
  lease: LeaseLabels | null;
  spawnIso: string;
  /** 'finish' | 'failover' | 'watchdog' | 'provision' — kill/destroy log tag. */
  reason: string;
  /** Finish/provision release back to the trigger; failover/watchdog reset. */
  leaseAction: 'release' | 'reset';
  /** Watchdog threads its fire context into the park comment (no new comment). */
  destroyExtra?: string;
  state: TeardownState;
}

export interface TeardownDeps {
  kill: (child: { pid?: number } | null, reason: string) => boolean;
  destroy: (sbxBin: string, name: string) => DestroyResult;
  fence: (repo: string, issueNumber: number, spawnIso: string) => FenceState;
  release: (repo: string, issueNumber: number, lease: LeaseLabels, spawnIso: string, fence: FenceState) => LeaseResult;
  reset: (repo: string, issueNumber: number, fence: FenceState) => void;
  park: (repo: string, issueNumber: number, destroyed: DestroyResult, extra?: string) => void;
}

export interface TeardownOutcome {
  /** Null on non-sandbox runs (no destroy step). */
  destroyed: DestroyResult | null;
  /** True when destroy failed and the run parked at `question` (lease half suppressed). */
  parked: boolean;
  /** Null when the run parked before fencing. */
  fence: FenceState | null;
  /** Set only for `release` actions with a lease. */
  leaseResult: LeaseResult | null;
}

function asDestroyResult(value: unknown): DestroyResult {
  if (typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)['ok'] === 'boolean') {
    const record = value as Record<string, unknown>;
    return { ok: record['ok'] as boolean, output: typeof record['output'] === 'string' ? (record['output'] as string) : '' };
  }
  return { ok: false, output: 'destroy dep returned an unusable result (fail-closed)' };
}

/**
 * Canonical destroy-before-fence/lease teardown. Destroy failure parks at
 * `question` fail-closed and suppresses the lease half (a blind reset would
 * re-queue a duplicate run behind the orphan). Never throws.
 */
export function teardownRun(ctx: TeardownContext, deps: TeardownDeps): TeardownOutcome {
  const { repo, issueNumber } = ctx;
  try {
    deps.kill(ctx.child, ctx.reason);
  } catch {
    // Best-effort: a failed kill still proceeds to destroy (the sandbox
    // itself is the reliable kill for in-VM workers).
  }
  if (ctx.sandboxName !== null) {
    if (ctx.state.sandboxGone === null) {
      let destroyed: DestroyResult;
      try {
        destroyed = asDestroyResult(deps.destroy(ctx.sbxBin, ctx.sandboxName));
      } catch (err) {
        destroyed = { ok: false, output: `destroy threw: ${(err as Error).message ?? String(err)}` };
      }
      ctx.state.sandboxGone = destroyed;
      console.log(`[agent-daemon] run #${issueNumber} sandbox destroy (${ctx.reason}) ok=${destroyed.ok}\n${destroyed.output}`);
    }
    const destroyed = ctx.state.sandboxGone;
    if (!destroyed.ok) {
      if (!ctx.state.destroyParked) {
        ctx.state.destroyParked = true;
        console.error(
          `[agent-daemon] run #${issueNumber} sandbox destroy failed; parking at question (fail-closed, may need manual reset to \`ready to implement\` after confirming the sandbox is gone via \`sbx ls\`)`,
        );
        try {
          deps.park(repo, issueNumber, destroyed, ctx.destroyExtra);
        } catch {
          // Best-effort: the park comment/label move already logs internally.
        }
      }
      return { destroyed, parked: true, fence: null, leaseResult: null };
    }
  }
  let fence: FenceState;
  try {
    fence = deps.fence(repo, issueNumber, ctx.spawnIso);
  } catch {
    // Fencing data unavailable: fail closed (do not reset/release blind).
    fence = { labels: [], terminalCommentSince: true };
  }
  if (ctx.lease === null) {
    return { destroyed: ctx.state.sandboxGone, parked: false, fence, leaseResult: null };
  }
  if (ctx.leaseAction === 'release') {
    let leaseResult: LeaseResult;
    try {
      leaseResult = deps.release(repo, issueNumber, ctx.lease, ctx.spawnIso, fence);
    } catch {
      leaseResult = 'failed';
    }
    return { destroyed: ctx.state.sandboxGone, parked: false, fence, leaseResult };
  }
  try {
    deps.reset(repo, issueNumber, fence);
  } catch {
    // Best-effort: reset already logs internally.
  }
  return { destroyed: ctx.state.sandboxGone, parked: false, fence, leaseResult: null };
}
