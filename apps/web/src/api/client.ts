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
  name: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  messageCount: number;
  totalTokens: number;
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
    const eventSource = new EventSource(
      `${API_BASE_URL}/api/complete/stream?messages=${encodeURIComponent(JSON.stringify(messages))}`
    );

    let content = '';
    let toolCalls: CompletionResponse['toolCalls'];
    let usage: CompletionResponse['usage'];

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'chunk') {
        content += data.content;
        onChunk(data.content);
      } else if (data.type === 'complete') {
        toolCalls = data.toolCalls;
        usage = data.usage;
        onComplete({ content, toolCalls, usage });
        eventSource.close();
      } else if (data.type === 'error') {
        onError(new Error(data.error));
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      onError(new Error('Connection lost'));
      eventSource.close();
    };

    return () => eventSource.close();
  },
};
