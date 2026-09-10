import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkProjectRead,
  classifyMirrorFailure,
  getLastMirrorFailure,
  labelToStatus,
  setProjectStatus,
  setProjectStatusDetailed,
  syncStatusForLabel,
} from './agent-project.js';

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

describe('mirror failure taxonomy (#140 KD-3)', () => {
  it('classifies missing-scope/auth stderr as auth (captured sample, not just bogus-owner)', () => {
    assert.equal(classifyMirrorFailure('HTTP 403: Resource not accessible by integration (missing project scope)'), 'auth');
    assert.equal(classifyMirrorFailure('Bad credentials (HTTP 401)'), 'auth');
    assert.equal(classifyMirrorFailure('unknown owner type for no-such-owner-xyz'), 'auth');
    assert.equal(classifyMirrorFailure("Your token has not been granted the required scopes to execute this query. Requires 'project' scope."), 'auth');
  });

  it('classifies network/rate-limit stderr as transport with no immediate retry', () => {
    assert.equal(classifyMirrorFailure('request timed out after 10s (ECONNRESET)'), 'transport');
    assert.equal(classifyMirrorFailure('getaddrinfo EAI_AGAIN api.github.com'), 'transport');
    assert.equal(classifyMirrorFailure('HTTP 429: You have exceeded a secondary rate limit. Retry-After: 60'), 'transport');
    assert.equal(classifyMirrorFailure('HTTP 503: Service Unavailable'), 'transport');
  });

  it('classifies operator/config stderr as config (never retried)', () => {
    assert.equal(classifyMirrorFailure('Status field/option not found for "Planning"'), 'config');
    assert.equal(classifyMirrorFailure('unparseable field-list JSON: Unexpected token < in JSON'), 'config');
    assert.equal(classifyMirrorFailure('item-list JSON schema mismatch: missing items array'), 'config');
    assert.equal(classifyMirrorFailure(''), 'config');
  });

  it('detailed path carries step|kind|stderr on failure (bogus owner)', () => {
    process.env['PROJECT_OWNER'] = 'no-such-owner-xyz';
    try {
      const detail = setProjectStatusDetailed('no-owner/no-repo-xyz', 1, 'Planning');
      assert.equal(detail.result, 'failed');
      assert.ok(detail.step.length > 0);
      assert.equal(detail.kind, 'auth');
      assert.ok(detail.stderr.length > 0);
      assert.deepEqual(getLastMirrorFailure(), detail);
    } finally {
      delete process.env['PROJECT_OWNER'];
    }
  });

  it('read-only probe fails against a bogus owner instead of throwing', () => {
    process.env['PROJECT_OWNER'] = 'no-such-owner-xyz';
    try {
      const check = checkProjectRead();
      assert.equal(check.ok, false);
      assert.ok(check.step.length > 0);
      assert.ok(check.stderr.length > 0);
    } finally {
      delete process.env['PROJECT_OWNER'];
    }
  });
});
