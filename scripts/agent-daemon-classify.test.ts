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

  it('#155: ignores a gateway marker inside tool_use file content', () => {
    // A worker reading agent-daemon-classify.ts fired a bogus failover on
    // the source text of the classifier itself.
    const line = JSON.stringify({
      type: 'tool_use',
      timestamp: 1789018717278,
      sessionID: 'ses_abc123',
      part: {
        type: 'tool',
        tool: 'read',
        callID: 'call_01',
        state: {
          status: 'completed',
          input: { filePath: 'scripts/agent-daemon-classify.ts' },
          output: 'const RATE_LIMIT_RE = /Rate limit exceeded/;',
        },
      },
    });
    assert.equal(classifyLine(line), 'other');
  });

  it('#155: error-shaped fields stay authoritative inside tool_use', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      timestamp: 1789018717278,
      sessionID: 'ses_abc123',
      error: GATEWAY_EXACT,
      part: {
        type: 'tool',
        tool: 'read',
        state: { status: 'error' },
      },
    });
    assert.equal(classifyLine(line), 'gateway-quota');
  });

  it('#155: ignores an upstream marker inside tool_use file content', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      timestamp: 1789018717278,
      sessionID: 'ses_abc123',
      part: {
        type: 'tool',
        tool: 'grep',
        state: {
          status: 'completed',
          output: 'Upstream request failed: [rate_limit_exceeded]',
        },
      },
    });
    assert.equal(classifyLine(line), 'other');
  });
});
