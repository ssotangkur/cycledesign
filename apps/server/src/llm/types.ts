import { CoreMessage } from 'ai';

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

export type { CoreMessage };
