import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOST_RING_LINES,
  HOST_RING_LINE_CHARS,
  VM_MIRROR_LINE_CHARS,
  WATCHDOG_BUNDLE_MAX_CHARS,
  createStreamTracker,
  formatVmTailForComment,
  formatWatchdogSections,
  hasTerminalCommentSince,
  isFenceClear,
  logTailNewcomers,
  markNestedVmLine,
  maxLogTimestamp,
  observeLine,
  parseCimTree,
  parseSessionListTime,
  parseVmVcsTime,
  parseWmicTree,
  pushRing,
  seedVmLiveness,
  tagForLine,
  vmAgesSummary,
  vmErrorExcerpt,
  vmProgressLines,
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
    assert.equal(vm.logTail, '');
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

  it('vmProgressLines reports session/vcs transitions only', () => {
    const prev = seedVmLiveness(1000);
    assert.deepEqual(vmProgressLines(prev, seedVmLiveness(1000)), []);
    const next = seedVmLiveness(1000);
    next.sessions = { ok: true, atMs: 2000, detail: 'session-log 1970-01-01T00:00:02.000Z' };
    next.vcs = { ok: true, atMs: 3000, detail: 'vm-vcs tip 1970-01-01T00:00:03.000Z +dirty' };
    assert.deepEqual(vmProgressLines(prev, next), [
      'session activity: session-log 1970-01-01T00:00:02.000Z',
      'vcs: vm-vcs tip 1970-01-01T00:00:03.000Z +dirty',
    ]);
  });

  it('logTailNewcomers returns only lines after the previous overlap', () => {
    const r = logTailNewcomers('a\nb\nc', 'a\nb\nc\nd\ne');
    assert.deepEqual(r, { lines: ['d', 'e'], truncated: 0, rotated: false });
    assert.deepEqual(logTailNewcomers('', ''), { lines: [], truncated: 0, rotated: false });
  });

  it('logTailNewcomers anchors on the latest duplicate occurrence', () => {
    // Identical lines are indistinguishable: align to the latest occurrence
    // so nothing is re-printed (minimal-new).
    assert.deepEqual(logTailNewcomers('x\nx', 'x\nx\nx\ny').lines, ['y']);
  });

  it('logTailNewcomers caps and flags lost overlap', () => {
    const next = ['l1', 'l2', 'l3', 'l4'].join('\n');
    const capped = logTailNewcomers('', next, 2);
    assert.deepEqual(capped.lines, ['l1', 'l2']);
    assert.equal(capped.truncated, 2);
    assert.equal(capped.rotated, false);
    const rotated = logTailNewcomers('old1\nold2', next, 10);
    assert.equal(rotated.rotated, true);
    assert.deepEqual(rotated.lines, ['l1', 'l2', 'l3', 'l4']);
  });

  it('markNestedVmLine flags known nested sessions', () => {
    const nested = new Set(['ses_child1']);
    assert.equal(
      markNestedVmLine('message=loop session.id=ses_child1 step=3', nested),
      'message=loop session.id=ses_child1 step=3 [sub-agent]',
    );
    assert.equal(markNestedVmLine('message=loop session.id=ses_root1 step=0', nested), 'message=loop session.id=ses_root1 step=0');
    assert.equal(markNestedVmLine('no session here', nested), 'no session here');
  });
});

