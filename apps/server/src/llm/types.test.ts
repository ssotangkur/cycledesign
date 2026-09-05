import { describe, it, expect } from 'vitest';
import { getStoredMessageRole, getStoredMessageText, toModelMessage, type StoredMessage } from './types.js';

function makeMessage(modelMessage: StoredMessage['modelMessage']): StoredMessage {
  return { id: 'msg-1', timestamp: 123, modelMessage };
}

describe('getStoredMessageRole', () => {
  it('should return role from modelMessage', () => {
    expect(getStoredMessageRole(makeMessage({ role: 'user', content: 'hi' }))).toBe('user');
    expect(getStoredMessageRole(makeMessage({ role: 'system', content: 'sys' }))).toBe('system');
    expect(getStoredMessageRole(makeMessage({ role: 'assistant', content: 'hello' }))).toBe('assistant');
  });

  it('should fall back to legacy top-level role for old JSONL entries', () => {
    const legacy = {
      id: 'msg-old',
      timestamp: 1,
      role: 'user',
      content: 'old hello',
    } as unknown as StoredMessage;
    expect(getStoredMessageRole(legacy)).toBe('user');
  });
});

describe('getStoredMessageText', () => {
  it('should return string content as-is', () => {
    expect(getStoredMessageText(makeMessage({ role: 'user', content: 'hello' }))).toBe('hello');
  });

  it('should join text parts of array content', () => {
    expect(
      getStoredMessageText(
        makeMessage({
          role: 'user',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world' },
          ],
        })
      )
    ).toBe('Hello world');
  });

  it('should fall back to legacy top-level content for old JSONL entries', () => {
    const legacy = {
      id: 'msg-old',
      timestamp: 1,
      role: 'user',
      content: 'legacy text',
    } as unknown as StoredMessage;
    expect(getStoredMessageText(legacy)).toBe('legacy text');
  });

  it('should return empty string when content is missing', () => {
    const empty = { id: 'msg-x', timestamp: 1 } as unknown as StoredMessage;
    expect(getStoredMessageText(empty)).toBe('');
  });
});

describe('toModelMessage', () => {
  it('should pass through modelMessage as-is', () => {
    const msg = makeMessage({ role: 'assistant', content: 'hi' });
    expect(toModelMessage(msg)).toBe(msg.modelMessage);
  });

  it('should rebuild legacy rows without modelMessage', () => {
    const legacy = {
      id: 'msg-old',
      timestamp: 1,
      role: 'user',
      content: 'legacy hi',
    } as unknown as StoredMessage;
    expect(toModelMessage(legacy)).toEqual({ role: 'user', content: 'legacy hi' });
  });

  it('should return null for rows with no usable content', () => {
    const corrupt = { id: 'msg-x', timestamp: 1 } as unknown as StoredMessage;
    expect(toModelMessage(corrupt)).toBeNull();
  });

  it('should return null for passthrough rows with missing content', () => {
    const badPassthrough = {
      id: 'msg-bad',
      timestamp: 1,
      modelMessage: { role: 'user' },
    } as unknown as StoredMessage;
    expect(toModelMessage(badPassthrough)).toBeNull();
  });

  it('should return null for passthrough rows with unknown roles', () => {
    const badRole = {
      id: 'msg-bad',
      timestamp: 1,
      modelMessage: { role: 'superuser', content: 'hi' },
    } as unknown as StoredMessage;
    expect(toModelMessage(badRole)).toBeNull();
  });

  it('should return null for passthrough rows with wrong-type content', () => {
    const numeric = {
      id: 'msg-bad',
      timestamp: 1,
      modelMessage: { role: 'user', content: 42 },
    } as unknown as StoredMessage;
    expect(toModelMessage(numeric)).toBeNull();

    const objectContent = {
      id: 'msg-bad',
      timestamp: 1,
      modelMessage: { role: 'user', content: { text: 'hi' } },
    } as unknown as StoredMessage;
    expect(toModelMessage(objectContent)).toBeNull();
  });

  it('should handle valid-JSON wrong-shape rows without throwing', () => {
    const nullRow = null as unknown as StoredMessage;
    expect(toModelMessage(nullRow)).toBeNull();
    expect(getStoredMessageRole(nullRow)).toBeUndefined();
    expect(getStoredMessageText(nullRow)).toBe('');
  });

  it('should return undefined role for corrupt rows instead of defaulting to user', () => {
    const empty = { id: 'msg-x', timestamp: 1 } as unknown as StoredMessage;
    expect(getStoredMessageRole(empty)).toBeUndefined();
  });
});
