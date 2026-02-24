import { generateText, streamText, type ToolSet, type ModelMessage } from 'ai';
import { createMistral } from '@ai-sdk/mistral';

export interface LLMResponse {
  content: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  usage?: { totalTokens: number };
  stream?: AsyncIterable<string>;
}

export class MistralProvider {
  private apiKey: string;
  private model: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.MISTRAL_API_KEY || '';
    this.model = model || process.env.MISTRAL_MODEL || 'devstral-latest';
    if (!this.apiKey) {
      throw new Error('MISTRAL_API_KEY is not set');
    }
    this.client = createMistral({ apiKey: this.apiKey });
  }

  async complete(
    messages: ModelMessage[],
    options?: {
      tools?: ToolSet;
      stream?: boolean;
    }
  ): Promise<LLMResponse> {
    const model = this.client(this.model);

    if (options?.stream) {
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
        maxOutputTokens: 8192,
      });
      const toolCalls = await result.toolCalls;
      return {
        stream: result.textStream,
        content: '',
        toolCalls: toolCalls
          ? toolCalls.map((tc: { toolCallId: string; toolName: string; input: unknown }) => ({
              id: tc.toolCallId,
              name: tc.toolName,
              args: tc.input as Record<string, unknown>,
            }))
          : [],
      };
    } else {
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
        maxOutputTokens: 8192,
      });
      const toolCalls = result.toolCalls;
      return {
        content: result.text,
        toolCalls: toolCalls
          ? toolCalls.map((tc: { toolCallId: string; toolName: string; input: unknown }) => ({
              id: tc.toolCallId,
              name: tc.toolName,
              args: tc.input as Record<string, unknown>,
            }))
          : [],
        usage: { totalTokens: result.usage.totalTokens ?? 0 },
      };
    }
  }
}

export interface MistralModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface MistralModelsResponse {
  object: string;
  data: MistralModel[];
}

export async function listMistralModels(apiKey: string): Promise<string[]> {
  const response = await fetch('https://api.mistral.ai/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.statusText}`);
  }

  const data: MistralModelsResponse = await response.json();
  return data.data
    ?.filter((m) => m.id.includes('devstral') || m.id.includes('codestral'))
    ?.map((m) => m.id) || [];
}
