import { generateText, streamText, CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QwenAuth } from '../qwen-auth';
import { requestQueue } from '../request-queue';
import { RateLimitError, AuthError } from '../errors';

const qwenAuth = new QwenAuth();

export class QwenProvider {
  private model: any = null;
  private modelPromise: Promise<any> | null = null;

  private async getModel(): Promise<any> {
    if (this.model) return this.model;

    if (this.modelPromise) return this.modelPromise;

    this.modelPromise = (async () => {
      const token = await qwenAuth.getToken();
      
      if (!token) {
        await qwenAuth.performDeviceAuthFlow();
        return this.getModel();
      }
      
      const openai = createOpenAI({
        apiKey: token,
        baseURL: process.env.QWEN_BASE_URL || 'https://portal.qwen.ai/v1',
      });
      
      this.model = openai('coder-model');
      this.modelPromise = null;
      return this.model;
    })();

    return this.modelPromise;
  }

  async complete(messages: CoreMessage[], options?: { stream?: boolean; maxRetries?: number }) {
    const maxRetries = options?.maxRetries ?? 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await requestQueue.enqueue(async () => {
          const model = await this.getModel();

          if (options?.stream) {
            const result = await streamText({
              model,
              messages,
              temperature: 0.7,
              maxTokens: 2048,
            });
            return { stream: result.textStream };
          } else {
            const result = await generateText({
              model,
              messages,
              temperature: 0.7,
              maxTokens: 2048,
            });
            return {
              content: result.text,
              toolCalls: result.toolCalls,
              usage: result.usage,
            };
          }
        });
      } catch (error: any) {
        lastError = error;

        if (error instanceof AuthError || error.status === 401 || error.message?.includes('401')) {
          await qwenAuth.performDeviceAuthFlow();
          continue;
        }

        if (error instanceof RateLimitError || error.status === 429) {
          const backoff = error.retryAfterMs || Math.min(1000 * Math.pow(2, attempt), 60000);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }

        if (attempt < maxRetries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 60000);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }
}
