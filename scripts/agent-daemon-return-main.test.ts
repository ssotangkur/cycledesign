import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideReturnToMain, tryReturnToMain, type GitRunner } from './agent-daemon-return-main.js';

function stubRunner(map: Record<string, { ok: boolean; stdout?: string; stderr?: string; error?: string }>, seen: string[][] = []): GitRunner {
  return (args: string[]) => {
    seen.push(args);
    const key = args.join(' ');
    const entry = map[key];
    if (!entry) {
      throw new Error(`unexpected git call: ${key}`);
    }
    return { ok: entry.ok, stdout: entry.stdout ?? '', stderr: entry.stderr ?? '', error: entry.error };
  };
}

describe('decideReturnToMain pure table', () => {
  it('already on main regardless of porcelain', () => {
    assert.equal(decideReturnToMain('main', ''), 'already-on-main');
    assert.equal(decideReturnToMain('main', ' M dirty'), 'already-on-main');
  });

  it('detached HEAD stays', () => {
    assert.equal(decideReturnToMain('HEAD', ''), 'skip-detached');
    assert.equal(decideReturnToMain('', ''), 'skip-detached');
  });

  it('dirty tree stays', () => {
    assert.equal(decideReturnToMain('issue/120/foo', ' M file.ts'), 'skipped-dirty');
    assert.equal(decideReturnToMain('issue/120/foo', '?? untracked.log'), 'skipped-dirty');
  });

  it('clean off-main branch is returnable', () => {
    assert.equal(decideReturnToMain('issue/120/foo', ''), 'returnable');
    assert.equal(decideReturnToMain('issue/120/foo', '   \n'), 'returnable');
  });
});

describe('tryReturnToMain wrapper with stub runner', () => {
  it('returns already-on-main without checkout', () => {
    const seen: string[][] = [];
    const runner = stubRunner({ 'rev-parse --abbrev-ref HEAD': { ok: true, stdout: 'main' } }, seen);
    const res = tryReturnToMain(false, runner);
    assert.equal(res.action, 'already-on-main');
    assert.ok(!seen.some((a) => a[0] === 'checkout'), 'must not checkout when already on main');
  });

  it('checkouts on clean stranded branch', () => {
    const seen: string[][] = [];
    const runner = stubRunner(
      {
        'rev-parse --abbrev-ref HEAD': { ok: true, stdout: 'issue/120/foo' },
        'rev-parse --verify refs/heads/main': { ok: true, stdout: 'abc123' },
        'status --porcelain': { ok: true, stdout: '' },
        'checkout main': { ok: true, stdout: '' },
      },
      seen,
    );
    const res = tryReturnToMain(false, runner);
    assert.equal(res.action, 'returned-to-main');
    assert.ok(seen.some((a) => a.join(' ') === 'checkout main'));
  });

  it('skips dirty tree without checkout', () => {
    const seen: string[][] = [];
    const runner = stubRunner(
      {
        'rev-parse --abbrev-ref HEAD': { ok: true, stdout: 'issue/120/foo' },
        'rev-parse --verify refs/heads/main': { ok: true, stdout: 'abc123' },
        'status --porcelain': { ok: true, stdout: ' M file.ts' },
      },
      seen,
    );
    const res = tryReturnToMain(false, runner);
    assert.equal(res.action, 'skipped-dirty');
    assert.ok(!seen.some((a) => a[0] === 'checkout'));
  });

  it('reports worktree-held main as checkout-failed with tail, never throws', () => {
    const seen: string[][] = [];
    const runner = stubRunner(
      {
        'rev-parse --abbrev-ref HEAD': { ok: true, stdout: 'issue/120/foo' },
        'rev-parse --verify refs/heads/main': { ok: true, stdout: 'abc123' },
        'status --porcelain': { ok: true, stdout: '' },
        'checkout main': { ok: false, stdout: '', stderr: "fatal: 'main' is already used by worktree at '/tmp/other'" },
      },
      seen,
    );
    const res = tryReturnToMain(false, runner);
    assert.equal(res.action, 'checkout-failed');
    assert.match(res.reason ?? '', /already used by worktree/);
  });

  it('reports no-local-main without checkout', () => {
    const seen: string[][] = [];
    const runner = stubRunner(
      {
        'rev-parse --abbrev-ref HEAD': { ok: true, stdout: 'issue/120/foo' },
        'rev-parse --verify refs/heads/main': { ok: false, stdout: '', stderr: 'fatal: Needed a single revision' },
      },
      seen,
    );
    const res = tryReturnToMain(false, runner);
    assert.equal(res.action, 'no-local-main');
    assert.ok(!seen.some((a) => a[0] === 'checkout'));
  });

  it('skips detached HEAD without checkout', () => {
    const seen: string[][] = [];
    const runner = stubRunner({ 'rev-parse --abbrev-ref HEAD': { ok: true, stdout: 'HEAD' } }, seen);
    const res = tryReturnToMain(false, runner);
    assert.equal(res.action, 'skip-detached');
    assert.ok(!seen.some((a) => a[0] === 'checkout'));
  });

  it('throwing runner becomes checkout-failed, never throws', () => {
    const runner: GitRunner = () => {
      throw new Error('spawn boom');
    };
    const res = tryReturnToMain(false, runner);
    assert.equal(res.action, 'checkout-failed');
  });

  it('dry-run never invokes checkout', () => {
    const seen: string[][] = [];
    const runner = stubRunner(
      {
        'rev-parse --abbrev-ref HEAD': { ok: true, stdout: 'issue/120/foo' },
        'rev-parse --verify refs/heads/main': { ok: true, stdout: 'abc123' },
        'status --porcelain': { ok: true, stdout: '' },
      },
      seen,
    );
    const res = tryReturnToMain(true, runner);
    assert.equal(res.action, 'dry-run');
    assert.ok(!seen.some((a) => a[0] === 'checkout'), 'dry-run must never checkout');
  });
});