describe('watchdog comment evidence (#162)', () => {
  function baseSectionsInput() {
    return {
      silenceS: 600,
      timeoutS: 600,
      elapsedS: 900,
      childPid: 1234 as number | undefined,
      sandboxName: 'sbx-test' as string | null,
      outcome: 'reset-intended' as const,
      hostRecentOther: ['{"type":"step"}', '{"type":"text"}'],
      hostRecentError: [] as string[],
      vmExcerpt: [] as string[],
      vmTail: { lines: [] as string[], truncated: 0, rotated: false, empty: true },
      vmPresent: true,
      sessionSummary: 'spawned: x',
      processTree: 'PID 1234',
      portOwnership: 'web:3000 -> ok',
      branchState: 'branch: main',
      sandboxStatus: 'sandbox ok' as string | null,
      vmLegs: 'collectorOk: true' as string | null,
    };
  }

  it('observeLine fills host rings with class membership and eviction', () => {
    const tracker = createStreamTracker(Date.now());
    for (let i = 0; i < HOST_RING_LINES + 2; i += 1) {
      observeLine(`{"type":"step","n":${i}}`, tracker);
    }
    assert.equal(tracker.recentOther.length, HOST_RING_LINES);
    assert.ok(tracker.recentOther[0].includes('"n":2'), 'oldest evicted');
    assert.ok(tracker.recentOther[HOST_RING_LINES - 1].includes('"n":11'), 'most recent kept');
    observeLine('Rate limit exceeded, retry later', tracker);
    observeLine('Upstream request failed: [rate_limit_exceeded] retrying', tracker);
    assert.equal(tracker.recentError.length, 2);
    assert.ok(tracker.recentError[0].includes('Rate limit exceeded'), 'gateway-quota is error-class');
    assert.ok(tracker.recentError[1].includes('Upstream request failed'), 'upstream-transient is error-class');
    // Singletons stay maintained for exit diagnosis (bundle prints rings instead).
    assert.ok(tracker.lastErrorLine !== null);
    assert.ok(tracker.lastLine !== null);
  });

  it('pushRing truncates lines and evicts oldest beyond cap', () => {
    const ring: string[] = [];
    for (let i = 0; i < HOST_RING_LINES + 2; i += 1) {
      pushRing(ring, `line-${i}`);
    }
    assert.equal(ring.length, HOST_RING_LINES);
    assert.equal(ring[0], 'line-2');
    pushRing(ring, 'x'.repeat(HOST_RING_LINE_CHARS + 100));
    assert.equal(ring[ring.length - 1].length, HOST_RING_LINE_CHARS);
  });

  it('hasTerminalCommentSince skips the own-run watchdog bundle', () => {
    const spawn = '2026-09-11T02:00:00.000Z';
    const own = '2026-09-11T02:05:00.000Z';
    assert.equal(
      hasTerminalCommentSince([{ body: '## Watchdog investigation\n\n### What happened', createdAt: own }], spawn),
      false,
      'own-run bundle is not a terminal signal',
    );
    assert.equal(
      hasTerminalCommentSince([{ body: '## Watchdog investigation', createdAt: '2026-09-11T01:00:00.000Z' }], spawn),
      false,
      'prior-run bundle already filtered by since',
    );
    assert.equal(
      hasTerminalCommentSince([{ body: '## Question\nstuck?', createdAt: own }], spawn),
      true,
      'real terminal comment still blocks',
    );
    assert.equal(hasTerminalCommentSince([{ body: '## Plan with Reason\n...', createdAt: own }], spawn), true);
    assert.equal(isFenceClear({ labels: ['implementing'], terminalCommentSince: false }), true);
    assert.equal(isFenceClear({ labels: ['implementing'], terminalCommentSince: true }), false);
  });

  it('formatVmTailForComment slices last-50 from the fire-time tail (prevTail identical)', () => {
    const tail = Array.from(
      { length: 60 },
      (_, i) => `timestamp=2026-09-11T02:00:${String(i).padStart(2, '0')}Z level=INFO msg=line-${i}`,
    ).join('\n');
    const out = formatVmTailForComment(tail, tail, new Set());
    assert.equal(out.empty, false);
    assert.equal(out.lines.length, 50);
    assert.equal(out.truncated, 10);
    assert.equal(out.rotated, false);
    assert.ok(out.lines[0].includes('line-10'));
    assert.ok(out.lines[49].includes('line-59'));
  });

  it('formatVmTailForComment caps lines, marks nested sessions, flags rotation/empty', () => {
    const long = `session.id=ses_child1 msg=${'y'.repeat(500)}`;
    const out = formatVmTailForComment(`plain line\n${long}`, 'unrelated\nolder', new Set(['ses_child1']));
    assert.equal(out.rotated, true);
    assert.ok(out.lines[1].length <= VM_MIRROR_LINE_CHARS + ' [sub-agent]'.length);
    assert.ok(out.lines[1].endsWith('[sub-agent]'));
    assert.deepEqual(formatVmTailForComment('', '', new Set()), { lines: [], truncated: 0, rotated: false, empty: true });
  });

  it('formatWatchdogSections renders the header matrix and next-run directive', () => {
    const intended = formatWatchdogSections(baseSectionsInput());
    assert.ok(intended.includes('### What happened'));
    assert.ok(intended.includes('Label intent:'));
    assert.ok(intended.includes('iff the fence is still clear'));
    assert.ok(intended.includes('### Next run'));
    assert.ok(intended.includes('MUST (1) investigate'));
    assert.ok(intended.includes('diagnose-stuck-run'));
    assert.ok(intended.includes('verdict (`busy` | `rate-limited` | `wedged`'));
    assert.ok(intended.includes('how you will avoid the same stall'));
    const blocked = formatWatchdogSections({ ...baseSectionsInput(), outcome: 'fence-blocked' });
    assert.ok(blocked.includes('kept at `implementing` (no reset)'));
    const failClosed = formatWatchdogSections({ ...baseSectionsInput(), outcome: 'transport-fail-closed' });
    assert.ok(failClosed.includes('fail-closed (no reset)'));
    const destroyed = formatWatchdogSections({ ...baseSectionsInput(), outcome: 'destroy-failed' });
    assert.ok(destroyed.includes('parked at `question`'));
    const bare = formatWatchdogSections({
      ...baseSectionsInput(),
      vmPresent: false,
      sandboxName: null,
      sandboxStatus: null,
      vmLegs: null,
    });
    assert.ok(bare.includes('(no VM evidence — non-sandbox run)'));
    assert.ok(bare.includes('(non-sandbox run, no VM to destroy)'));
  });

  it('formatWatchdogSections passes the VM excerpt through as-is', () => {
    const out = formatWatchdogSections({
      ...baseSectionsInput(),
      vmExcerpt: ['level=ERROR boom', 'Rate limit exceeded x'],
    });
    assert.ok(out.includes('level=ERROR boom'));
    assert.ok(out.includes('Rate limit exceeded x'));
  });

  it('formatWatchdogSections caps total size, cutting rings before tail/excerpt', () => {
    const input = baseSectionsInput();
    input.hostRecentOther = Array.from({ length: 10 }, (_, i) => `o${i}-`.concat('a'.repeat(497)));
    input.hostRecentError = Array.from({ length: 10 }, (_, i) => `e${i}-`.concat('b'.repeat(497)));
    input.vmTail = {
      lines: Array.from({ length: 50 }, (_, i) => `t${i}-`.concat('c'.repeat(290))),
      truncated: 0,
      rotated: false,
      empty: false,
    };
    input.vmExcerpt = ['level=ERROR KEEP-ME-EXCERPT'];
    const out = formatWatchdogSections(input);
    assert.ok(out.length <= WATCHDOG_BUNDLE_MAX_CHARS, `bundle ${out.length} chars exceeds cap`);
    assert.ok(out.includes('### What happened'));
    assert.ok(out.includes('### Next run'));
    assert.ok(!out.includes('o0-'), 'other ring cut first');
    assert.ok(out.includes('e0-'), 'error ring survives ring-stage cuts');
    assert.ok(out.includes('t0-'), 'VM tail survives ring-stage cuts');
    assert.ok(out.includes('KEEP-ME-EXCERPT'), 'excerpt survives ring-stage cuts');
  });

  it('formatWatchdogSections truncates existing sections last, never header/next-run', () => {
    const input = baseSectionsInput();
    input.processTree = 'P'.repeat(20000);
    input.portOwnership = 'O'.repeat(10000);
    const out = formatWatchdogSections(input);
    assert.ok(out.length <= WATCHDOG_BUNDLE_MAX_CHARS, `bundle ${out.length} chars exceeds cap`);
    assert.ok(out.includes('### What happened'));
    assert.ok(out.includes('### Next run'));
    assert.ok(out.includes('MUST (1) investigate'));
    assert.ok(out.includes('[truncated to fit 24KB watchdog cap]'));
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
