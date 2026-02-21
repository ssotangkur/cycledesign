const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
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

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  totalTokens: number;
  firstMessage: string | null;
}

export interface CompletionResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }
  return response.json();
}

export const api = {
  // Sessions
  getSessions: async (): Promise<Session[]> => {
    const response = await fetch(`${API_BASE_URL}/api/sessions`);
    return handleResponse<Session[]>(response);
  },

  createSession: async (name?: string): Promise<Session> => {
    const response = await fetch(`${API_BASE_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return handleResponse<Session>(response);
  },

  getSession: async (id: string): Promise<Session> => {
    const response = await fetch(`${API_BASE_URL}/api/sessions/${id}`);
    return handleResponse<Session>(response);
  },

  getMessages: async (id: string): Promise<Message[]> => {
    const response = await fetch(`${API_BASE_URL}/api/sessions/${id}/messages`);
    return handleResponse<Message[]>(response);
  },

  addMessage: async (id: string, message: Partial<Message>): Promise<Message> => {
    const response = await fetch(`${API_BASE_URL}/api/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    return handleResponse<Message>(response);
  },

  deleteSession: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/api/sessions/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error: ${response.status} - ${error}`);
    }
  },

  renameSession: async (id: string, name: string): Promise<Session> => {
    const response = await fetch(`${API_BASE_URL}/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return handleResponse<Session>(response);
  },

  // Completion
  complete: async (messages: Message[]): Promise<CompletionResponse> => {
    const response = await fetch(`${API_BASE_URL}/api/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    return handleResponse<CompletionResponse>(response);
  },

  completeStream: async (
    messages: Message[],
    onChunk: (chunk: string) => void,
    onComplete: (response: CompletionResponse) => void,
    onError: (error: Error) => void
  ): Promise<() => void> => {
    const controller = new AbortController();
    let content = '';

    const fetchAndStream = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/complete/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API Error: ${response.status} - ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'content') {
                content += data.content;
                onChunk(data.content);
              } else if (data.type === 'done') {
                onComplete({ content, usage: data.usage });
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            }
          }
        }
      } catch (error: unknown) {
        if (error.name === 'AbortError') return;
        onError(error);
      }
    };

    fetchAndStream();

    return () => controller.abort();
  },
};
