import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetMirrorCacheForTests,
  __setGhRunnerForTests,
  MIRROR_COOLDOWN_MS,
  checkProjectRead,
  classifyMirrorFailure,
  getLastMirrorFailure,
  labelToStatus,
  setProjectStatus,
  setProjectStatusDetailed,
  syncStatusForLabel,
  syncStatusForLabelDetailed,
  type GhRunner,
} from './agent-project.js';

describe('label to Status mapping', () => {
  it('maps the planning pipeline labels', () => {
    assert.equal(labelToStatus('ready to plan'), 'Ready to plan');
    assert.equal(labelToStatus('planning'), 'Planning');
    assert.equal(labelToStatus('ready to implement'), 'Ready to implement');
    assert.equal(labelToStatus('implementing'), 'Implementing');
    assert.equal(labelToStatus('pr ready'), 'PR ready');
  });

  it('maps question to Blocked', () => {
    assert.equal(labelToStatus('question'), 'Blocked');
  });

  it('returns null for board-managed states without a label twin', () => {
    assert.equal(labelToStatus('triage'), null);
    assert.equal(labelToStatus('done'), null);
    assert.equal(labelToStatus('unknown'), null);
  });
});

describe('project sync degrades without project access', () => {
  it('sync skips labels with no Status twin instead of calling gh', () => {
    assert.equal(syncStatusForLabel('no-owner/no-repo-xyz', 1, 'triage'), 'skipped');
  });

  it('set reports failure against a bogus owner instead of throwing', () => {
    // PROJECT_OWNER env override points at a bogus owner for this check.
    process.env['PROJECT_OWNER'] = 'no-such-owner-xyz';
    assert.equal(setProjectStatus('no-owner/no-repo-xyz', 1, 'Planning'), 'failed');
    delete process.env['PROJECT_OWNER'];
  });

  it('sync reports failure instead of throwing when gh cannot resolve', () => {
    process.env['PROJECT_OWNER'] = 'no-such-owner-xyz';
    assert.equal(syncStatusForLabel('no-owner/no-repo-xyz', 1, 'planning'), 'failed');
    delete process.env['PROJECT_OWNER'];
  });
});

describe('mirror failure taxonomy (#140 KD-3)', () => {
  it('classifies missing-scope/auth stderr as auth (captured sample, not just bogus-owner)', () => {
    assert.equal(classifyMirrorFailure('HTTP 403: Resource not accessible by integration (missing project scope)'), 'auth');
    assert.equal(classifyMirrorFailure('Bad credentials (HTTP 401)'), 'auth');
    assert.equal(classifyMirrorFailure('unknown owner type for no-such-owner-xyz'), 'auth');
    assert.equal(classifyMirrorFailure("Your token has not been granted the required scopes to execute this query. Requires 'project' scope."), 'auth');
  });

  it('classifies network/rate-limit stderr as transport with no immediate retry', () => {
    assert.equal(classifyMirrorFailure('request timed out after 10s (ECONNRESET)'), 'transport');
    assert.equal(classifyMirrorFailure('getaddrinfo EAI_AGAIN api.github.com'), 'transport');
    assert.equal(classifyMirrorFailure('HTTP 429: You have exceeded a secondary rate limit. Retry-After: 60'), 'transport');
    assert.equal(classifyMirrorFailure('HTTP 503: Service Unavailable'), 'transport');
  });

  it('classifies operator/config stderr as config (never retried)', () => {
    assert.equal(classifyMirrorFailure('Status field/option not found for "Planning"'), 'config');
    assert.equal(classifyMirrorFailure('unparseable field-list JSON: Unexpected token < in JSON'), 'config');
    assert.equal(classifyMirrorFailure('item-list JSON schema mismatch: missing items array'), 'config');
    assert.equal(classifyMirrorFailure(''), 'config');
  });

  it('detailed path carries step|kind|stderr on failure (bogus owner)', () => {
    process.env['PROJECT_OWNER'] = 'no-such-owner-xyz';
    try {
      const detail = setProjectStatusDetailed('no-owner/no-repo-xyz', 1, 'Planning');
      assert.equal(detail.result, 'failed');
      assert.ok(detail.step.length > 0);
      assert.equal(detail.kind, 'auth');
      assert.ok(detail.stderr.length > 0);
      assert.deepEqual(getLastMirrorFailure(), detail);
    } finally {
      delete process.env['PROJECT_OWNER'];
    }
  });

  it('read-only probe fails against a bogus owner instead of throwing', () => {
    process.env['PROJECT_OWNER'] = 'no-such-owner-xyz';
    try {
      const check = checkProjectRead();
      assert.equal(check.ok, false);
      assert.ok(check.step.length > 0);
      assert.ok(check.stderr.length > 0);
    } finally {
      delete process.env['PROJECT_OWNER'];
    }
  });
});

