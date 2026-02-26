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
};
