import { ToolLoopAgent, stepCountIs, type ToolSet, type ModelMessage, LanguageModel } from 'ai';
import { IProvider, LLMResponse } from '../types.js';

export interface BaseProviderOptions {
  tools?: ToolSet;
  systemText?: string;
}

export interface AgentConfig {
  instructions?: string;
  temperature?: number;
  maxOutputTokens?: number;
  maxRetries?: number;
  onStepFinish?: (event: {
    usage?: { totalTokens?: number };
    toolCalls?: Array<{ toolName: string }>;
    finishReason: string;
  }) => Promise<void>;
}

export abstract class BaseProvider implements IProvider {
  abstract readonly name: string;
  protected cachedAgent: ToolLoopAgent | null = null;

  protected abstract getModel(): Promise<LanguageModel>;

  protected createAgentConfig(): AgentConfig {
    return {
      instructions: 'You are a helpful coding assistant.',
      temperature: 0.1,
      maxOutputTokens: 8192,
      maxRetries: 2,
    };
  }

  protected async getAgent(options?: BaseProviderOptions): Promise<ToolLoopAgent> {
    // If tools provided → create scoped agent (not cached)
    if (options?.tools) {
      return new ToolLoopAgent({
        model: await this.getModel(),
        instructions: options.systemText,
        tools: options.tools,
        stopWhen: stepCountIs(10),
        ...this.createAgentConfig(),
      });
    }

    // Return cached agent for default usage
    if (this.cachedAgent) return this.cachedAgent;

    this.cachedAgent = new ToolLoopAgent({
      model: await this.getModel(),
      instructions: 'You are a helpful coding assistant.',
      stopWhen: stepCountIs(10),
      ...this.createAgentConfig(),
    });

    return this.cachedAgent;
  }

  /**
   * Optional hook for providers that need pre-call setup (e.g., Qwen auth)
   * Override this method in subclasses that need retry/auth logic
   */
  protected async beforeComplete?(): Promise<{
    maxRetries: number;
    onError?: (error: unknown, attempt: number) => Promise<boolean>;
  }>;

  async complete(
    messages: ModelMessage[],
    options?: { tools?: ToolSet; stream?: boolean; maxRetries?: number }
  ): Promise<LLMResponse> {
    // Check if subclass has beforeComplete hook (e.g., Qwen for auth/retry)
    const retryConfig = await this.beforeComplete?.();
    const maxRetries = retryConfig?.maxRetries ?? (options?.maxRetries ?? 3);

    if (retryConfig) {
      // Use retry loop for providers that need it (Qwen)
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await this.executeComplete(messages, options);
        } catch (error: unknown) {
          lastError = error as Error;
          const shouldContinue = await retryConfig.onError?.(error, attempt);
          if (!shouldContinue) break;
        }
      }

      throw lastError || new Error('Max retries exceeded');
    } else {
      // Simple execution for providers without retry logic (Mistral)
      return await this.executeComplete(messages, options);
    }
  }

  private async executeComplete(
    messages: ModelMessage[],
    options?: { tools?: ToolSet; stream?: boolean }
  ): Promise<LLMResponse> {
    // Extract system message if present
    const systemMessage = messages.find(m => m.role === 'system') as
      { role: 'system', content: string | Array<{ type: 'text', text: string }> } | undefined;
    const userMessages = messages.filter(m => m.role !== 'system');

    // Extract text from system message content (handle both string and array formats)
    const systemText = typeof systemMessage?.content === 'string'
      ? systemMessage.content
      : Array.isArray(systemMessage?.content)
        ? systemMessage.content.map(c => c.text).join('')
        : undefined;

    const agent = await this.getAgent({ tools: options?.tools, systemText });

    if (options?.stream) {
      const result = await agent.stream({ messages: userMessages });
      const toolCalls = await result.toolCalls;
      return {
        stream: result.textStream,
        content: '',
        toolCalls: toolCalls
          ? toolCalls.map((tc) => ({
            id: tc.toolCallId,
            name: tc.toolName,
            args: (tc.input ?? {}) as Record<string, unknown>,
          }))
          : [],
      };
    } else {
      const result = await agent.generate({ messages: userMessages });
      return {
        content: result.text,
        toolCalls: result.toolCalls
          ? result.toolCalls.map((tc) => ({
            id: tc.toolCallId,
            name: tc.toolName,
            args: (tc.input ?? {}) as Record<string, unknown>,
          }))
          : [],
        usage: result.usage,
      };
    }
  }

  abstract listModels(): Promise<{ id: string; name: string }[]>;
}
