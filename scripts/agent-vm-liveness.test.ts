import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NoopCollector,
  SandboxCollector,
  collectVmLiveness,
  seedVmLiveness,
  type ExecFn,
} from './agent-vm-liveness.js';
import { vmLogMtimeArgs, vmLogTailArgs, vmSessionListArgs, vmVcsLogArgs, vmVcsStatusArgs } from './agent-sandbox.js';

type ExecResult = { ok: boolean; stdout: string; stderr: string };

/** Fake `ExecFn` keyed by argv shape; records every call for shape pins. */
function fakeExec(outputs: Record<string, ExecResult>): { exec: ExecFn; seen: string[][] } {
  const seen: string[][] = [];
  const exec: ExecFn = (args) => {
    seen.push(args);
    const key = JSON.stringify(args);
    return Promise.resolve(outputs[key] ?? { ok: false, stdout: '', stderr: `no fake for ${key}` });
  };
  return { exec, seen };
}

const OK = (stdout: string): ExecResult => ({ ok: true, stdout, stderr: '' });
const FAIL = (stderr: string): ExecResult => ({ ok: false, stdout: '', stderr });

function liveOutputs(): Record<string, ExecResult> {
  const tail = [
    'timestamp=2026-09-10T19:39:45.620Z level=INFO run=6b291b15 message=created id=ses_1',
    'timestamp=2026-09-10T19:39:46.098Z level=INFO run=6b291b15 message=loop session.id=ses_1 step=0',
  ].join('\n');
  return {
    [JSON.stringify(vmLogTailArgs('n'))]: OK(tail),
    [JSON.stringify(vmLogMtimeArgs('n'))]: OK('1789069186\n'),
    [JSON.stringify(vmVcsLogArgs('n'))]: OK('1789020386\n'),
    [JSON.stringify(vmVcsStatusArgs('n'))]: OK(' M dirty-file\n'),
    [JSON.stringify(vmSessionListArgs('n'))]: OK(JSON.stringify([{ id: 'ses_1', updatedAt: '2026-09-10T19:39:46.098Z' }])),
  };
}

describe('SandboxCollector argv shapes (#159 KD-3)', () => {
  it('fans out the 5 vm*Args shapes from agent-sandbox.js', async () => {
    const { exec, seen } = fakeExec(liveOutputs());
    const vm = await new SandboxCollector('sbx', 'n', exec).collect(1000);
    assert.equal(vm.collectorOk, true);
    const shapes = [vmLogTailArgs('n'), vmLogMtimeArgs('n'), vmVcsLogArgs('n'), vmVcsStatusArgs('n'), vmSessionListArgs('n')].map((a) =>
      JSON.stringify(a),
    );
    assert.deepEqual(
      seen.map((a) => JSON.stringify(a)).sort(),
      shapes.sort(),
      'exactly the 5 collector arg shapes, no ad-hoc argv',
    );
  });
});

describe('SandboxCollector merge semantics (#149 KD-4)', () => {
  it('merges live legs (log max of tail/mtime, vcs tip +dirty, sessions time)', async () => {
    const { exec } = fakeExec(liveOutputs());
    const vm = await collectVmLiveness('sbx', 'n', 1000, exec);
    assert.equal(vm.log.ok, true);
    assert.equal(vm.log.atMs, Date.parse('2026-09-10T19:39:46.098Z'));
    assert.equal(vm.vcs.ok, true);
    assert.ok(vm.vcs.detail.includes('+dirty'));
    assert.equal(vm.sessions.ok, true);
    assert.equal(vm.sessions.atMs, Date.parse('2026-09-10T19:39:46.098Z'));
    assert.equal(vm.collectorOk, true);
    assert.ok(vm.logTail.includes('message=created'));
  });

  it('log exec failure fails closed (ok:false, seeded time)', async () => {
    const outputs = liveOutputs();
    outputs[JSON.stringify(vmLogTailArgs('n'))] = FAIL('timeout after 10000ms');
    const { exec } = fakeExec(outputs);
    const vm = await collectVmLiveness('sbx', 'n', 1000, exec);
    assert.equal(vm.log.ok, false);
    assert.equal(vm.log.atMs, 1000);
    assert.equal(vm.collectorOk, false);
    assert.deepEqual(vm.logTail, '');
  });

  it('unparseable vcs tip fails closed', async () => {
    const outputs = liveOutputs();
    outputs[JSON.stringify(vmVcsLogArgs('n'))] = OK('not-epoch\n');
    const { exec } = fakeExec(outputs);
    const vm = await collectVmLiveness('sbx', 'n', 1000, exec);
    assert.equal(vm.vcs.ok, false);
    assert.ok(vm.vcs.detail.includes('fail-closed'));
    assert.equal(vm.collectorOk, false);
  });

  it('unparseable session list stays neutral (ok:true, idle since spawn)', async () => {
    const outputs = liveOutputs();
    outputs[JSON.stringify(vmSessionListArgs('n'))] = OK('[]');
    const { exec } = fakeExec(outputs);
    const vm = await collectVmLiveness('sbx', 'n', 1000, exec);
    assert.equal(vm.sessions.ok, true);
    assert.equal(vm.sessions.atMs, 1000);
    assert.ok(vm.sessions.detail.includes('neutral'));
    // The other legs still pass, so the collector is not wedged by CLI drift.
    assert.equal(vm.collectorOk, true);
  });

  it('session exec failure fails closed', async () => {
    const outputs = liveOutputs();
    outputs[JSON.stringify(vmSessionListArgs('n'))] = FAIL('sbx exploded');
    const { exec } = fakeExec(outputs);
    const vm = await collectVmLiveness('sbx', 'n', 1000, exec);
    assert.equal(vm.sessions.ok, false);
    assert.equal(vm.collectorOk, false);
  });
});

describe('NoopCollector (#159 KD-3)', () => {
  it('returns the spawn-seeded snapshot', async () => {
    const vm = await new NoopCollector().collect(4242);
    assert.deepEqual(vm, seedVmLiveness(4242));
  });
});
