import { type ToolSet, type ModelMessage, LanguageModel } from 'ai';
import { createQwen } from 'qwen-ai-provider-v5';
import { ToolLoopAgent, stepCountIs } from 'ai';
import { QwenAuth } from '../qwen-auth.js';
import { requestQueue } from '../request-queue.js';
import { RateLimitError, AuthError } from '../errors.js';
import { BaseProvider, type AgentConfig } from './base-provider.js';
import { IProviderConfig, LLMResponse } from '../types.js';

const qwenAuth = new QwenAuth();

export class QwenProvider extends BaseProvider {
  readonly name = 'qwen' as const;
  private qwenProvider: ReturnType<typeof createQwen> | null = null;
  private agentPromise: Promise<ToolLoopAgent> | null = null;
  private localCachedAgent: ToolLoopAgent | null = null;

  protected async getModel(): Promise<LanguageModel> {
    const token = await qwenAuth.getToken();

    if (!token) {
      await qwenAuth.performDeviceAuthFlow();
    }

    if (!this.qwenProvider) {
      this.qwenProvider = createQwen({ apiKey: token ?? undefined });
    }

    return this.qwenProvider('qwen-coder-model');
  }

  protected createAgentConfig(): AgentConfig {
    return {
      ...super.createAgentConfig(),
      onStepFinish: async ({ usage, toolCalls, finishReason }) => {
        console.log(`[Qwen] Step completed: ${finishReason}`);
        if (toolCalls?.length) {
          console.log(`[Qwen] Tools called: ${toolCalls.map(tc => tc.toolName).join(', ')}`);
        }
        if (usage) {
          console.log(`[Qwen] Tokens used: ${usage.totalTokens ?? 0}`);
        }
      },
    };
  }

  // Qwen overrides getAgent to handle async initialization
  protected async getAgentAsync(options?: { tools?: ToolSet; systemText?: string }): Promise<ToolLoopAgent> {
    // If tools are provided, create a new scoped agent (not cached)
    if (options?.tools) {
      // getModel() assigns this.qwenProvider (and handles auth); without it
      // a cold start takes this branch with a null provider and crashes.
      const model = await this.getModel();
      return new ToolLoopAgent({
        model,
        instructions: options.systemText,
        tools: options.tools,
        stopWhen: stepCountIs(10),
        temperature: 0.1,
        maxOutputTokens: 8192,
        maxRetries: 2,
      });
    }

    // Return cached agent for default usage
    if (this.localCachedAgent) return this.localCachedAgent;

    if (this.agentPromise) {
      return await this.agentPromise;
    }

    this.agentPromise = (async () => {
      const model = await this.getModel();

      this.localCachedAgent = new ToolLoopAgent({
        model,
        instructions: 'You are a helpful coding assistant.',
        stopWhen: stepCountIs(10),
        temperature: 0.1,
        maxOutputTokens: 8192,
        maxRetries: 2,
        onStepFinish: async ({ usage, toolCalls, finishReason }) => {
          console.log(`[Qwen] Step completed: ${finishReason}`);
          if (toolCalls?.length) {
            console.log(`[Qwen] Tools called: ${toolCalls.map(tc => tc.toolName).join(', ')}`);
          }
          if (usage) {
            console.log(`[Qwen] Tokens used: ${usage.totalTokens ?? 0}`);
          }
        },
      });

      this.agentPromise = null;
      return this.localCachedAgent;
    })();

    return await this.agentPromise;
  }

  // Override complete to use async getAgent
  async complete(
    messages: ModelMessage[],
    options?: {
      stream?: boolean;
      maxRetries?: number;
      tools?: ToolSet;
    }
  ): Promise<LLMResponse> {
    console.log('[LLM] complete() called with', messages.length, 'messages, stream:', options?.stream ?? false);

    // Wrap base implementation with request queue
    return await requestQueue.enqueue(async () => {
      const retryConfig = await this.beforeComplete?.();
      const maxRetries = retryConfig?.maxRetries ?? (options?.maxRetries ?? 3);

      if (retryConfig) {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await this.executeCompleteInternal(messages, options);
          } catch (error: unknown) {
            lastError = error as Error;
            const shouldContinue = await retryConfig.onError?.(error, attempt);
            if (!shouldContinue) break;
          }
        }

        throw lastError || new Error('Max retries exceeded');
      } else {
        return await this.executeCompleteInternal(messages, options);
      }
    });
  }

  private async executeCompleteInternal(
    messages: ModelMessage[],
    options?: { tools?: ToolSet; stream?: boolean }
  ): Promise<LLMResponse> {
    const systemMessage = messages.find(m => m.role === 'system') as
      { role: 'system', content: string | Array<{ type: 'text', text: string }> } | undefined;
    const userMessages = messages.filter(m => m.role !== 'system');

    const systemText = typeof systemMessage?.content === 'string'
      ? systemMessage.content
      : Array.isArray(systemMessage?.content)
        ? systemMessage.content.map(c => c.text).join('')
        : undefined;

    const agent = await this.getAgentAsync({ tools: options?.tools, systemText });

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

  protected async beforeComplete(): Promise<{
    maxRetries: number;
    onError: (error: unknown, attempt: number) => Promise<boolean>;
  }> {
    console.log('[LLM] Preparing for request with retry logic');

    return {
      maxRetries: 3,
      onError: async (error: unknown, attempt: number): Promise<boolean> => {
        console.error('[LLM] Error on attempt', attempt + 1);

        if (error instanceof AuthError || (error as { status?: number }).status === 401 || (error as { message?: string }).message?.includes('401')) {
          console.log('[LLM] Authentication error (401) - triggering device auth flow');
          await qwenAuth.performDeviceAuthFlow();
          return true; // Continue retry
        }

        if (error instanceof RateLimitError || (error as { status?: number }).status === 429) {
          const backoff = (error as { retryAfterMs?: number }).retryAfterMs ?? Math.min(1000 * Math.pow(2, attempt), 60000);
          console.log('[LLM] Rate limited - waiting', backoff, 'ms before retry');
          await new Promise(resolve => setTimeout(resolve, backoff));
          return true; // Continue retry
        }

        if (attempt < 3) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 60000);
          console.log('[LLM] Retrying in', backoff, 'ms...');
          await new Promise(resolve => setTimeout(resolve, backoff));
          return true; // Continue retry
        }

        return false; // Stop retrying
      },
    };
  }

  async listModels(): Promise<{ id: string; name: string }[]> {
    try {
      const token = await qwenAuth.getToken();
      if (!token) {
        return [];
      }
    } catch {
      return [];
    }
    return [
      { id: 'coder-model', name: 'Qwen Coder (1M context)' },
      { id: 'vision-model', name: 'Qwen Vision (128K context)' },
    ];
  }

  static name(): string {
    return 'qwen';
  }

  static displayName(): string {
    return 'Qwen (OAuth - Free)';
  }

  static requiresApiKey(): boolean {
    return false;
  }

  static saveConfig(_config: IProviderConfig): void {
    // Qwen uses OAuth, no API key to save - model not persisted
  }

  static loadConfig(): IProviderConfig {
    return { model: 'coder-model' };
  }
}
