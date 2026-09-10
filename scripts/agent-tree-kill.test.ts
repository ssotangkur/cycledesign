import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { treeKill, treeKillVerified } from './agent-tree-kill.js';

describe('treeKill', () => {
  let origPlatform: NodeJS.Platform;
  let origKill: typeof process.kill;

  beforeEach(() => {
    origPlatform = process.platform;
    origKill = process.kill;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform });
    process.kill = origKill;
  });

  it('no-ops on null/undefined child', () => {
    assert.doesNotThrow(() => treeKill(null));
    assert.doesNotThrow(() => treeKill(undefined));
  });

  it('no-ops on undefined pid', () => {
    assert.doesNotThrow(() => treeKill({ pid: undefined }));
  });

  it('posix: falls back to single-pid kill when group kill throws', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    let singleKilled: string | undefined;
    const child = {
      pid: 1234,
      kill: (signal: string): boolean => {
        singleKilled = signal;
        return true;
      },
    };
    process.kill = ((pid: number) => {
      assert.equal(pid, -1234);
      throw new Error('no such group');
    }) as typeof process.kill;
    assert.doesNotThrow(() => treeKill(child as unknown as Parameters<typeof treeKill>[0]));
    assert.equal(singleKilled, 'SIGKILL');
  });

  it('posix: never throws when every kill fails', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.kill = (() => {
      throw new Error('gone');
    }) as typeof process.kill;
    const child = {
      pid: 9999,
      kill: (): boolean => {
        throw new Error('gone');
      },
    };
    assert.doesNotThrow(() => treeKill(child as unknown as Parameters<typeof treeKill>[0]));
  });

  it('win32: routes through taskkill without throwing', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    // taskkill may not exist on this host; treeKill is best-effort and must not throw.
    assert.doesNotThrow(() => treeKill({ pid: 1 }));
  });
});

describe('treeKillVerified (#149 KD-5)', () => {
  it('returns true for null/undefined/missing pid', () => {
    assert.equal(treeKillVerified(null), true);
    assert.equal(treeKillVerified(undefined), true);
    assert.equal(treeKillVerified({ pid: undefined }), true);
  });

  it('returns true when the pid is already dead', () => {
    assert.equal(treeKillVerified({ pid: 1234 }, { isAlive: () => false, sleepSync: () => {} }), true);
  });

  it('retries until the verify passes', () => {
    let probes = 0;
    let sleeps = 0;
    const dead = treeKillVerified(
      { pid: 4242, kill: () => true },
      {
        // posix path only; on win32 taskkill decides. Force the posix branch
        // shape by probing liveness across attempts.
        isAlive: () => ++probes < 3,
        retries: 3,
        sleepSync: () => {
          sleeps += 1;
        },
      },
    );
    assert.equal(dead, true);
    assert.equal(probes, 3);
    assert.equal(sleeps, 2);
  });

  it('returns false when the pid survives every round', () => {
    const dead = treeKillVerified({ pid: 9999, kill: () => true }, { isAlive: () => true, retries: 1, sleepSync: () => {} });
    assert.equal(dead, false);
  });

  it('never throws when every kill fails', () => {
    assert.doesNotThrow(() =>
      treeKillVerified(
        {
          pid: 9999,
          kill: (): boolean => {
            throw new Error('gone');
          },
        },
        { isAlive: () => true, retries: 0, sleepSync: () => {} },
      ),
    );
  });
});
