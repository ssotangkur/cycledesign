import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTeardownState,
  teardownRun,
  type DestroyResult,
  type FenceState,
  type TeardownContext,
  type TeardownDeps,
} from './agent-daemon-teardown.js';

function baseCtx(overrides: Partial<TeardownContext> = {}): TeardownContext {
  return {
    child: { pid: 1234 },
    sbxBin: 'sbx',
    sandboxName: 'cycledesign-issue-9',
    repo: 'owner/repo',
    issueNumber: 9,
    lease: { trigger: 'ready to implement', inProgress: 'implementing' },
    spawnIso: '2026-09-11T00:00:00.000Z',
    reason: 'finish',
    leaseAction: 'release',
    state: createTeardownState(),
    ...overrides,
  };
}

function baseDeps(overrides: Partial<TeardownDeps> = {}): TeardownDeps & { calls: string[] } {
  const calls: string[] = [];
  const deps = {
    calls,
    kill: () => {
      calls.push('kill');
      return true;
    },
    destroy: () => {
      calls.push('destroy');
      return { ok: true, output: 'gone' };
    },
    fence: (): FenceState => {
      calls.push('fence');
      return { labels: ['implementing'], terminalCommentSince: false };
    },
    release: () => {
      calls.push('release');
      return 'released' as const;
    },
    reset: () => {
      calls.push('reset');
    },
    park: () => {
      calls.push('park');
    },
  };
  return { ...deps, ...overrides };
}

describe('teardownRun ordering (#159 KD-2)', () => {
  it('destroys before fencing/releasing on success', () => {
    const deps = baseDeps();
    const out = teardownRun(baseCtx(), deps);
    assert.deepEqual(deps.calls, ['kill', 'destroy', 'fence', 'release']);
    assert.equal(out.parked, false);
    assert.equal(out.leaseResult, 'released');
    assert.deepEqual(out.destroyed, { ok: true, output: 'gone' });
  });

  it('destroy failure parks once and suppresses the lease half', () => {
    const bad: DestroyResult = { ok: false, output: 'boom' };
    const deps = baseDeps();
    deps.destroy = () => {
      deps.calls.push('destroy');
      return { ...bad };
    };
    const ctx = baseCtx();
    const first = teardownRun(ctx, deps);
    assert.equal(first.parked, true);
    assert.equal(first.fence, null);
    assert.equal(first.leaseResult, null);
    assert.deepEqual(deps.calls, ['kill', 'destroy', 'park']);
    // Second call reuses the once-cache and once-flag: no second destroy/park.
    const second = teardownRun(ctx, deps);
    assert.equal(second.parked, true);
    assert.deepEqual(
      deps.calls,
      ['kill', 'destroy', 'park', 'kill'],
      'cached destroy + flagged park are not repeated',
    );
  });

  it('non-sandbox runs skip destroy and still fence/release', () => {
    const deps = baseDeps();
    const out = teardownRun(baseCtx({ sandboxName: null }), deps);
    assert.deepEqual(deps.calls, ['kill', 'fence', 'release']);
    assert.equal(out.destroyed, null);
    assert.equal(out.parked, false);
  });

  it('reset action calls reset with the fresh fence instead of releasing', () => {
    let seen: FenceState | null = null;
    const deps = baseDeps();
    deps.reset = (_repo, _issue, fence) => {
      deps.calls.push('reset');
      seen = fence;
    };
    const out = teardownRun(baseCtx({ leaseAction: 'reset' }), deps);
    assert.deepEqual(deps.calls, ['kill', 'destroy', 'fence', 'reset']);
    assert.deepEqual(seen, { labels: ['implementing'], terminalCommentSince: false });
    assert.equal(out.leaseResult, null);
  });

  it('a throwing destroy fails closed (park, no release)', () => {
    const deps = baseDeps({
      destroy: () => {
        throw new Error('sbx exploded');
      },
    });
    const out = teardownRun(baseCtx(), deps);
    assert.equal(out.parked, true);
    assert.equal(out.destroyed?.ok, false);
    assert.ok(deps.calls.includes('park'));
    assert.ok(!deps.calls.includes('release'));
  });

  it('a throwing fence fails closed (release sees an unknown fence)', () => {
    let seen: FenceState | null = null;
    const deps = baseDeps({
      fence: (): FenceState => {
        throw new Error('gh down');
      },
      release: (_r, _i, _l, _s, fence) => {
        seen = fence;
        return 'suppressed';
      },
    });
    const out = teardownRun(baseCtx(), deps);
    assert.equal(out.parked, false);
    assert.deepEqual(seen, { labels: [], terminalCommentSince: true });
    assert.equal(out.leaseResult, 'suppressed');
  });
});
