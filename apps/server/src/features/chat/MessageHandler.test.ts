import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ServerChannel, ChannelTypes } from '@cycledesign/common-protocol';
import { MessageHandler } from './MessageHandler.js';
import { createSession, deleteSession, getSession, getMessages } from '../../sessions/storage.js';

// Fail LLM streaming immediately: it has network retries that would hang tests.
// The user message is persisted before streaming starts, which is what is asserted here.
vi.mock('../../llm/providers/provider-factory.js', () => ({
  getLLMProvider: () => ({
    name: 'mock-test-provider',
    complete: async () => {
      throw new Error('LLM unavailable in tests');
    },
  }),
}));

/**
 * Regression tests for issue #49: user messages must be saved to the
 * sessionId from the payload (previously hardcoded to 'default', so
 * firstMessage was never set on the real session and the label never updated).
 *
 * Note: the LLM streaming step is expected to fail in tests (no provider
 * credentials). That failure is swallowed by design - the user message is
 * persisted before streaming starts, which is what these tests assert.
 */
describe('MessageHandler session routing (issue #49)', () => {
  const createdSessionIds: string[] = [];

  afterEach(async () => {
    await Promise.all(createdSessionIds.splice(0).map((id) => deleteSession(id)));
  });

  function createChatHandler() {
    const handler = new MessageHandler();
    const channel = { id: 'test-channel' } as unknown as ServerChannel<ChannelTypes['chat']>;
    return handler.createChatChannelHandler(channel);
  }

  it('should save the user message to the sessionId from the payload', async () => {
    const session = await createSession();
    createdSessionIds.push(session.id);
    const chat = createChatHandler();

    await chat.message({ content: 'Hello, routing test', sessionId: session.id });

    const messages = await getMessages(session.id);
    expect(messages.some((m) => m.role === 'user' && m.content === 'Hello, routing test')).toBe(true);
  });

  it('should surface the first user message as firstMessage for the label', async () => {
    const session = await createSession();
    createdSessionIds.push(session.id);
    const chat = createChatHandler();

    await chat.message({ content: 'Label seed message', sessionId: session.id });

    const meta = await getSession(session.id);
    expect(meta?.firstMessage).toBe('Label seed message');
  });

  it('should reject empty and path-traversal sessionIds without writing', async () => {
    const chat = createChatHandler();

    await chat.message({ content: 'evil', sessionId: '../../evil' });
    await chat.message({ content: 'empty', sessionId: '' });

    expect(await getMessages('../../evil')).toEqual([]);
  });
});
