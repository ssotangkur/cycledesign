import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_LIMIT,
  boardListArgs,
  decideReconcile,
  listClaimableByStatus,
  mergeClaimableRuns,
  parseBoardItems,
  statusToCommand,
  statusToLabel,
} from './agent-daemon-board.js';

const REPO = 'ssotangkur/cycledesign';

describe('status mapping (claimable only)', () => {
  it('maps Ready to plan to its trigger label and plan command', () => {
    assert.equal(statusToLabel('Ready to plan'), 'ready to plan');
    assert.equal(statusToCommand('Ready to plan'), 'gh-plan-with-reason');
  });

  it('maps Ready to implement to its trigger label and implement command', () => {
    assert.equal(statusToLabel('Ready to implement'), 'ready to implement');
    assert.equal(statusToCommand('Ready to implement'), 'resolve-issue');
  });

  it('returns null for every non-claimable Status', () => {
    for (const status of ['Planning', 'Implementing', 'PR ready', 'Blocked', 'Done', 'Triage', '', 'ready to plan']) {
      assert.equal(statusToLabel(status), null);
      assert.equal(statusToCommand(status), null);
    }
  });
});

describe('board-read contract', () => {
  it('passes an explicit limit matching the issue-list page size', () => {
    const args = boardListArgs();
    const limitFlag = args.indexOf('--limit');
    assert.notEqual(limitFlag, -1);
    assert.equal(args[limitFlag + 1], String(BOARD_LIMIT));
    assert.equal(BOARD_LIMIT, 100);
  });

  it('keeps claimable-Status issues on the repo, drops Done/PR-ready/off-repo/non-issues', () => {
    const stdout = JSON.stringify({
      items: [
        { id: 'a', status: 'Ready to plan', title: 'Plan me', labels: [], content: { type: 'Issue', number: 10, repository: REPO } },
        { id: 'b', status: 'Ready to implement', title: 'Build me', labels: ['ready to implement'], content: { type: 'Issue', number: 11, repository: REPO } },
        { id: 'c', status: 'Done', title: 'Done', labels: [], content: { type: 'Issue', number: 12, repository: REPO } },
        { id: 'd', status: 'PR ready', title: 'In review', labels: ['pr ready'], content: { type: 'Issue', number: 13, repository: REPO } },
        { id: 'e', status: 'Planning', title: 'Active', labels: ['planning'], content: { type: 'Issue', number: 14, repository: REPO } },
        { id: 'f', status: 'Ready to plan', title: 'Other repo', labels: [], content: { type: 'Issue', number: 15, repository: 'other/repo' } },
        { id: 'g', status: 'Ready to implement', title: 'A PR', labels: [], content: { type: 'PullRequest', number: 16, repository: REPO } },
        { id: 'h', status: 'Ready to plan', title: 'Draft', labels: [], content: { type: 'DraftIssue', repository: REPO } },
      ],
    });
    assert.deepEqual(parseBoardItems(stdout, REPO), [
      { number: 10, title: 'Plan me', status: 'Ready to plan', labels: [] },
      { number: 11, title: 'Build me', status: 'Ready to implement', labels: ['ready to implement'] },
    ]);
  });

  it('throws on a schema mismatch (caller converts to a failed result)', () => {
    assert.throws(() => parseBoardItems('{}', REPO), /missing items array/);
  });

  it('reports failure instead of throwing when gh cannot resolve', () => {
    process.env['PROJECT_OWNER'] = 'no-such-owner-xyz';
    try {
      const result = listClaimableByStatus('no-owner/no-repo-xyz');
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.step.length > 0);
        assert.ok(result.stderr.length > 0);
      }
    } finally {
      delete process.env['PROJECT_OWNER'];
    }
  });
});

describe('board-first merge', () => {
  it('unions label and board hits oldest-first, board-only hydrated once', () => {
    const runs = mergeClaimableRuns(
      [{ number: 3, title: 'Plan', createdAt: '2026-01-01' }],
      [{ number: 5, title: 'Build', createdAt: '2026-01-02' }],
      [{ number: 7, title: 'Board only', createdAt: '2026-01-03', status: 'Ready to implement', labels: [] }],
    );
    assert.deepEqual(
      runs.map((r) => [r.issue.number, r.command, r.boardStatus]),
      [
        [3, 'gh-plan-with-reason', null],
        [5, 'resolve-issue', null],
        [7, 'resolve-issue', 'Ready to implement'],
      ],
    );
  });

  it('Status plan + label implement resolves to implement, deduped once', () => {
    const runs = mergeClaimableRuns(
      [],
      [{ number: 9, title: 'Both', createdAt: '2026-01-01' }],
      [{ number: 9, title: 'Both', createdAt: '2026-01-01', status: 'Ready to plan', labels: ['ready to implement'] }],
    );
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'resolve-issue');
    assert.equal(runs[0].label, 'ready to implement');
    assert.equal(runs[0].boardStatus, 'Ready to plan');
  });

  it('Status implement + label plan resolves to implement', () => {
    const runs = mergeClaimableRuns(
      [{ number: 9, title: 'Both', createdAt: '2026-01-01' }],
      [],
      [{ number: 9, title: 'Both', createdAt: '2026-01-01', status: 'Ready to implement', labels: ['ready to plan'] }],
    );
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'resolve-issue');
    assert.equal(runs[0].label, 'ready to implement');
    assert.equal(runs[0].boardStatus, 'Ready to implement');
  });

  it('ignores non-claimable board entries in the merge', () => {
    const runs = mergeClaimableRuns(
      [],
      [],
      [{ number: 9, title: 'Done', createdAt: '2026-01-01', status: 'Done', labels: [] }],
    );
    assert.equal(runs.length, 0);
  });
});

describe('add-only reconcile decision', () => {
  it('adds the missing trigger label for a clean board-claimable issue', () => {
    assert.deepEqual(decideReconcile('Ready to plan', [], false), { action: 'add', label: 'ready to plan' });
    assert.deepEqual(decideReconcile('Ready to implement', ['planning'], false), { action: 'add', label: 'ready to implement' });
  });

  it('does nothing when there is no board Status or the trigger is present', () => {
    assert.deepEqual(decideReconcile(null, [], false), { action: 'none' });
    assert.deepEqual(decideReconcile('Done', [], false), { action: 'none' });
    assert.deepEqual(decideReconcile('Ready to plan', ['ready to plan'], false), { action: 'none' });
  });

  it('suppresses the add when a terminal label is present (never strips)', () => {
    assert.deepEqual(decideReconcile('Ready to implement', ['question'], false), { action: 'suppressed', reason: 'terminal-label' });
    assert.deepEqual(decideReconcile('Ready to implement', ['pr ready'], false), { action: 'suppressed', reason: 'terminal-label' });
  });

  it('reports would-reconcile under dry-run without mutating', () => {
    assert.deepEqual(decideReconcile('Ready to plan', [], true), { action: 'would-reconcile', label: 'ready to plan' });
    assert.deepEqual(decideReconcile('Ready to plan', ['ready to plan'], true), { action: 'none' });
    assert.deepEqual(decideReconcile('Ready to plan', ['question'], true), { action: 'suppressed', reason: 'terminal-label' });
  });
});
