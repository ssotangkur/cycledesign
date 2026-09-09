import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { claimIssue, leaseForCommand, releaseLease, shouldReleaseLease } from './agent-daemon-lease.js';

describe('lease labels per command', () => {
  it('maps plan to ready-to-plan/planning', () => {
    assert.deepEqual(leaseForCommand('gh-plan-with-reason'), { trigger: 'ready to plan', inProgress: 'planning' });
  });

  it('maps implement to ready-to-implement/implementing', () => {
    assert.deepEqual(leaseForCommand('resolve-issue'), { trigger: 'ready to implement', inProgress: 'implementing' });
  });

  it('returns null for unknown commands', () => {
    assert.equal(leaseForCommand('nope'), null);
  });
});

describe('release decision', () => {
  it('releases when the in-progress label is still held with no terminal state', () => {
    assert.equal(shouldReleaseLease({ labels: ['implementing'], terminalCommentSince: false }, 'implementing'), true);
  });

  it('suppresses when the worker moved to a terminal label', () => {
    assert.equal(shouldReleaseLease({ labels: ['pr ready'], terminalCommentSince: false }, 'implementing'), false);
  });

  it('suppresses when a terminal comment landed since spawn', () => {
    assert.equal(shouldReleaseLease({ labels: ['implementing'], terminalCommentSince: true }, 'implementing'), false);
  });

  it('suppresses release for a foreign in-progress label', () => {
    assert.equal(shouldReleaseLease({ labels: ['planning'], terminalCommentSince: false }, 'implementing'), false);
  });

  it('suppresses when a terminal label coexists with the lease (pr ready)', () => {
    assert.equal(shouldReleaseLease({ labels: ['implementing', 'pr ready'], terminalCommentSince: false }, 'implementing'), false);
  });

  it('suppresses when a terminal label coexists with the lease (question)', () => {
    assert.equal(shouldReleaseLease({ labels: ['planning', 'question'], terminalCommentSince: false }, 'planning'), false);
  });
});

describe('gh-backed lease ops degrade without gh', () => {
  it('claim returns false against a bogus repo instead of throwing', () => {
    assert.equal(claimIssue('no-owner/no-repo-xyz', 1, { trigger: 't', inProgress: 'p' }), false);
  });

  it('release reports failure against a bogus repo instead of throwing', () => {
    assert.equal(
      releaseLease('no-owner/no-repo-xyz', 1, { trigger: 't', inProgress: 'p' }, { labels: ['p'], terminalCommentSince: false }),
      'failed',
    );
  });

  it('release suppresses without calling gh when the lease moved on', () => {
    assert.equal(
      releaseLease('no-owner/no-repo-xyz', 1, { trigger: 't', inProgress: 'p' }, { labels: ['done'], terminalCommentSince: false }),
      'suppressed',
    );
  });
});
