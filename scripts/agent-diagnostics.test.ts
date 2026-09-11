import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  branchState,
  buildWatchdogBundle,
  capture,
  childProcessTree,
  createStreamTracker,
  listProcessTree,
} from './agent-diagnostics.js';

describe('diagnostics captures (#159 KD-4)', () => {
  it('capture never throws and caps output', () => {
    assert.equal(capture('echo hello-diagnostics'), 'hello-diagnostics');
    assert.equal(capture('exit 3'), '(unavailable)');
    assert.equal(capture('node -e "process.stdout.write(\'x\'.repeat(9000))"').length, 4000);
  });

  it('childProcessTree handles a missing pid without shelling out', () => {
    assert.equal(childProcessTree(undefined), '(no child pid)');
  });

  it('listProcessTree handles a missing pid without shelling out', () => {
    assert.deepEqual(listProcessTree(undefined), []);
  });

  it('branchState reports the current branch', () => {
    const state = branchState();
    assert.ok(state.startsWith('branch: '));
  });

  it('buildWatchdogBundle renders a non-sandbox bundle without a VM', () => {
    const tracker = createStreamTracker(Date.now());
    const bundle = buildWatchdogBundle(9, tracker, undefined, 600_000);
    assert.ok(bundle.includes('### What happened'));
    assert.ok(bundle.includes('(non-sandbox run, no VM to destroy)'));
    assert.ok(bundle.includes('(no VM evidence — non-sandbox run)'));
    assert.ok(bundle.includes('### Next run'));
    assert.ok(bundle.length <= 24_000);
  });
});
