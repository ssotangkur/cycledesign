import { ModelMessage, ToolSet } from 'ai';

export interface StoredMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  timestamp: number;

  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;

  toolCallId?: string;

  tokenCount?: number;
}

export interface LLMResponse {
  content: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  stream?: AsyncIterable<string>;
}

export interface IProvider {
  readonly name: string;
  complete(messages: ModelMessage[], options?: {
    stream?: boolean;
    maxRetries?: number;
    tools?: ToolSet;
  }): Promise<LLMResponse>;
  listModels(): Promise<{ id: string; name: string }[]>;
}

export interface IProviderConfig {
  model?: string;
  apiKey?: string;
}

export interface IProviderClass {
  new(): IProvider;
  name(): string;
  displayName(): string;
  requiresApiKey(): boolean;
  loadConfig(): IProviderConfig;
  saveConfig(config: IProviderConfig): void;
  hasApiKey?(): boolean;
}
