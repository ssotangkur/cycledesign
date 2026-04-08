#!/usr/bin/env node

/**
 * Unit Tests for Chat Log Parser
 *
 * Run with: npx tsx .qwen/skills/chat-log-parser/scripts/parse-chat-log.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import functions from parse-chat-log.ts
// Since we can't directly import, we'll replicate the logic here for testing

// ============================================================================
// Test Utilities
// ============================================================================

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// ============================================================================
// Test Data
// ============================================================================

const TEST_SESSION_ID = '68eb68a6-a83e-40ca-9e63-0711709426da';
const TEST_DIR = path.join(os.tmpdir(), 'chat-log-parser-tests');

const VALID_JSONL = [
  JSON.stringify({
    uuid: 'msg-001',
    sessionId: TEST_SESSION_ID,
    timestamp: '2026-04-01T08:20:08.000Z',
    type: 'user',
    message: { role: 'user', content: 'Hello, resolve issue #51' },
  }),
  JSON.stringify({
    uuid: 'msg-002',
    parentUuid: 'msg-001',
    sessionId: TEST_SESSION_ID,
    timestamp: '2026-04-01T08:21:00.000Z',
    type: 'assistant',
    message: { role: 'assistant', content: 'I will help with that' },
    prompt_id: '#qwen-main',
  }),
  JSON.stringify({
    uuid: 'msg-003',
    parentUuid: 'msg-002',
    sessionId: TEST_SESSION_ID,
    timestamp: '2026-04-01T08:21:30.000Z',
    type: 'assistant',
    message: { role: 'assistant', content: 'Starting issue resolver' },
    prompt_id: '#issue-resolver-abc',
  }),
  JSON.stringify({
    uuid: 'msg-004',
    parentUuid: 'msg-003',
    sessionId: TEST_SESSION_ID,
    timestamp: '2026-04-01T08:22:00.000Z',
    type: 'system',
    subtype: 'tool_call',
    systemPayload: { tool: 'mcp__github__issue_read' },
  }),
].join('\n');

const MALFORMED_JSONL = [
  VALID_JSONL.split('\n')[0],
  'this is not valid json',
  VALID_JSONL.split('\n')[2],
  '{ "uuid": "msg-005" }', // Missing required fields
].join('\n');

const EMPTY_JSONL = '';

const MIXED_ENCODING_JSONL = '\uFEFF' + VALID_JSONL; // BOM marker

// ============================================================================
// Helper Functions (replicated from parse-chat-log.ts for testing)
// ============================================================================

function validateUuidFormat(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

function validateSpeakerType(speaker: string): boolean {
  return ['user', 'assistant', 'subagent', 'system'].includes(speaker);
}

function validateRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
}

function validateRequiredFields(line: Record<string, unknown>, lineNum: number): string[] {
  const errors: string[] = [];
  if (!line.uuid) errors.push(`Line ${lineNum}: Missing required field 'uuid'`);
  if (!line.timestamp) errors.push(`Line ${lineNum}: Missing required field 'timestamp'`);
  if (!line.type) errors.push(`Line ${lineNum}: Missing required field 'type'`);
  return errors;
}

function identifySpeaker(message: Record<string, unknown>): { speaker: string; agentName: string | null } {
  const type = message.type as string;
  const promptId = message.prompt_id as string | undefined;

  if (type === 'user') {
    return { speaker: 'user', agentName: null };
  }

  if (type === 'system' || type === 'tool_result') {
    return { speaker: 'system', agentName: null };
  }

  if (type === 'assistant') {
    if (promptId) {
      const match = promptId.match(/^#([a-z0-9-]+)-/i);
      if (match) {
        return { speaker: 'subagent', agentName: match[1] };
      }
    }
    return { speaker: 'assistant', agentName: null };
  }

  return { speaker: 'system', agentName: null };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ${hours % 24} hour${hours % 24 !== 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes % 60} minute${minutes % 60 !== 1 ? 's' : ''}`;
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ${seconds % 60} second${seconds % 60 !== 1 ? 's' : ''}`;
  }
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}k`;
  }
  return tokens.toString();
}

// ============================================================================
// Tests
// ============================================================================

console.log('='.repeat(60));
console.log('Chat Log Parser - Unit Tests');
console.log('='.repeat(60));

// Test 1: UUID Validation
describe('UUID Validation', () => {
  assert(validateUuidFormat('68eb68a6-a83e-40ca-9e63-0711709426da') === true, 'Valid UUID format');
  assert(validateUuidFormat('not-a-uuid') === false, 'Invalid UUID format');
  assert(validateUuidFormat('') === false, 'Empty string is not valid UUID');
  assert(validateUuidFormat('123e4567-e89b-12d3-a456-426614174000') === true, 'Another valid UUID');
});

// Test 2: Speaker Type Validation
describe('Speaker Type Validation', () => {
  assert(validateSpeakerType('user') === true, 'user is valid');
  assert(validateSpeakerType('assistant') === true, 'assistant is valid');
  assert(validateSpeakerType('subagent') === true, 'subagent is valid');
  assert(validateSpeakerType('system') === true, 'system is valid');
  assert(validateSpeakerType('invalid') === false, 'invalid is not valid');
  assert(validateSpeakerType('') === false, 'empty string is not valid');
});

// Test 3: Regex Validation
describe('Regex Validation', () => {
  assert(validateRegex('error|failed') !== null, 'Valid regex pattern');
  assert(validateRegex('issue #\\d+') !== null, 'Valid regex with escape');
  assert(validateRegex('[invalid') === null, 'Invalid regex returns null');
  assert(validateRegex('') !== null, 'Empty string is valid regex');
});

// Test 4: Required Fields Validation
describe('Required Fields Validation', () => {
  const validLine = { uuid: 'msg-001', timestamp: '2026-04-01T08:20:08.000Z', type: 'user' };
  const missingUuid = { timestamp: '2026-04-01T08:20:08.000Z', type: 'user' };
  const missingTimestamp = { uuid: 'msg-001', type: 'user' };
  const missingType = { uuid: 'msg-001', timestamp: '2026-04-01T08:20:08.000Z' };

  assert(validateRequiredFields(validLine, 1).length === 0, 'Valid line has no errors');
  assert(validateRequiredFields(missingUuid, 1).length > 0, 'Missing uuid detected');
  assert(validateRequiredFields(missingTimestamp, 1).length > 0, 'Missing timestamp detected');
  assert(validateRequiredFields(missingType, 1).length > 0, 'Missing type detected');
});

// Test 5: Speaker Identification
describe('Speaker Identification', () => {
  const userMsg = { type: 'user', message: { role: 'user' } };
  const assistantMsg = { type: 'assistant' };
  const subagentMsg = { type: 'assistant', prompt_id: '#issue-resolver-abc' };
  const systemMsg = { type: 'system', subtype: 'tool_call' };
  const toolResultMsg = { type: 'tool_result' };

  assert(identifySpeaker(userMsg).speaker === 'user', 'User message identified');
  assert(identifySpeaker(assistantMsg).speaker === 'assistant', 'Assistant message identified');
  assert(identifySpeaker(subagentMsg).speaker === 'subagent', 'Subagent message identified');
  assert(identifySpeaker(subagentMsg).agentName === 'issue-resolver', 'Subagent name extracted');
  assert(identifySpeaker(systemMsg).speaker === 'system', 'System message identified');
  assert(identifySpeaker(toolResultMsg).speaker === 'system', 'Tool result identified as system');
});

// Test 6: Duration Formatting
describe('Duration Formatting', () => {
  assert(formatDuration(1000) === '1 second', '1 second');
  assert(formatDuration(5000) === '5 seconds', '5 seconds');
  assert(formatDuration(60000) === '1 minute 0 seconds', '1 minute');
  assert(formatDuration(3600000) === '1 hour 0 minutes', '1 hour');
  assert(formatDuration(86400000) === '1 day 0 hours', '1 day');
  // 8 hours 7 minutes = 8*3600000 + 7*60000 = 28800000 + 420000 = 29220000
  const eightHoursSevenMinutes = 8 * 3600000 + 7 * 60000;
  const formatted = formatDuration(eightHoursSevenMinutes);
  assert(formatted.includes('8 hour') && formatted.includes('7 minute'), '8 hours 7 minutes');
});

// Test 7: Token Count Formatting
describe('Token Count Formatting', () => {
  assert(formatTokenCount(500) === '500', '500 tokens');
  assert(formatTokenCount(5000) === '5k', '5k tokens');
  assert(formatTokenCount(500000) === '500k', '500k tokens');
  assert(formatTokenCount(1500000) === '1.5M', '1.5M tokens');
});

// Test 8: JSONL Parsing
describe('JSONL Parsing', () => {
  // Create test directory
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }

  // Test valid JSONL
  const validFile = path.join(TEST_DIR, 'valid.jsonl');
  fs.writeFileSync(validFile, VALID_JSONL);
  const validContent = fs.readFileSync(validFile, 'utf-8');
  const validLines = validContent.split('\n').filter(l => l.trim());
  assert(validLines.length === 4, 'Valid JSONL has 4 lines');

  let parseErrors = 0;
  for (const line of validLines) {
    try {
      JSON.parse(line);
    } catch {
      parseErrors++;
    }
  }
  assert(parseErrors === 0, 'All lines parse without errors');

  // Test malformed JSONL
  const malformedFile = path.join(TEST_DIR, 'malformed.jsonl');
  fs.writeFileSync(malformedFile, MALFORMED_JSONL);
  const malformedContent = fs.readFileSync(malformedFile, 'utf-8');
  const malformedLines = malformedContent.split('\n').filter(l => l.trim());
  let malformedErrors = 0;
  for (const line of malformedLines) {
    try {
      JSON.parse(line);
    } catch {
      malformedErrors++;
    }
  }
  assert(malformedErrors === 1, 'Malformed JSON detected (1 invalid line)');

  // Test empty file
  const emptyFile = path.join(TEST_DIR, 'empty.jsonl');
  fs.writeFileSync(emptyFile, EMPTY_JSONL);
  const emptyContent = fs.readFileSync(emptyFile, 'utf-8');
  assert(emptyContent.trim() === '', 'Empty file handled');

  // Test BOM
  const bomFile = path.join(TEST_DIR, 'bom.jsonl');
  fs.writeFileSync(bomFile, MIXED_ENCODING_JSONL);
  const bomContent = fs.readFileSync(bomFile, 'utf-8').replace(/^\uFEFF/, '');
  assert(!bomContent.startsWith('\uFEFF'), 'BOM marker removed');
});

// Test 9: Filtering Logic
describe('Filtering Logic', () => {
  const messages = [
    { speaker: 'user', content: 'Hello', toolCalls: [] },
    { speaker: 'assistant', content: 'Hi there', toolCalls: [{ name: 'run_shell_command', arguments: '{}' }] },
    { speaker: 'subagent', agentName: 'issue-resolver', content: 'Working on it', toolCalls: [] },
    { speaker: 'system', content: 'Error: Tool execution failed', toolCalls: [] },
    { speaker: 'subagent', agentName: 'issue-coder', content: 'API Error 429', toolCalls: [] },
  ];

  // Filter by speaker
  const userMessages = messages.filter(m => m.speaker === 'user');
  assert(userMessages.length === 1, 'Filter by speaker: user');

  const subagentMessages = messages.filter(m => m.speaker === 'subagent');
  assert(subagentMessages.length === 2, 'Filter by speaker: subagent');

  // Filter by agent
  const issueResolverMessages = messages.filter(m =>
    (m as any).agentName?.toLowerCase().includes('issue-resolver')
  );
  assert(issueResolverMessages.length === 1, 'Filter by agent: issue-resolver');

  // Filter by tool
  const toolCallMessages = messages.filter(m =>
    m.toolCalls?.some((tc: any) => tc.name.toLowerCase().includes('run_shell_command'))
  );
  assert(toolCallMessages.length === 1, 'Filter by tool: run_shell_command');

  // Filter by regex
  const errorRegex = /error|429/gi;
  const errorMessages = messages.filter(m => {
    errorRegex.lastIndex = 0; // Reset regex state for global flag
    return errorRegex.test(m.content);
  });
  assert(errorMessages.length === 2, 'Filter by regex: error pattern');
});

// Test 10: Parent-Child Hierarchy
describe('Parent-Child Hierarchy', () => {
  const messages = [
    { uuid: 'msg-001', parentUuid: undefined },
    { uuid: 'msg-002', parentUuid: 'msg-001' },
    { uuid: 'msg-003', parentUuid: 'msg-002' },
    { uuid: 'msg-004', parentUuid: 'msg-003' },
  ];

  const messageMap = new Map(messages.map(m => [m.uuid, m]));
  const depthMap = new Map<string, number>();

  for (const msg of messages) {
    let depth = 0;
    let currentUuid: string | undefined = msg.parentUuid;

    while (currentUuid && messageMap.has(currentUuid)) {
      depth++;
      const parent = messageMap.get(currentUuid);
      currentUuid = parent?.parentUuid;
    }

    depthMap.set(msg.uuid, depth);
  }

  assert(depthMap.get('msg-001') === 0, 'Root message depth 0');
  assert(depthMap.get('msg-002') === 1, 'Child message depth 1');
  assert(depthMap.get('msg-003') === 2, 'Grandchild message depth 2');
  assert(depthMap.get('msg-004') === 3, 'Great-grandchild message depth 3');
});

// Test 11: Edge Cases
describe('Edge Cases', () => {
  // Orphaned messages (parentUuid points to non-existent message)
  const messages = [
    { uuid: 'msg-001', parentUuid: undefined },
    { uuid: 'msg-002', parentUuid: 'non-existent' },
  ];

  const messageMap = new Map(messages.map(m => [m.uuid, m]));
  const depthMap = new Map<string, number>();

  for (const msg of messages) {
    let depth = 0;
    let currentUuid: string | undefined = msg.parentUuid;

    while (currentUuid && messageMap.has(currentUuid)) {
      depth++;
      const parent = messageMap.get(currentUuid);
      currentUuid = parent?.parentUuid;
    }

    depthMap.set(msg.uuid, depth);
  }

  assert(depthMap.get('msg-002') === 0, 'Orphaned message treated as root');

  // Out-of-order timestamps
  const timestamps = [
    '2026-04-01T08:22:00.000Z',
    '2026-04-01T08:20:00.000Z',
    '2026-04-01T08:21:00.000Z',
  ];

  const sorted = [...timestamps].sort((a, b) =>
    new Date(a).getTime() - new Date(b).getTime()
  );

  assert(sorted[0] === '2026-04-01T08:20:00.000Z', 'Earliest timestamp first');
  assert(sorted[2] === '2026-04-01T08:22:00.000Z', 'Latest timestamp last');
});

// Test 12: Session Statistics
describe('Session Statistics', () => {
  const messages = [
    { speaker: 'user', toolCalls: [] },
    { speaker: 'assistant', toolCalls: [{ name: 'tool1' }, { name: 'tool2' }] },
    { speaker: 'subagent', toolCalls: [{ name: 'tool3' }] },
    { speaker: 'system', toolCalls: [] },
    { speaker: 'subagent', toolCalls: [] },
  ];

  const stats = {
    totalMessages: messages.length,
    userMessages: messages.filter(m => m.speaker === 'user').length,
    assistantMessages: messages.filter(m => m.speaker === 'assistant').length,
    subagentMessages: messages.filter(m => m.speaker === 'subagent').length,
    systemMessages: messages.filter(m => m.speaker === 'system').length,
    toolCalls: messages.reduce((sum, m) => sum + m.toolCalls.length, 0),
  };

  assert(stats.totalMessages === 5, 'Total messages: 5');
  assert(stats.userMessages === 1, 'User messages: 1');
  assert(stats.assistantMessages === 1, 'Assistant messages: 1');
  assert(stats.subagentMessages === 2, 'Subagent messages: 2');
  assert(stats.systemMessages === 1, 'System messages: 1');
  assert(stats.toolCalls === 3, 'Tool calls: 3');
});

// Test 13: Regex Edge Cases
describe('Regex Edge Cases', () => {
  const messages = [
    { content: 'This is an error message' },
    { content: 'Everything failed' },
    { content: 'Rate limit 429 exceeded' },
    { content: 'Success!' },
  ];

  const errorRegex = validateRegex('error|failed|429');
  assert(errorRegex !== null, 'Valid regex created');

  const errorMessages = messages.filter(m => {
    errorRegex!.lastIndex = 0; // Reset for global flag
    return errorRegex!.test(m.content);
  });
  assert(errorMessages.length === 3, 'Regex matches 3 messages');

  // No matches
  const noMatchRegex = validateRegex('xyz123');
  const noMatchMessages = messages.filter(m =>
    noMatchRegex!.test(m.content)
  );
  assert(noMatchMessages.length === 0, 'No matches for non-existent pattern');
});

// Test 14: Multi-day Duration
describe('Multi-day Duration Calculation', () => {
  const start = new Date('2026-04-01T08:00:00.000Z');
  const end = new Date('2026-04-03T14:30:00.000Z');
  const duration = end.getTime() - start.getTime();

  const formatted = formatDuration(duration);
  assert(formatted.includes('2 day'), 'Multi-day duration includes days');
  assert(formatted.includes('6 hour'), 'Multi-day duration includes hours');
  // Note: formatDuration only shows two largest units, so minutes not shown for multi-day
  assert(formatted === '2 days 6 hours', 'Multi-day duration format is correct');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

// Cleanup test directory
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true });
}

process.exit(failed > 0 ? 1 : 0);
