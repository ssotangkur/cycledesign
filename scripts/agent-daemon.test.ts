import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createStreamTracker,
  maxLogTimestamp,
  observeLine,
  parseCimTree,
  parseSessionListTime,
  parseVmVcsTime,
  parseWmicTree,
  seedVmLiveness,
  tagForLine,
  vmAgesSummary,
  vmErrorExcerpt,
} from './agent-daemon.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('VM collector parsers (#149 KD-4/KD-7)', () => {
  it('maxLogTimestamp takes the max timestamp= prefix', () => {
    const tail = [
      'timestamp=2026-09-10T19:39:45.620Z level=INFO run=6b291b15 message=created id=ses_1',
      'timestamp=2026-09-10T19:39:46.098Z level=INFO run=6b291b15 message=loop session.id=ses_1 step=0',
      'no timestamp here',
      'timestamp=not-a-date level=INFO',
    ].join('\n');
    assert.equal(maxLogTimestamp(tail), Date.parse('2026-09-10T19:39:46.098Z'));
  });

  it('maxLogTimestamp returns null with no usable timestamps', () => {
    assert.equal(maxLogTimestamp(''), null);
    assert.equal(maxLogTimestamp('plain text\nmore text'), null);
  });

  it('parseVmVcsTime converts %ct epoch seconds to ms', () => {
    assert.equal(parseVmVcsTime('1789020386\n'), 1789020386 * 1000);
    assert.equal(parseVmVcsTime('not-epoch'), null);
    assert.equal(parseVmVcsTime(''), null);
  });

  it('parseSessionListTime handles array and envelope shapes', () => {
    const iso = '2026-09-10T19:39:46.098Z';
    const ms = Date.parse(iso);
    assert.equal(parseSessionListTime(JSON.stringify([{ id: 'ses_1', updatedAt: iso }])), ms);
    assert.equal(parseSessionListTime(JSON.stringify({ sessions: [{ id: 'ses_1', updated: ms }] })), ms);
    // Epoch seconds vs ms heuristic.
    assert.equal(parseSessionListTime(JSON.stringify([{ id: 'ses_1', time: 1789069186 }])), 1789069186 * 1000);
    assert.equal(parseSessionListTime(JSON.stringify([{ id: 'ses_1', timestamp: ms }])), ms);
  });

  it('parseSessionListTime returns null on garbage', () => {
    assert.equal(parseSessionListTime(''), null);
    assert.equal(parseSessionListTime('not json'), null);
    assert.equal(parseSessionListTime(JSON.stringify([{ id: 'ses_1' }])), null);
  });

  it('seedVmLiveness seeds every leg at spawn with collectorOk', () => {
    const vm = seedVmLiveness(1000);
    assert.equal(vm.collectorOk, true);
    assert.equal(vm.log.atMs, 1000);
    assert.equal(vm.vcs.atMs, 1000);
    assert.equal(vm.sessions.atMs, 1000);
    assert.deepEqual(vm.logErrors, []);
  });
});

describe('tree listing parsers (#149 step 6, wmic-absent path)', () => {
  it('parseWmicTree reads ProcessId/CreationDate pairs', () => {
    const procs = parseWmicTree('CreationDate=20260910120000.000000+060\nProcessId=1234\n\nCreationDate=20260910120500.000000+060\nProcessId=5678\n');
    assert.ok(procs !== null);
    assert.equal(procs.length, 2);
    assert.equal(procs[0].pid, 1234);
    assert.equal(procs[0].createdMs, Date.UTC(2026, 8, 10, 12, 0, 0));
    assert.equal(procs[1].pid, 5678);
  });

  it('parseWmicTree returns null when wmic is absent', () => {
    assert.equal(parseWmicTree(''), null);
    assert.equal(parseWmicTree('(unavailable)'), null);
    assert.equal(parseWmicTree('some other command output'), null);
  });

  it('parseCimTree reads array and single-object JSON', () => {
    const arr = parseCimTree(
      JSON.stringify([
        { ProcessId: 11, CreationDate: '/Date(1789069186000)/' },
        { ProcessId: 22, CreationDate: '2026-09-10T19:39:46.098Z' },
      ]),
    );
    assert.ok(arr !== null);
    assert.deepEqual(arr, [
      { pid: 11, createdMs: 1789069186000 },
      { pid: 22, createdMs: Date.parse('2026-09-10T19:39:46.098Z') },
    ]);
    const single = parseCimTree(JSON.stringify({ ProcessId: 33, CreationDate: null }));
    assert.deepEqual(single, [{ pid: 33, createdMs: null }]);
  });

  it('parseCimTree returns null on garbage', () => {
    assert.equal(parseCimTree(''), null);
    assert.equal(parseCimTree('(unavailable)'), null);
    assert.equal(parseCimTree('not json'), null);
  });
});

