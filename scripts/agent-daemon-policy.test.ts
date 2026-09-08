import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FAILOVERS_PER_ISSUE,
  applyProbeResult,
  createProbeTracker,
  failoverSteps,
  noteFailover,
  recordFailover,
  shouldFireWatchdog,
  shouldProbe,
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
