import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerChannel, ChannelTypes } from '@cycledesign/common-protocol';
import type { StoredMessage } from '../../llm/types.js';
import type { ModelMessage } from 'ai';

const state = vi.hoisted(() => ({
  store: [] as StoredMessage[],
  completeCalls: [] as ModelMessage[][],
  idCounter: 0,
  toolCallQueue: [] as Array<Array<{ id: string; name: string; args: Record<string, unknown> }>>,
  validateCalls: [] as string[],
  failNextCompleteWith: null as string | null,
  omitStreamOnce: false,
}));

vi.mock('../../sessions/storage.js', () => ({
  // Deliberately raw (no filtering): the real getMessages filters non-object
  // rows, but the handler must survive them anyway if they ever arrive.
  getMessages: vi.fn(async () => [...state.store]),
  addMessage: vi.fn(async (_sessionId: string, msg: StoredMessage) => {
    state.store.push(msg);
  }),
  generateMessageId: vi.fn(() => `msg-test-${++state.idCounter}`),
}));

vi.mock('../../llm/providers/provider-factory.js', () => ({
  getLLMProvider: () => ({
    complete: vi.fn(async (messages: ModelMessage[]) => {
      if (state.failNextCompleteWith) {
        const message = state.failNextCompleteWith;
        state.failNextCompleteWith = null;
        throw new Error(message);
      }
      if (state.omitStreamOnce) {
        state.omitStreamOnce = false;
        state.completeCalls.push(messages);
        const toolCalls = state.toolCallQueue.shift() ?? [];
        return { toolCalls };
      }
      state.completeCalls.push(messages);
      async function* stream(): AsyncGenerator<string> {
        yield 'mock reply';
      }
      const toolCalls = state.toolCallQueue.shift() ?? [];
      return { stream: stream(), toolCalls };
    }),
  }),
}));

vi.mock('../../validation/validation-service.js', () => ({
  ValidationService: class {
    validateAndPreparePreview = vi.fn(async (id: string) => {
      state.validateCalls.push(id);
    });
  },
}));

vi.mock('../../llm/tool-executor.js', () => ({
  executeToolCalls: vi.fn(async () => undefined),
}));

vi.mock('../../llm/tools/tools.js', () => ({
  allTools: {},
}));

vi.mock('../status/StatusBroadcaster.js', () => ({
  statusBroadcaster: {
    sendGenerationStart: vi.fn(),
    sendGenerationComplete: vi.fn(),
    sendPreviewError: vi.fn(),
    sendSessionsChanged: vi.fn(),
  },
}));

import { MessageHandler } from './MessageHandler.js';
import { addMessage } from '../../sessions/storage.js';
import { statusBroadcaster } from '../status/StatusBroadcaster.js';

function fakeChannel(): ServerChannel<ChannelTypes['chat']> {
  return { id: 'channel-1', send: vi.fn() } as unknown as ServerChannel<ChannelTypes['chat']>;
}

// The chat protocol requires sessionId on every message payload (issue #49).
const TEST_SESSION_ID = 'session-test-1';

beforeEach(() => {
  state.store.length = 0;
  state.completeCalls.length = 0;
  state.idCounter = 0;
  state.toolCallQueue.length = 0;
  state.validateCalls.length = 0;
  state.failNextCompleteWith = null;
  state.omitStreamOnce = false;
  vi.mocked(statusBroadcaster.sendSessionsChanged).mockClear();
  vi.mocked(statusBroadcaster.sendGenerationStart).mockClear();
  vi.mocked(statusBroadcaster.sendGenerationComplete).mockClear();
  vi.mocked(statusBroadcaster.sendPreviewError).mockClear();
});

