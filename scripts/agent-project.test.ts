import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { labelToStatus, setProjectStatus, syncStatusForLabel } from './agent-project.js';

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