describe('console surfacing (#163)', () => {
  it('vmErrorExcerpt keeps quota/error lines, drops info', () => {
    const tail = [
      'timestamp=2026-09-10T22:56:28.733Z level=INFO run=b38b191a message=loop session.id=ses_1 step=0',
      'timestamp=2026-09-10T22:56:28.925Z level=ERROR run=b38b191a message="stream error" error.error="AI_APICallError: Rate limit exceeded. Please try again later."',
      'tail fragment Upstream request failed: [rate_limit_exceeded] retrying',
      'another info line',
    ].join('\n');
    const ex = vmErrorExcerpt(tail);
    assert.equal(ex.length, 2);
    assert.ok(ex[0].includes('Rate limit exceeded'), 'keeps quota line');
    assert.ok(ex[1].includes('Upstream request failed'), 'keeps upstream line');
    assert.deepEqual(vmErrorExcerpt('nothing here\nno markers'), []);
  });

  it('vmErrorExcerpt honors line and char caps', () => {
    const tail = Array.from({ length: 5 }, (_, i) => `level=ERROR marker line ${i}`).join('\n');
    assert.equal(vmErrorExcerpt(tail, 2).length, 2);
    assert.equal(vmErrorExcerpt(tail, 20, 50).length, 2);
  });

  it('vmAgesSummary renders per-leg recency', () => {
    const vm = seedVmLiveness(0);
    vm.log.atMs = 2000;
    vm.vcs.atMs = 0;
    vm.sessions.atMs = 89000;
    assert.equal(vmAgesSummary(vm, 90000), 'vm: log 88s ago, vcs 90s ago, sessions 1s ago');
  });

  it('observeLine reports a newly-seen nested session ID once', () => {
    const tracker = createStreamTracker(Date.now());
    const line = JSON.stringify({
      type: 'step',
      sessionID: 'ses_root1',
      part: { state: { metadata: { sessionId: 'ses_child1' } } },
    });
    const first = observeLine(line, tracker);
    assert.equal(first.tag, '[orchestrator]');
    assert.equal(first.cls, 'other');
    assert.equal(first.nestedSessionId, 'ses_child1');
    const second = observeLine(line, tracker);
    assert.equal(second.nestedSessionId, null);
  });

  it('observeLine reports null nested ID for ordinary lines', () => {
    const tracker = createStreamTracker(Date.now());
    const res = observeLine(JSON.stringify({ type: 'step', sessionID: 'ses_root1' }), tracker);
    assert.equal(res.nestedSessionId, null);
  });
});

describe('nested-Task stdout scope (#149 KD-6)', () => {
  it('probe fixture: 7x [orchestrator], nested ID in side-table, zero [sub:]', () => {
    const lines = readFileSync(join(here, 'agent-daemon-nested-task.fixture.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    assert.equal(lines.length, 7);
    const tracker = createStreamTracker(Date.now());
    const tags = lines.map((l) => tagForLine(l, tracker));
    assert.ok(tags.every((t) => t === '[orchestrator]'), `all lines tag [orchestrator], got ${tags.join(',')}`);
    assert.ok(!tags.some((t) => t.startsWith('[sub:')), 'zero stdout [sub:] lines');
    assert.ok(tracker.nestedSessionIds.has('ses_child9abc00000002'), 'nested session ID extracted to side-table');
    assert.equal(tracker.rootSessionId, 'ses_f73d13f8test00000001');
  });
});