describe('MessageHandler system message handling', () => {
  it('should store the system message only once across multiple user messages', async () => {
    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());

    await handler.message({ content: 'first', sessionId: TEST_SESSION_ID });
    await handler.message({ content: 'second', sessionId: TEST_SESSION_ID });

    const systemMsgs = state.store.filter((m) => m.modelMessage.role === 'system');
    expect(systemMsgs).toHaveLength(1);

    const userMsgs = state.store.filter((m) => m.modelMessage.role === 'user');
    expect(userMsgs.map((m) => m.modelMessage.content)).toEqual(['first', 'second']);
  });

  it('should not duplicate a system message from a previous server run', async () => {
    state.store.push({
      id: 'msg-existing-sys',
      timestamp: Date.now(),
      modelMessage: { role: 'system', content: 'existing prompt' },
    });

    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'hello', sessionId: TEST_SESSION_ID });

    expect(state.store.filter((m) => m.modelMessage.role === 'system')).toHaveLength(1);
  });

  it('should send the stored system message first to the LLM', async () => {
    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'hello', sessionId: TEST_SESSION_ID });

    expect(state.completeCalls).toHaveLength(1);
    expect(state.completeCalls[0][0].role).toBe('system');
    expect(state.completeCalls[0].at(-1)).toMatchObject({ role: 'user', content: 'hello' });
  });

  it('should store messages without duplicated top-level role/content', async () => {
    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'hello', sessionId: TEST_SESSION_ID });

    expect(state.store.length).toBeGreaterThan(0);
    for (const msg of state.store) {
      expect('role' in msg).toBe(false);
      expect('content' in msg).toBe(false);
      expect(msg.modelMessage.role).toBeDefined();
    }
  });

  it('should rebuild legacy rows without modelMessage instead of crashing', async () => {
    state.store.push({
      id: 'msg-legacy',
      timestamp: Date.now(),
      role: 'user',
      content: 'legacy hi',
    } as unknown as StoredMessage);

    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'hello', sessionId: TEST_SESSION_ID });

    expect(state.completeCalls).toHaveLength(1);
    expect(state.completeCalls[0]).toContainEqual({ role: 'user', content: 'legacy hi' });
  });

  it('should skip corrupt stored rows without crashing', async () => {
    state.store.push({ id: 'msg-corrupt', timestamp: Date.now() } as unknown as StoredMessage);

    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'hello', sessionId: TEST_SESSION_ID });

    expect(state.completeCalls).toHaveLength(1);
    for (const m of state.completeCalls[0]) {
      expect(m).toBeDefined();
    }
  });

  it('should survive non-object rows even if storage returns them', async () => {
    state.store.push(null as unknown as StoredMessage);
    state.store.push(42 as unknown as StoredMessage);

    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'hello', sessionId: TEST_SESSION_ID });

    // No crash (including in the skip-warn logging path), and only valid
    // messages reach the LLM.
    expect(state.completeCalls).toHaveLength(1);
    expect(state.completeCalls[0].every((m) => m && typeof m === 'object')).toBe(true);
  });

  it('should skip passthrough rows with missing content without crashing', async () => {
    state.store.push({
      id: 'msg-bad',
      timestamp: Date.now(),
      modelMessage: { role: 'user' },
    } as unknown as StoredMessage);

    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'hello', sessionId: TEST_SESSION_ID });

    expect(state.completeCalls).toHaveLength(1);
    expect(state.completeCalls[0]).toHaveLength(2); // system + new user only
    for (const m of state.completeCalls[0]) {
      expect(m).toBeDefined();
    }
  });
});

describe('MessageHandler validation trigger', () => {
  it('should trigger validation when the LLM makes tool calls', async () => {
    state.toolCallQueue.push([{ id: 'tc-1', name: 'create-file', args: { path: 'a.txt' } }]);

    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'make a file', sessionId: TEST_SESSION_ID });

    // msg-test-1 is the system message, msg-test-2 the just-handled user message
    expect(state.validateCalls).toEqual(['msg-test-2']);
  });

  it('should not trigger validation when no tool calls are made', async () => {
    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'hello', sessionId: TEST_SESSION_ID });

    expect(state.validateCalls).toHaveLength(0);
  });
});

describe('MessageHandler missing tool args (issue #169)', () => {
  it('should persist the need-more-info assistant reply so history stays alternating', async () => {
    state.toolCallQueue.push([{ id: 'tc-1', name: 'create_file', args: {} }]);

    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'make a hello world page', sessionId: TEST_SESSION_ID });

    const roles = state.store.map((m) => m.modelMessage.role);
    expect(roles).toEqual(['system', 'user', 'assistant']);
    const last = state.store.at(-1);
    expect(last?.modelMessage.role).toBe('assistant');
    expect(String((last?.modelMessage as { content: unknown }).content)).toMatch(
      /additional parameters/
    );
  });

  it('should keep alternating history across the follow-up user message', async () => {
    state.toolCallQueue.push([{ id: 'tc-1', name: 'create_file', args: {} }]);

    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'make a page', sessionId: TEST_SESSION_ID });
    await handler.message({ content: 'decide yourself', sessionId: TEST_SESSION_ID });

    const roles = state.store.map((m) => m.modelMessage.role);
    for (let i = 1; i < roles.length; i++) {
      expect(roles[i] === roles[i - 1] && roles[i] === 'user').toBe(false);
    }
    expect(roles.at(-2)).toBe('user');
    expect(roles.at(-1)).toBe('assistant');
  });
});

