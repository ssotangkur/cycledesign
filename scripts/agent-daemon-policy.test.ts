import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FAILOVERS_PER_ISSUE,
  applyProbeResult,
  createProbeTracker,
  exitDetailFor,
  failoverSteps,
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
  type LivenessSnapshot,
} from './agent-daemon-policy.js';

describe('failover ordering + circuit breaker', () => {
  it('orders kill before fence before reset before respawn', () => {
    assert.deepEqual(failoverSteps(false), ['tree-kill', 'fencing-check', 'label-reset', 'respawn-on-go']);
  });

  it('parks at question instead of respawning when exhausted', () => {
    assert.deepEqual(failoverSteps(true), ['tree-kill', 'fencing-check', 'park-at-question']);
  });

  it(`allows ${MAX_FAILOVERS_PER_ISSUE} failovers per issue then parks`, () => {
    const counts = new Map<number, number>();
    for (let i = 1; i <= MAX_FAILOVERS_PER_ISSUE; i++) {
      const result = recordFailover(counts, 107);
      assert.equal(result.count, i);
      assert.equal(result.allowed, true);
    }
    const exhausted = recordFailover(counts, 107);
    assert.equal(exhausted.count, MAX_FAILOVERS_PER_ISSUE + 1);
    assert.equal(exhausted.allowed, false);
  });

  it('tracks failovers per issue independently', () => {
    const counts = new Map<number, number>();
    recordFailover(counts, 1);
    recordFailover(counts, 1);
    const other = recordFailover(counts, 2);
    assert.equal(other.count, 1);
    assert.equal(other.allowed, true);
  });
});

describe('watchdog predicate', () => {
  it('fires after a full silent interval', () => {
    assert.equal(shouldFireWatchdog(0, 900_000, 900_000), true);
    assert.equal(shouldFireWatchdog(0, 900_001, 900_000), true);
  });

  it('does not fire on recent activity', () => {
    assert.equal(shouldFireWatchdog(1000, 1500, 900_000), false);
  });

  it('fires without ever killing first (predicate is read-only)', () => {
    // Predicate returns a boolean only; killing happens after the bundle.
    const before = 0;
    const result = shouldFireWatchdog(before, before + 901_000, 900_000);
    assert.equal(result, true);
    assert.equal(before, 0);
  });
});

describe('probe state machine', () => {
  it('failover → probing → success → free → failover re-arms', () => {
    const tracker = createProbeTracker(0);
    assert.equal(shouldProbe(tracker, 900_000, 900_000, false), false);

    noteFailover(tracker, 1000);
    assert.equal(tracker.model, 'go');
    // Interval has not elapsed yet.
    assert.equal(shouldProbe(tracker, 2000, 900_000, false), false);
    // Run in flight blocks the probe (watchdog wins).
    assert.equal(shouldProbe(tracker, 901_001, 900_000, true), false);
    // At a run boundary after the interval, the probe fires.
    assert.equal(shouldProbe(tracker, 901_001, 900_000, false), true);

    applyProbeResult(tracker, 'success', 901_001);
    assert.equal(tracker.model, 'free');
    assert.equal(shouldProbe(tracker, 9_901_001, 900_000, false), false);

    // Next failover re-arms probing.
    noteFailover(tracker, 10_000_000);
    assert.equal(shouldProbe(tracker, 10_900_000, 900_000, false), true);
  });

  it('quota or inconclusive probes keep the timer running on Go', () => {
    const tracker = createProbeTracker(0);
    noteFailover(tracker, 0);
    applyProbeResult(tracker, 'quota', 900_000);
    assert.equal(tracker.model, 'go');
    assert.equal(shouldProbe(tracker, 1_800_000, 900_000, false), true);

    applyProbeResult(tracker, 'inconclusive', 1_800_000);
    assert.equal(tracker.model, 'go');
    assert.equal(shouldProbe(tracker, 2_700_000, 900_000, false), true);
  });
});

