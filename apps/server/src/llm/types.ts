import { ModelMessage, ToolSet } from 'ai';

export interface StoredMessage {
  id: string;
  timestamp: number;

  // The ModelMessage representation of this message for direct use with LLM.
  // This avoids repeated conversion when sending messages to the LLM.
  // Role and text content live inside `modelMessage` — use the helpers below.
  modelMessage: ModelMessage;

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

/**
 * Narrow an unknown runtime value to a valid ModelMessage role.
 * Returns undefined for corrupt rows instead of defaulting to 'user',
 * so callers skip them rather than promoting garbage to a real user turn.
 */
function asRole(value: unknown): ModelMessage['role'] | undefined {
  return value === 'system' || value === 'user' || value === 'assistant' || value === 'tool'
    ? value
    : undefined;
}

/**
 * Role of a stored message, derived from its `modelMessage`.
 * Single source of truth — do not duplicate `role` on `StoredMessage`.
 * Falls back to legacy top-level `role` for old JSONL files.
 * Returns undefined for corrupt rows (non-objects, unknown roles).
 */
export function getStoredMessageRole(msg: StoredMessage): ModelMessage['role'] | undefined {
  if (!msg || typeof msg !== 'object') return undefined;
  const modelMessage = msg.modelMessage as ModelMessage | undefined;
  if (modelMessage && typeof modelMessage === 'object') {
    return asRole((modelMessage as { role?: unknown }).role);
  }
  return asRole((msg as unknown as { role?: unknown }).role);
}

/**
 * Text content of a stored message, derived from its `modelMessage`.
 * Handles both string content and array-of-parts content from the AI SDK.
 * Falls back to legacy top-level `content` for old JSONL files.
 */
export function getStoredMessageText(msg: StoredMessage): string {
  if (!msg || typeof msg !== 'object') return '';
  const content = (msg.modelMessage as { content?: unknown } | undefined)?.content
    ?? (msg as unknown as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * Convert a StoredMessage to a ModelMessage for the LLM.
 * Rebuilds legacy rows (top-level role/content, no modelMessage) into an
 * equivalent ModelMessage. Returns null for rows with no usable content
 * (corrupt rows, non-textual legacy rows) so callers can skip them with a warn.
 */
export function toModelMessage(msg: StoredMessage): ModelMessage | null {
  if (!msg || typeof msg !== 'object') return null;
  const modelMessage = msg.modelMessage as ModelMessage | undefined;
  if (modelMessage && typeof modelMessage === 'object') {
    // Validate the passthrough branch too: rows like
    // {"modelMessage":{"role":"user"}} (missing content) or
    // {"modelMessage":{"role":"user","content":42}} (wrong-type content)
    // must not reach the LLM. Valid ModelMessage content is always a
    // string or an array of content parts.
    const role = asRole((modelMessage as { role?: unknown }).role);
    const content = (modelMessage as { content?: unknown }).content;
    const contentOk = typeof content === 'string' || Array.isArray(content);
    return role && contentOk ? modelMessage : null;
  }
  const role = getStoredMessageRole(msg);
  const text = getStoredMessageText(msg);
  if ((role === 'user' || role === 'assistant' || role === 'system') && text) {
    return { role, content: text };
  }
  return null;
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
