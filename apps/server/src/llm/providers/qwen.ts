import { generateText, streamText, type ToolSet, type ModelMessage } from 'ai';
import { createQwen } from 'qwen-ai-provider-v5';
import { QwenAuth } from '../qwen-auth.js';
import { requestQueue } from '../request-queue.js';
import { RateLimitError, AuthError } from '../errors.js';
import { IProvider, IProviderConfig, LLMResponse } from '../types.js';

const qwenAuth = new QwenAuth();

export class QwenProvider implements IProvider {
  readonly name = 'qwen' as const;
  private model: ReturnType<ReturnType<typeof createQwen>> | null = null;
  private modelPromise: Promise<ReturnType<ReturnType<typeof createQwen>>> | null = null;

  private async getModel(): Promise<ReturnType<ReturnType<typeof createQwen>>> {
    if (this.model) return this.model;

    if (this.modelPromise) return this.modelPromise;

    this.modelPromise = (async () => {
      const token = await qwenAuth.getToken();

      if (!token) {
        await qwenAuth.performDeviceAuthFlow();
        return this.getModel();
      }

      const qwen = createQwen({
        apiKey: token,
      });

      this.model = qwen('qwen-coder-model');
      this.modelPromise = null;
      return this.model;
    })();

    return this.modelPromise;
  }

  async complete(messages: ModelMessage[], options?: {
    stream?: boolean;
    maxRetries?: number;
    tools?: ToolSet;
  }): Promise<LLMResponse> {
    const maxRetries = options?.maxRetries ?? 3;
    let lastError: Error | null = null;

    console.log('[LLM] complete() called with', messages.length, 'messages, stream:', options?.stream ?? false);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await requestQueue.enqueue(async () => {
          const model = await this.getModel();
          console.log('[LLM] Got model instance, starting', options?.stream ? 'stream' : 'completion');

          if (options?.stream) {
            console.log('[LLM] Creating stream with', messages.length, 'messages');

            // Extract system message if present
            const systemMessage = messages.find(m => m.role === 'system') as { role: 'system', content: string | Array<{ type: 'text', text: string }> } | undefined;
            const userMessages = messages.filter(m => m.role !== 'system');

            // Extract text from system message content (handle both string and array formats)
            const systemText = typeof systemMessage?.content === 'string'
              ? systemMessage.content
              : Array.isArray(systemMessage?.content)
                ? systemMessage.content.map(c => c.text).join('')
                : undefined;

            const result = await streamText({
              model,
              messages: userMessages,
              system: systemText,
              tools: options.tools,
              temperature: 0.1,
            });
            console.log('[LLM] Stream created successfully');
            const toolCalls = await result.toolCalls;

            return {
              stream: result.textStream,
              // @ts-expect-error - toolCall args type mismatch
              toolCalls: toolCalls ? toolCalls.map((tc) => ({ id: tc.toolCallId, name: tc.toolName, args: (tc.args ?? {}) as Record<string, unknown> })) : [],
            } as unknown as LLMResponse;
          } else {
            console.log('[LLM] Generating text with', messages.length, 'messages');

            // Extract system message if present
            const systemMessage = messages.find(m => m.role === 'system') as { role: 'system', content: string | Array<{ type: 'text', text: string }> } | undefined;
            const userMessages = messages.filter(m => m.role !== 'system');

            // Extract text from system message content (handle both string and array formats)
            const systemText = typeof systemMessage?.content === 'string'
              ? systemMessage.content
              : Array.isArray(systemMessage?.content)
                ? systemMessage.content.map(c => c.text).join('')
                : undefined;

            const result = await generateText({
              model,
              messages: userMessages,
              system: systemText,
              tools: options?.tools,
              temperature: 0.1,
            });
            console.log('[LLM] Generation complete, tokens used:', result.usage);
            const toolCalls = result.toolCalls;
            return {
              content: result.text,
              // @ts-expect-error - toolCall args type mismatch
              toolCalls: toolCalls ? toolCalls.map((tc) => ({ id: tc.toolCallId, name: tc.toolName, args: (tc.args ?? {}) as Record<string, unknown> })) : [],
              usage: result.usage,
            } as LLMResponse;
          }
        });
      } catch (error: unknown) {
        lastError = error as Error;
        console.error('[LLM] Error on attempt', attempt + 1, '/', maxRetries + 1 + ':', (error as Error).message);

        if (error instanceof AuthError || (error as { status?: number }).status === 401 || (error as { message?: string }).message?.includes('401')) {
          console.log('[LLM] Authentication error (401) - triggering device auth flow');
          await qwenAuth.performDeviceAuthFlow();
          continue;
        }

        if (error instanceof RateLimitError || (error as { status?: number }).status === 429) {
          const backoff = (error as { retryAfterMs?: number }).retryAfterMs ?? Math.min(1000 * Math.pow(2, attempt), 60000);
          console.log('[LLM] Rate limited - waiting', backoff, 'ms before retry');
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }

        if (attempt < maxRetries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 60000);
          console.log('[LLM] Retrying in', backoff, 'ms...');
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }

        console.error('[LLM] Max retries exceeded, throwing error');
        throw error;
      }
    }

    throw lastError || new Error('Max retries exceeded');
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