describe('watchdog liveness summary (#139)', () => {
  function snapshot(): LivenessSnapshot {
    return {
      startMs: 0,
      lastNonErrorAtMs: 0,
      lastChunkAtMs: 0,
      pendingBytes: 0,
      gatewayCount: 0,
      upstreamCount: 0,
      otherCount: 1,
      linesSeen: 1,
      lastErrorLine: null,
      lastLine: '{"type":"step_start"}',
    };
  }

  it('reports silence, timeout, elapsed, counts, and chunk age', () => {
    const text = livenessSummary(snapshot(), 900_000, 900_000);
    assert.match(text, /silent 900s \(timeout 900s\)/);
    assert.match(text, /run elapsed 900s/);
    assert.match(text, /lines=1 \(other=1, upstream-transient=0, gateway-quota=0\)/);
    assert.match(text, /last chunk 900s ago, pending 0B/);
    assert.match(text, /last non-error 1970-01-01T00:00:00\.000Z/);
  });

  it('clamps negative deltas to zero', () => {
    const snap = snapshot();
    snap.lastNonErrorAtMs = 2_000;
    assert.match(livenessSummary(snap, 1_000, 900_000), /silent 0s/);
  });
});

describe('exit detail (#139)', () => {
  it('returns null for clean exits', () => {
    assert.equal(exitDetailFor({ lastErrorLine: 'x', lastLine: 'y' }, 0, null), null);
  });

  it('prefers the last classified error line', () => {
    const detail = exitDetailFor({ lastErrorLine: '{"error":"Rate limit exceeded"}', lastLine: 'other' }, 1, null);
    assert.equal(detail, 'last error: {"error":"Rate limit exceeded"}');
  });

  it('falls back to the last raw line with code/signal', () => {
    const detail = exitDetailFor({ lastErrorLine: null, lastLine: '{"type":"step_start"}' }, 1, 'SIGTERM');
    assert.equal(detail, 'last line before exit(1/SIGTERM): {"type":"step_start"}');
  });

  it('falls back to code/signal with no stream output', () => {
    assert.equal(exitDetailFor({ lastErrorLine: null, lastLine: null }, null, 'SIGKILL'), 'exit(null/SIGKILL) with no stream output');
  });

  it('oneLine collapses whitespace and truncates', () => {
    assert.equal(oneLine('a\n  b\tc'), 'a b c');
    assert.equal(oneLine('x'.repeat(400), 300).length, 300);
  });
});

describe('heartbeat cadence (#139)', () => {
  it('is one third of the stuck window within 60s..300s bounds', () => {
    assert.equal(heartbeatIntervalMs(900_000), 300_000);
    assert.equal(heartbeatIntervalMs(360_000), 120_000);
  });

  it('clamps short windows up to 60s and long windows down to 300s', () => {
    assert.equal(heartbeatIntervalMs(90_000), 60_000);
    assert.equal(heartbeatIntervalMs(3_600_000), 300_000);
  });
});

