import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { treeKill } from './agent-tree-kill.js';

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