describe('project mirror cache + backoff (#157)', () => {
  const VIEW_STDOUT = JSON.stringify({ id: 'PVT_1' });
  const FIELDS_DEFAULT = JSON.stringify({
    fields: [
      {
        id: 'F_1',
        name: 'Status',
        options: [
          { id: 'O_ready', name: 'Ready to plan' },
          { id: 'O_planning', name: 'Planning' },
          { id: 'O_impl', name: 'Implementing' },
        ],
      },
    ],
  });
  const ITEMS_TWO = JSON.stringify({
    items: [
      { id: 'ITEM_1', content: { number: 1, repository: 'o/r' } },
      { id: 'ITEM_2', content: { number: 2, repository: 'o/r' } },
    ],
  });

  const realNow = Date.now;

  beforeEach(() => {
    __resetMirrorCacheForTests();
    __setGhRunnerForTests(null);
    delete process.env['PROJECT_OWNER'];
    delete process.env['PROJECT_NUMBER'];
    Date.now = realNow;
  });

  afterEach(() => {
    __setGhRunnerForTests(null);
    __resetMirrorCacheForTests();
    delete process.env['PROJECT_OWNER'];
    delete process.env['PROJECT_NUMBER'];
    Date.now = realNow;
  });

  function makeRunner(opts?: {
    fieldListStdout?: string | (() => string);
    itemListStdout?: string;
    onCall?: (step: string, args: string[]) => { ok: boolean; stdout: string; stderr: string; kind: 'auth' | 'transport' | 'config' } | null;
  }): { calls: Array<{ step: string; args: string[] }>; runner: GhRunner } {
    const calls: Array<{ step: string; args: string[] }> = [];
    const runner: GhRunner = (args, step) => {
      calls.push({ step, args: [...args] });
      const override = opts?.onCall?.(step, args);
      if (override) {
        return override;
      }
      if (args[0] === 'project' && args[1] === 'view') {
        return { ok: true, stdout: VIEW_STDOUT, stderr: '', kind: 'config' };
      }
      if (args[0] === 'project' && args[1] === 'field-list') {
        const stdout = typeof opts?.fieldListStdout === 'function' ? (opts.fieldListStdout as () => string)() : (opts?.fieldListStdout ?? FIELDS_DEFAULT);
        return { ok: true, stdout, stderr: '', kind: 'config' };
      }
      if (args[0] === 'project' && args[1] === 'item-list') {
        return { ok: true, stdout: opts?.itemListStdout ?? ITEMS_TWO, stderr: '', kind: 'config' };
      }
      return { ok: true, stdout: '{}', stderr: '', kind: 'config' };
    };
    return { calls, runner };
  }

  function countBy(calls: Array<{ step: string }>, step: string): number {
    return calls.filter((c) => c.step === step).length;
  }

  it('(a) resolution called once across N syncs — warm same-issue different-status is mutation-only', () => {
    const { calls, runner } = makeRunner();
    __setGhRunnerForTests(runner);
    const first = setProjectStatusDetailed('o/r', 1, 'Planning');
    assert.equal(first.result, 'synced');
    assert.equal(calls.length, 4);
    assert.equal(countBy(calls, 'project view'), 1);
    assert.equal(countBy(calls, 'project field-list'), 1);
    assert.equal(countBy(calls, 'project item-list'), 1);
    assert.equal(countBy(calls, 'api graphql'), 1);
    calls.length = 0;
    const second = setProjectStatusDetailed('o/r', 1, 'Implementing');
    assert.equal(second.result, 'synced');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.step, 'api graphql');
  });

  it('(b) backoff suppresses gh during cooldown and resumes after', () => {
    let now = realNow();
    Date.now = () => now;
    let viewCalls = 0;
    const { calls, runner } = makeRunner({
      onCall: (step) => {
        if (step === 'project view') {
          viewCalls += 1;
          if (viewCalls === 1) {
            return { ok: false, stdout: '', stderr: 'HTTP 429: You have exceeded a secondary rate limit. Retry-After: 60', kind: 'transport' };
          }
        }
        return null;
      },
    });
    __setGhRunnerForTests(runner);
    try {
      const failed = setProjectStatusDetailed('o/r', 1, 'Planning');
      assert.equal(failed.result, 'failed');
      assert.equal(failed.kind, 'transport');
      const callsAfterFail = calls.length;
      assert.ok(callsAfterFail >= 1);
      const suppressed = syncStatusForLabelDetailed('o/r', 1, 'planning');
      assert.equal(suppressed.result, 'skipped');
      assert.equal(suppressed.step, 'backoff-cooldown');
      assert.equal(calls.length, callsAfterFail);
      now += MIRROR_COOLDOWN_MS + 1000;
      const resumed = setProjectStatusDetailed('o/r', 1, 'Planning');
      assert.equal(resumed.result, 'synced');
      assert.ok(calls.length > callsAfterFail);
    } finally {
      Date.now = realNow;
    }
  });

  it('(c) cache keyed per owner/project/issue', () => {
    const { calls, runner } = makeRunner();
    __setGhRunnerForTests(runner);
    process.env['PROJECT_OWNER'] = 'owner-a';
    assert.equal(setProjectStatusDetailed('o/r', 1, 'Planning').result, 'synced');
    assert.equal(countBy(calls, 'project view'), 1);
    process.env['PROJECT_OWNER'] = 'owner-b';
    assert.equal(setProjectStatusDetailed('o/r', 1, 'Planning').result, 'synced');
    assert.equal(countBy(calls, 'project view'), 2);
    assert.equal(countBy(calls, 'project item-list'), 2);
  });

  it('(d) miss-not-cached: skipped re-issues item-list', () => {
    const { calls, runner } = makeRunner({ itemListStdout: JSON.stringify({ items: [] }) });
    __setGhRunnerForTests(runner);
    const first = setProjectStatusDetailed('o/r', 99, 'Planning');
    assert.equal(first.result, 'skipped');
    assert.equal(first.step, 'item-resolve');
    assert.equal(countBy(calls, 'project item-list'), 1);
    assert.equal(countBy(calls, 'api graphql'), 0);
    const second = setProjectStatusDetailed('o/r', 99, 'Planning');
    assert.equal(second.result, 'skipped');
    assert.equal(countBy(calls, 'project item-list'), 2);
    assert.equal(countBy(calls, 'api graphql'), 0);
  });

  it('(e) no-op skip issues zero gh on repeat same status', () => {
    const { calls, runner } = makeRunner();
    __setGhRunnerForTests(runner);
    assert.equal(setProjectStatusDetailed('o/r', 1, 'Planning').result, 'synced');
    assert.equal(calls.length, 4);
    calls.length = 0;
    const noop = setProjectStatusDetailed('o/r', 1, 'Planning');
    assert.equal(noop.result, 'synced');
    assert.equal(noop.step, 'cached-noop');
    assert.equal(calls.length, 0);
  });

  it('(e2) cooldown-first precedence over no-op skip', () => {
    let graphqlCalls = 0;
    const { calls, runner } = makeRunner({
      onCall: (step) => {
        if (step === 'api graphql') {
          graphqlCalls += 1;
          if (graphqlCalls === 2) {
            return { ok: false, stdout: '', stderr: 'HTTP 429: secondary rate limit exceeded', kind: 'transport' };
          }
        }
        return null;
      },
    });
    __setGhRunnerForTests(runner);
    assert.equal(setProjectStatusDetailed('o/r', 1, 'Planning').result, 'synced');
    // Different status on same issue bypasses no-op, hits transport failure, arms cooldown.
    const failed = setProjectStatusDetailed('o/r', 1, 'Implementing');
    assert.equal(failed.result, 'failed');
    assert.equal(failed.kind, 'transport');
    const callsAfterFail = calls.length;
    // Same-status repeat must read as backoff cooldown, never cached-noop, without gh.
    const cooled = setProjectStatusDetailed('o/r', 1, 'Planning');
    assert.equal(cooled.result, 'skipped');
    assert.equal(cooled.step, 'backoff-cooldown');
    assert.equal(calls.length, callsAfterFail);
  });

  it('(f) option-miss refreshes field-list once and self-heals', () => {
    const limited = JSON.stringify({ fields: [{ id: 'F_1', name: 'Status', options: [{ id: 'O_planning', name: 'Planning' }] }] });
    let fieldCalls = 0;
    const { calls, runner } = makeRunner({
      onCall: (step) => {
        if (step === 'project field-list') {
          fieldCalls += 1;
          if (fieldCalls === 1) {
            return { ok: true, stdout: limited, stderr: '', kind: 'config' };
          }
        }
        return null;
      },
    });
    __setGhRunnerForTests(runner);
    assert.equal(setProjectStatusDetailed('o/r', 1, 'Planning').result, 'synced');
    assert.equal(countBy(calls, 'project field-list'), 1);
    const healed = setProjectStatusDetailed('o/r', 1, 'Implementing');
    assert.equal(healed.result, 'synced');
    assert.equal(countBy(calls, 'project field-list'), 2);
  });

  it('(f2a) graphql config failure evicts cached itemId', () => {
    let graphqlCalls = 0;
    const { calls, runner } = makeRunner({
      onCall: (step) => {
        if (step === 'api graphql') {
          graphqlCalls += 1;
          if (graphqlCalls === 1) {
            return { ok: false, stdout: '', stderr: 'Could not resolve to an node with the global id', kind: 'config' };
          }
        }
        return null;
      },
    });
    __setGhRunnerForTests(runner);
    const failed = setProjectStatusDetailed('o/r', 1, 'Planning');
    assert.equal(failed.result, 'failed');
    assert.equal(countBy(calls, 'project item-list'), 1);
    const retry = setProjectStatusDetailed('o/r', 1, 'Planning');
    assert.equal(retry.result, 'synced');
    assert.equal(countBy(calls, 'project item-list'), 2);
  });

  it('(f2b) graphql transport failure keeps cached itemId', () => {
    let now = realNow();
    Date.now = () => now;
    let graphqlCalls = 0;
    const { calls, runner } = makeRunner({
      onCall: (step) => {
        if (step === 'api graphql') {
          graphqlCalls += 1;
          if (graphqlCalls === 1) {
            return { ok: false, stdout: '', stderr: 'HTTP 429: secondary rate limit exceeded', kind: 'transport' };
          }
        }
        return null;
      },
    });
    __setGhRunnerForTests(runner);
    try {
      assert.equal(setProjectStatusDetailed('o/r', 1, 'Planning').result, 'failed');
      assert.equal(countBy(calls, 'project item-list'), 1);
      now += MIRROR_COOLDOWN_MS + 1000;
      const recovered = setProjectStatusDetailed('o/r', 1, 'Planning');
      assert.equal(recovered.result, 'synced');
      assert.equal(countBy(calls, 'project item-list'), 1);
      assert.equal(countBy(calls, 'api graphql'), 2);
    } finally {
      Date.now = realNow;
    }
  });

  it('(g) 403+secondary-rate-limit classifies as transport, pure 403 stays auth', () => {
    assert.equal(classifyMirrorFailure('HTTP 403: secondary rate limit exceeded for installation'), 'transport');
    assert.equal(classifyMirrorFailure('HTTP 403: Resource not accessible by integration (missing project scope)'), 'auth');
  });

  it('(h) cooldown quiet path does not overwrite lastMirrorFailure', () => {
    const { calls, runner } = makeRunner({
      onCall: (step) => {
        if (step === 'project view') {
          return { ok: false, stdout: '', stderr: 'HTTP 429: secondary rate limit exceeded', kind: 'transport' };
        }
        return null;
      },
    });
    __setGhRunnerForTests(runner);
    const failed = setProjectStatusDetailed('o/r', 1, 'Planning');
    assert.equal(failed.result, 'failed');
    const arming = getLastMirrorFailure();
    assert.ok(arming);
    assert.equal(arming?.kind, 'transport');
    const before = calls.length;
    const cooled = setProjectStatusDetailed('o/r', 2, 'Planning');
    assert.equal(cooled.result, 'skipped');
    assert.equal(cooled.step, 'backoff-cooldown');
    assert.equal(calls.length, before);
    assert.deepEqual(getLastMirrorFailure(), arming);
  });

  it('(i) preflight shares cache/backoff cooldown-first even on cache hit', () => {
    const { calls, runner } = makeRunner();
    __setGhRunnerForTests(runner);
    assert.equal(setProjectStatusDetailed('o/r', 1, 'Planning').result, 'synced');
    calls.length = 0;
    const hit = checkProjectRead();
    assert.equal(hit.ok, true);
    assert.equal(calls.length, 0);
    // Arm cooldown via a transport graphql failure on another issue (keeps resolution cache warm).
    let graphqlCalls = 0;
    const { calls: calls2, runner: runner2 } = makeRunner({
      onCall: (step) => {
        if (step === 'api graphql') {
          graphqlCalls += 1;
          return { ok: false, stdout: '', stderr: 'HTTP 429: secondary rate limit exceeded', kind: 'transport' };
        }
        return null;
      },
    });
    // Reuse warm resolution+item for issue 1 would no-op; use issue 2 (item miss → graphql transport).
    __setGhRunnerForTests(runner2);
    const failed = setProjectStatusDetailed('o/r', 2, 'Planning');
    assert.equal(failed.result, 'failed');
    const preCalls = calls2.length;
    const cooled = checkProjectRead();
    assert.equal(cooled.ok, false);
    assert.equal(cooled.step, 'backoff-cooldown');
    assert.equal(calls2.length, preCalls);
    void calls;
  });

  it('label-resolve no-twin bypasses backoff', () => {
    const { calls, runner } = makeRunner({
      onCall: (step) => {
        if (step === 'project view') {
          return { ok: false, stdout: '', stderr: 'HTTP 429: secondary rate limit exceeded', kind: 'transport' };
        }
        return null;
      },
    });
    __setGhRunnerForTests(runner);
    assert.equal(setProjectStatusDetailed('o/r', 1, 'Planning').result, 'failed');
    const bypass = syncStatusForLabelDetailed('o/r', 1, 'triage');
    assert.equal(bypass.result, 'skipped');
    assert.equal(bypass.step, 'label-resolve');
  });
});