describe('conjunctive watchdog (#149 KD-4/KD-7)', () => {
  const TIMEOUT = 900_000;
  const IDLE = 918_000; // #104 shape: silence past the timeout on every leg
  const LIVE = 30_000;

  it('#104-shape (stdout silent, VM alive) does not fire', () => {
    const decision = watchdogDecision({
      stdoutIdleMs: IDLE,
      vmLogIdleMs: LIVE,
      vmVcsIdleMs: IDLE,
      sessionLogIdleMs: IDLE,
      treeBusy: false,
      collectorOk: true,
      stuckTimeoutMs: TIMEOUT,
    });
    assert.equal(decision.fire, false);
    assert.ok(decision.suppressions.some((s) => s.startsWith('vm-log alive')));
  });

  it('truly idle on every leg fires', () => {
    const decision = watchdogDecision({
      stdoutIdleMs: IDLE,
      vmLogIdleMs: IDLE,
      vmVcsIdleMs: IDLE,
      sessionLogIdleMs: IDLE,
      treeBusy: false,
      collectorOk: true,
      stuckTimeoutMs: TIMEOUT,
    });
    assert.equal(decision.fire, true);
    assert.deepEqual(decision.suppressions, []);
  });

  it('collector error fail-closes to no-fire', () => {
    const decision = watchdogDecision({
      stdoutIdleMs: IDLE,
      vmLogIdleMs: IDLE,
      vmVcsIdleMs: IDLE,
      sessionLogIdleMs: IDLE,
      treeBusy: false,
      collectorOk: false,
      stuckTimeoutMs: TIMEOUT,
    });
    assert.equal(decision.fire, false);
    assert.deepEqual(decision.suppressions, ['collector-error: VM liveness unknown (fail-closed)']);
  });

  it('#109-shape (live but idle tree, all legs idle) fires', () => {
    const decision = watchdogDecision({
      stdoutIdleMs: IDLE,
      vmLogIdleMs: IDLE,
      vmVcsIdleMs: IDLE,
      sessionLogIdleMs: IDLE,
      treeBusy: false,
      collectorOk: true,
      stuckTimeoutMs: TIMEOUT,
    });
    assert.equal(decision.fire, true);
  });

  it('hot tree suppresses even when every leg is idle', () => {
    const decision = watchdogDecision({
      stdoutIdleMs: IDLE,
      vmLogIdleMs: IDLE,
      vmVcsIdleMs: IDLE,
      sessionLogIdleMs: IDLE,
      treeBusy: true,
      collectorOk: true,
      stuckTimeoutMs: TIMEOUT,
    });
    assert.equal(decision.fire, false);
    assert.ok(decision.suppressions.includes('worker-tree hot (recent spawn/churn)'));
  });

  it('recent stdout alone suppresses (byte age stays out of the predicate)', () => {
    const decision = watchdogDecision({
      stdoutIdleMs: LIVE,
      vmLogIdleMs: IDLE,
      vmVcsIdleMs: IDLE,
      sessionLogIdleMs: IDLE,
      treeBusy: false,
      collectorOk: true,
      stuckTimeoutMs: TIMEOUT,
    });
    assert.equal(decision.fire, false);
  });

  it('suppressionSummary renders fire vs suppressed', () => {
    assert.equal(suppressionSummary({ fire: true, suppressions: [] }), 'all legs idle (would fire)');
    assert.match(
      suppressionSummary({ fire: false, suppressions: ['collector-error: VM liveness unknown (fail-closed)'] }),
      /suppressed: collector-error/,
    );
  });
});

describe('tree busy-vote (#149 KD-4, no CPU)', () => {
  const TIMEOUT = 900_000;
  const NOW = 1_000_000_000;

  it('recent spawn is hot', () => {
    const { hot, reason } = isTreeHot([{ pid: 10, createdMs: NOW - 60_000 }], [10], NOW, TIMEOUT);
    assert.equal(hot, true);
    assert.match(reason, /spawned/);
  });

  it('pid churn since last poll is hot', () => {
    const old = NOW - TIMEOUT - 60_000;
    const { hot, reason } = isTreeHot(
      [
        { pid: 10, createdMs: old },
        { pid: 11, createdMs: old },
      ],
      [10],
      NOW,
      TIMEOUT,
    );
    assert.equal(hot, true);
    assert.match(reason, /churn/);
  });

  it('live-but-idle tree (#109) is neutral', () => {
    const old = NOW - TIMEOUT - 60_000;
    const { hot } = isTreeHot([{ pid: 10, createdMs: old }], [10], NOW, TIMEOUT);
    assert.equal(hot, false);
  });

  it('first poll with empty previous set is not hot-by-default', () => {
    const old = NOW - TIMEOUT - 60_000;
    const { hot } = isTreeHot([{ pid: 10, createdMs: old }], [], NOW, TIMEOUT);
    assert.equal(hot, false);
  });

  it('unknown creation dates never vote hot without churn', () => {
    const { hot } = isTreeHot([{ pid: 10, createdMs: null }], [10], NOW, TIMEOUT);
    assert.equal(hot, false);
  });
});