describe('MessageHandler error persistence (issue #169)', () => {
  it('should persist an error marker so a failed turn does not orphan the user row', async () => {
    state.failNextCompleteWith = 'boom';

    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'hello', sessionId: TEST_SESSION_ID });

    const roles = state.store.map((m) => m.modelMessage.role);
    expect(roles).toEqual(['system', 'user', 'assistant']);
    const last = state.store.at(-1);
    expect(String((last?.modelMessage as { content: unknown }).content)).toMatch(/boom/);
    expect(statusBroadcaster.sendPreviewError).toHaveBeenCalled();
  });

  it('should keep alternating history across the follow-up after a failure', async () => {
    state.failNextCompleteWith = 'boom';

    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'hello', sessionId: TEST_SESSION_ID });
    await handler.message({ content: 'retry hello', sessionId: TEST_SESSION_ID });

    const roles = state.store.map((m) => m.modelMessage.role);
    for (let i = 1; i < roles.length; i++) {
      expect(roles[i] === roles[i - 1] && roles[i] === 'user').toBe(false);
    }
    expect(roles.at(-2)).toBe('user');
    expect(roles.at(-1)).toBe('assistant');
  });

  it('should persist an error marker when the provider returns no stream', async () => {
    state.omitStreamOnce = true;

    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'hello', sessionId: TEST_SESSION_ID });

    const roles = state.store.map((m) => m.modelMessage.role);
    expect(roles).toEqual(['system', 'user', 'assistant']);
    const last = state.store.at(-1);
    expect(String((last?.modelMessage as { content: unknown }).content)).toMatch(
      /Stream not available/
    );
    expect(statusBroadcaster.sendPreviewError).toHaveBeenCalled();
  });
});

describe('MessageHandler conversation accumulation (issue #169)', () => {
  it('should send the full prior history on each subsequent turn', async () => {
    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'first hello', sessionId: TEST_SESSION_ID });
    await handler.message({ content: 'second hello', sessionId: TEST_SESSION_ID });

    // One provider call per user turn (no tools → single loop iteration).
    expect(state.completeCalls).toHaveLength(2);
    expect(state.completeCalls[0].map((m) => m.role)).toEqual(['system', 'user']);
    expect(state.completeCalls[1].map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(state.completeCalls[1].map((m) => m.content)).toEqual([
      state.completeCalls[1][0].content, // system prompt text (large, don't pin)
      'first hello',
      'mock reply',
      'second hello',
    ]);
  });

  it('should include persisted missing-args and error replies in later turns, in order', async () => {
    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());
    await handler.message({ content: 'make a page', sessionId: TEST_SESSION_ID });

    // Turn 2 hits the missing-args break → persisted need-more-info assistant.
    state.toolCallQueue.push([{ id: 'tc-1', name: 'create_file', args: {} }]);
    await handler.message({ content: 'page details', sessionId: TEST_SESSION_ID });

    // Turn 3 fails → persisted error marker (failed calls record no completeCall).
    state.failNextCompleteWith = 'boom';
    await handler.message({ content: 'another question', sessionId: TEST_SESSION_ID });

    // Turn 4 succeeds → its provider call must carry every prior message, ordered.
    await handler.message({ content: 'final question', sessionId: TEST_SESSION_ID });

    expect(state.completeCalls).toHaveLength(3);
    const lastCall = state.completeCalls.at(-1);
    expect(lastCall?.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    const contents = (lastCall ?? []).map((m) => String((m as { content: unknown }).content));
    expect(contents[1]).toBe('make a page');
    expect(contents[2]).toBe('mock reply');
    expect(contents[3]).toBe('page details');
    expect(contents[4]).toMatch(/additional parameters/);
    expect(contents[5]).toBe('another question');
    expect(contents[6]).toMatch(/boom/);
    expect(contents[7]).toBe('final question');
  });
});

