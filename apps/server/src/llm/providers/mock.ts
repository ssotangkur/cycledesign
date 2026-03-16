import { ModelMessage, ToolSet } from 'ai';
import { IProvider, IProviderConfig, LLMResponse } from '../types.js';

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

  async complete(
    messages: ModelMessage[],
    _options?: {
      stream?: boolean;
      maxRetries?: number;
      tools?: ToolSet;
    }
  ): Promise<LLMResponse> {
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
          toolCallId: 'mock-tool-1',
          toolName: 'create_file',
          args: {
            filename: 'test.tsx',
            code: 'export default function Test() { return <div>Hello</div>; }',
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
          toolCallId: 'mock-tool-1',
          toolName: 'edit_file',
          args: {
            filename: 'test.tsx',
            code: 'export default function Updated() { return <div>Updated</div>; }',
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
