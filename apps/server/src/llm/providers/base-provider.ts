import { ToolLoopAgent, stepCountIs, type ToolSet, type ModelMessage, LanguageModel } from 'ai';
import { IProvider, LLMResponse } from '../types.js';
import { toAgentTools } from '../tools/tools.js';

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

  // Public cache reset so config changes (provider switch, new key/model)
  // reach the chat path without a server restart.
  clearCachedAgent(): void {
    this.cachedAgent = null;
  }

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
    // If tools provided → create scoped agent (not cached).
    // Strip `execute` so the agent only returns tool calls; manual
    // `executeToolCalls` is the single owner of execution (issue #138, KD-2).
    if (options?.tools) {
      const config = this.createAgentConfig();
      return new ToolLoopAgent({
        model: await this.getModel(),
        ...config,
        instructions: options.systemText ?? config.instructions,
        tools: toAgentTools(options.tools),
        stopWhen: stepCountIs(10),
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
    const agent = await this.getAgent({ tools: options?.tools });

    if (options?.stream) {
      const result = await agent.stream({ messages });
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
      const result = await agent.generate({ messages });
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