describe('MessageHandler getSessionHistory (issue #170)', () => {
  it('should hydrate user and assistant turns in file order with stored id/timestamp', async () => {
    state.store.push(
      { id: 'msg-sys', timestamp: 1000, modelMessage: { role: 'system', content: 'prompt' } },
      { id: 'msg-u1', timestamp: 1001, modelMessage: { role: 'user', content: 'hello' } },
      { id: 'msg-a1', timestamp: 1002, modelMessage: { role: 'assistant', content: 'hi there' } },
    );

    const history = await new MessageHandler().getSessionHistory(TEST_SESSION_ID);

    expect(history).toEqual([
      { id: 'msg-u1', content: 'hello', userId: 'user', timestamp: 1001 },
      { id: 'msg-a1', content: 'hi there', userId: 'assistant', timestamp: 1002 },
    ]);
  });

  it('should skip system/tool/empty/corrupt rows with a warn instead of crashing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      state.store.push(
        { id: 'msg-sys', timestamp: 1, modelMessage: { role: 'system', content: 'prompt' } },
        { id: 'msg-tool', timestamp: 2, modelMessage: { role: 'tool', content: [] } } as unknown as StoredMessage,
        { id: 'msg-empty', timestamp: 3, modelMessage: { role: 'user', content: '' } },
        { id: 'msg-bad', timestamp: 4, modelMessage: { role: 'user' } } as unknown as StoredMessage,
        null as unknown as StoredMessage,
        42 as unknown as StoredMessage,
        { id: 'msg-ok', timestamp: 5, modelMessage: { role: 'user', content: 'kept' } },
      );

      const history = await new MessageHandler().getSessionHistory(TEST_SESSION_ID);

      expect(history).toEqual([{ id: 'msg-ok', content: 'kept', userId: 'user', timestamp: 5 }]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('should return [] for missing or path-traversal sessionIds without throwing', async () => {
    const handler = new MessageHandler();

    await expect(handler.getSessionHistory('')).resolves.toEqual([]);
    await expect(handler.getSessionHistory('../../evil')).resolves.toEqual([]);
    await expect(handler.getSessionHistory('a/b')).resolves.toEqual([]);
    await expect(handler.getSessionHistory('a\\b')).resolves.toEqual([]);
    expect(state.store).toHaveLength(0);
  });

  it('should serve persisted history correlated by sessionId on get-history', async () => {
    state.store.push(
      { id: 'msg-u1', timestamp: 1001, modelMessage: { role: 'user', content: 'hello' } },
    );

    const channel = fakeChannel();
    const handler = new MessageHandler().createChatChannelHandler(channel);
    await handler['get-history']({ sessionId: TEST_SESSION_ID });

    expect(channel.send).toHaveBeenCalledWith('history', {
      messages: [{ id: 'msg-u1', content: 'hello', userId: 'user', timestamp: 1001 }],
      sessionId: TEST_SESSION_ID,
    });
  });

  it('should broadcast live messages with the stored id so clients id-match the snapshot', async () => {
    const seen: Array<{ id: string; content: string }> = [];
    const messageHandler = new MessageHandler();
    messageHandler.onMessage((msg) => seen.push(msg));
    const handler = messageHandler.createChatChannelHandler(fakeChannel());

    await handler.message({ content: 'hello', sessionId: TEST_SESSION_ID });

    const storedUser = state.store.find((m) => m.modelMessage.role === 'user');
    const liveUser = seen.find((m) => m.content === 'hello');
    expect(storedUser).toBeDefined();
    expect(liveUser?.id).toBe(storedUser?.id);
  });
});

describe('MessageHandler session routing (issue #49)', () => {
  it('should save the user message to the sessionId from the payload', async () => {
    vi.mocked(addMessage).mockClear();
    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());

    await handler.message({ content: 'Hello, routing test', sessionId: 'session-abc123' });

    expect(addMessage).toHaveBeenCalledWith(
      'session-abc123',
      expect.objectContaining({ modelMessage: { role: 'user', content: 'Hello, routing test' } }),
    );
  });
  it('should reject empty and path-traversal sessionIds without writing', async () => {
    vi.mocked(addMessage).mockClear();

    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());

    await handler.message({ content: 'evil', sessionId: '../../evil' });
    await handler.message({ content: 'empty', sessionId: '' });

    expect(addMessage).not.toHaveBeenCalled();
  });
});

describe('MessageHandler sessions_changed push (issue #75)', () => {
  it('should emit sessions_changed once on the first user message', async () => {
    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());

    await handler.message({ content: 'first', sessionId: TEST_SESSION_ID });

    expect(statusBroadcaster.sendSessionsChanged).toHaveBeenCalledTimes(1);
    expect(statusBroadcaster.sendSessionsChanged).toHaveBeenCalledWith(TEST_SESSION_ID);
  });

  it('should stay silent on the second user message', async () => {
    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());

    await handler.message({ content: 'first', sessionId: TEST_SESSION_ID });
    vi.mocked(statusBroadcaster.sendSessionsChanged).mockClear();

    await handler.message({ content: 'second', sessionId: TEST_SESSION_ID });

    expect(statusBroadcaster.sendSessionsChanged).not.toHaveBeenCalled();
  });

  it('should not emit when sessionId is rejected', async () => {
    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());

    await handler.message({ content: 'evil', sessionId: '../../evil' });

    expect(statusBroadcaster.sendSessionsChanged).not.toHaveBeenCalled();
  });

  it('should push before the (possibly slow) LLM stream completes', async () => {
    const handler = new MessageHandler().createChatChannelHandler(fakeChannel());

    await handler.message({ content: 'first', sessionId: TEST_SESSION_ID });

    // The push fires right after user-message persist, ahead of the
    // generation_complete that only follows the LLM stream — so the label
    // can update even under a very slow LLM (issue #75 slow-network case).
    expect(statusBroadcaster.sendSessionsChanged).toHaveBeenCalledTimes(1);
    expect(statusBroadcaster.sendGenerationComplete).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(statusBroadcaster.sendSessionsChanged).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(statusBroadcaster.sendGenerationComplete).mock.invocationCallOrder[0],
    );
  });
});
