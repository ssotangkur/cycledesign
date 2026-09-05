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
