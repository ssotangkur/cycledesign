import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelMessage } from 'ai';

const state = vi.hoisted(() => ({
  constructions: [] as Array<Record<string, unknown>>,
  streamCalls: [] as Array<{ messages: ModelMessage[] }>,
  generateCalls: [] as Array<{ messages: ModelMessage[] }>,
}));

vi.mock('ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('ai')>();
  class FakeAgent {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      state.constructions.push(options);
    }
    async stream(input: { messages: ModelMessage[] }) {
      state.streamCalls.push(input);
      async function* textStream(): AsyncGenerator<string> {
        yield 'hi';
      }
      return { textStream: textStream(), toolCalls: [] };
    }
    async generate(input: { messages: ModelMessage[] }) {
      state.generateCalls.push(input);
      return { text: 'hi', toolCalls: [], usage: undefined };
    }
  }
  return { ...original, ToolLoopAgent: FakeAgent, stepCountIs: () => ({}) };
});

import { BaseProvider, splitSystemMessages } from './base-provider.js';

class TestProvider extends BaseProvider {
  readonly name = 'test' as const;
  protected async getModel(): Promise<never> {
    return {} as never;
  }
  async listModels(): Promise<{ id: string; name: string }[]> {
    return [];
  }
}

beforeEach(() => {
  state.constructions.length = 0;
  state.streamCalls.length = 0;
  state.generateCalls.length = 0;
  delete process.env.LOCAL_LLM_DEBUG;
});

describe('splitSystemMessages', () => {
  it('should merge duplicate systems and strip them from messages (issue #169)', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'default instructions' },
      { role: 'system', content: 'stored SYSTEM_PROMPT' },
      { role: 'user', content: 'hi' },
    ];
    const { systemText, nonSystemMessages } = splitSystemMessages(messages);
    expect(systemText).toBe('default instructions\n\nstored SYSTEM_PROMPT');
    expect(nonSystemMessages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(nonSystemMessages.some((m) => m.role === 'system')).toBe(false);
  });

  it('should handle array content and return undefined when no system present', () => {
    const withArray: ModelMessage[] = [
      {
        role: 'system',
        content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
      } as unknown as ModelMessage,
      { role: 'user', content: 'hi' },
    ];
    expect(splitSystemMessages(withArray).systemText).toBe('ab');

    const none: ModelMessage[] = [{ role: 'user', content: 'hi' }];
    const result = splitSystemMessages(none);
    expect(result.systemText).toBeUndefined();
    expect(result.nonSystemMessages).toHaveLength(1);
  });
});

describe('BaseProvider.executeComplete single-system (issue #169)', () => {
  it('should send stored system via instructions, not as a second system message', async () => {
    const provider = new TestProvider();
    const messages: ModelMessage[] = [
      { role: 'system', content: 'stored SYSTEM_PROMPT' },
      { role: 'user', content: 'hi' },
    ];
    await provider.complete(messages, { stream: true, tools: {} });

    // One agent construction carrying the system text as instructions…
    expect(state.constructions).toHaveLength(1);
    expect(state.constructions[0].instructions).toBe('stored SYSTEM_PROMPT');
    // …and the wire messages contain no system role at all.
    expect(state.streamCalls).toHaveLength(1);
    expect(state.streamCalls[0].messages.map((m) => m.role)).toEqual(['user']);
  });

  it('should honor systemText on the cached (no-tools) path instead of dropping it', async () => {
    const provider = new TestProvider();
    const messages: ModelMessage[] = [
      { role: 'system', content: 'stored SYSTEM_PROMPT' },
      { role: 'user', content: 'hi' },
    ];
    await provider.complete(messages);

    expect(state.constructions).toHaveLength(1);
    expect(state.constructions[0].instructions).toBe('stored SYSTEM_PROMPT');
    expect(state.generateCalls).toHaveLength(1);
    expect(state.generateCalls[0].messages.map((m) => m.role)).toEqual(['user']);
  });
});
