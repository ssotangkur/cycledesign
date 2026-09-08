import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLine } from './agent-daemon-classify.js';

const GATEWAY_EXACT =
  'AI_APICallError: Rate limit exceeded. Please try again later.';
const UPSTREAM_EXACT =
  'AI_APICallError: Error from provider (Console): Upstream request failed: [rate_limit_exceeded] Rate limit exceeded. Please retry after a brief wait.';

describe('classifyLine', () => {
  it('classifies the exact gateway-quota string', () => {
    assert.equal(classifyLine(GATEWAY_EXACT), 'gateway-quota');
  });

  it('classifies the exact upstream-transient string', () => {
    assert.equal(classifyLine(UPSTREAM_EXACT), 'upstream-transient');
  });

  it('prefers upstream when both markers are present', () => {
    // Upstream check runs first even though "Rate limit exceeded" also matches.
    assert.equal(classifyLine(UPSTREAM_EXACT), 'upstream-transient');
  });

  it('treats upstream non-rate-limit codes as other', () => {
    assert.equal(
      classifyLine('Upstream request failed: [context_length_exceeded] too many tokens'),
      'other',
    );
  });

  it('classifies gateway-quota inside a JSON envelope line', () => {
    const line = JSON.stringify({
      type: 'session.error',
      sessionID: 'ses_abc123',
      error: GATEWAY_EXACT,
    });
    assert.equal(classifyLine(line), 'gateway-quota');
  });

  it('classifies upstream-transient inside a JSON envelope line', () => {
    const line = JSON.stringify({
      type: 'session.error',
      sessionID: 'ses_abc123',
      error: UPSTREAM_EXACT,
    });
    assert.equal(classifyLine(line), 'upstream-transient');
  });

  it('treats clean JSON lines as other', () => {
    assert.equal(
      classifyLine(JSON.stringify({ type: 'text', sessionID: 'ses_abc', part: { sessionID: 'ses_abc' } })),
      'other',
    );
  });

  it('treats non-JSON lines without markers as other', () => {
    assert.equal(classifyLine('hello world'), 'other');
  });
});
