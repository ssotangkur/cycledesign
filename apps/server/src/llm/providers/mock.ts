import { ModelMessage, ToolSet } from 'ai';
import { IProvider, IProviderConfig, LLMResponse } from '../types.js';
import { normalizeToolName } from '../tools/tools.js';

export interface MockScriptEntry {
  name: string;
  args?: Record<string, unknown>;
  id?: string;
  error?: string;
  content?: string;
}

const MOCK_CREATE_CODE = 'export default function Test() { return <div>Hello</div>; }';

const MOCK_EDIT_PATCH = [
  '--- a/test.tsx',
  '+++ b/test.tsx',
  '@@ -1 +1 @@',
  '-export default function Test() { return <div>Hello</div>; }',
  '+export default function Updated() { return <div>Updated</div>; }',
].join('\n');

export class MockProvider implements IProvider {
  readonly name = 'mock' as const;

  static name(): string {
    return 'mock';
  }

  static displayName(): string {
    return 'Mock Provider';
  }

  static requiresApiKey(): boolean {
    return false;
  }

  static hasApiKey(): boolean {
    return false;
  }

  static saveConfig(_config: IProviderConfig): void {
    // Mock provider doesn't need config persistence
  }

  static loadConfig(): IProviderConfig {
    return { model: 'mock-model' };
  }

  private scriptQueue: MockScriptEntry[] = [];

  /**
   * Queue scripted tool calls for deterministic tests (issue #138, KD-5).
   * Empty queue falls back to keyword behavior so existing suites keep passing.
   */
  setScript(entries: MockScriptEntry[]): void {
    this.scriptQueue = [...entries];
  }

  clearScript(): void {
    this.scriptQueue = [];
  }

  async complete(
    messages: ModelMessage[],
    options?: {
      stream?: boolean;
      maxRetries?: number;
      tools?: ToolSet;
    }
  ): Promise<LLMResponse> {
    // Scripted queue takes precedence for deterministic tests (issue #138, KD-5).
    if (this.scriptQueue.length > 0) {
      const entry = this.scriptQueue.shift()!;
      if (entry.error) {
        throw new Error(entry.error);
      }
      const normalizedName = normalizeToolName(entry.name);
      if (options?.tools) {
        const requested = new Set(
          Object.keys(options.tools).map((k) => normalizeToolName(k))
        );
        if (!requested.has(normalizedName)) {
          throw new Error(
            `Mock script tool '${entry.name}' not in requested tools (${[...requested].join(', ') || 'none'})`
          );
        }
      }
      const content = entry.content ?? `Mock scripted ${normalizedName}`;
      console.log('[MockProvider] Returning scripted tool call:', normalizedName);
      return {
        content,
        stream: this.generateChunks(content),
        toolCalls: [{
          id: entry.id ?? 'mock-script-1',
          name: normalizedName,
          args: entry.args ?? {},
        }],
      };
    }

    const lastMessage = messages[messages.length - 1];
    const prompt = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : Array.isArray(lastMessage.content)
        ? lastMessage.content.map(c => 'text' in c && typeof c.text === 'string' ? c.text : '').join('')
        : '';

    console.log('[MockProvider] Received prompt:', prompt);
    console.log('[MockProvider] Prompt length:', prompt.length);
    console.log('[MockProvider] Lower prompt:', prompt.toLowerCase());

    const lowerPrompt = prompt.toLowerCase();

    // Deterministic responses based on prompt patterns
    if (lowerPrompt.includes('create file') || lowerPrompt.includes('create_file') ||
        lowerPrompt.includes('hello world') || lowerPrompt.includes('create app')) {
      console.log('[MockProvider] Matching "create file/hello world" pattern - returning tool call');
      return {
        content: 'I will create a file for you.',
        stream: this.generateChunks('I will create a file for you.'),
        toolCalls: [{
          id: 'mock-tool-1',
          name: 'create_file',
          args: {
            filename: 'test.tsx',
            code: MOCK_CREATE_CODE,
          },
        }],
      };
    }

    if (lowerPrompt.includes('edit') || lowerPrompt.includes('update')) {
      console.log('[MockProvider] Matching "edit/update" pattern - returning tool call');
      return {
        content: 'I will edit the file.',
        stream: this.generateChunks('I will edit the file.'),
        toolCalls: [{
          id: 'mock-tool-1',
          name: 'edit_file',
          args: {
            filename: 'test.tsx',
            patch: MOCK_EDIT_PATCH,
          },
        }],
      };
    }

    console.log('[MockProvider] No pattern matched - returning default response');
    // Default response - no tool calls
    return {
      content: 'This is a mock response from the MockProvider. How can I help you today?',
      stream: this.generateChunks('This is a mock response from the MockProvider. How can I help you today?'),
      toolCalls: [],
    };
  }

  async listModels(): Promise<{ id: string; name: string }[]> {
    return [{ id: 'mock-model', name: 'Mock Model' }];
  }

  private async *generateChunks(text: string): AsyncIterable<string> {
    const words = text.split(' ');
    for (const word of words) {
      yield word + ' ';
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }
}
