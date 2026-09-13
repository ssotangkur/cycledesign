import { describe, it, expect } from 'vitest';
import { ChannelTypesSchema } from './types.js';

const chatMessageSchema = ChannelTypesSchema.shape.chat.shape.client.shape.message;

describe('chat channel message payload', () => {
  it('should require sessionId so user messages are saved to the correct session (issue #49)', () => {
    const missingSessionId = chatMessageSchema.safeParse({ content: 'Hello' });
    expect(missingSessionId.success).toBe(false);
  });

  it('should accept content together with sessionId', () => {
    const valid = chatMessageSchema.safeParse({ content: 'Hello', sessionId: 'session-abc123' });
    expect(valid.success).toBe(true);
  });
});

describe('chat channel history hydration (issue #170)', () => {
  const chat = ChannelTypesSchema.shape.chat;

  it('should accept a get-history request with sessionId', () => {
    const valid = chat.shape.client.shape['get-history'].safeParse({ sessionId: 'session-abc123' });
    expect(valid.success).toBe(true);
  });

  it('should reject get-history without sessionId', () => {
    expect(chat.shape.client.shape['get-history'].safeParse({}).success).toBe(false);
  });

  it('should correlate history payloads by sessionId', () => {
    const missing = chat.shape.server.shape.history.safeParse({ messages: [] });
    expect(missing.success).toBe(false);
    const valid = chat.shape.server.shape.history.safeParse({ messages: [], sessionId: 'session-abc123' });
    expect(valid.success).toBe(true);
  });

  it('should carry a stable id on live message events for dedup', () => {
    const missing = chat.shape.server.shape.message.safeParse({
      content: 'hi',
      userId: 'assistant',
      timestamp: Date.now(),
    });
    expect(missing.success).toBe(false);
    const valid = chat.shape.server.shape.message.safeParse({
      id: 'msg-1',
      content: 'hi',
      userId: 'assistant',
      timestamp: Date.now(),
    });
    expect(valid.success).toBe(true);
  });
});
describe('status channel sessions_changed event (issue #75)', () => {
  const schema = ChannelTypesSchema.shape.status.shape.server.shape.sessions_changed;

  it('should accept a sessionId payload', () => {
    const valid = schema.safeParse({ sessionId: 'session-abc123' });
    expect(valid.success).toBe(true);
  });

  it('should reject missing or non-string sessionId', () => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ sessionId: 42 }).success).toBe(false);
  });
});
