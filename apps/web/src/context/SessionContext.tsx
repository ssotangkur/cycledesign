/* eslint-disable react-refresh/only-export-components */
import { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api, Message, Session } from '../api/client';

export interface SessionState {
  currentSession: Session | null;
  sessions: Session[];
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

export interface SessionContextType extends SessionState {
  createSession: (name?: string) => Promise<Session>;
  loadSession: (id: string) => Promise<void>;
  loadSessions: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, name: string) => Promise<void>;
  clearError: () => void;
}

export const SessionContext = createContext<SessionContextType | undefined>(undefined);

interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [state, setState] = useState<SessionState>({
    currentSession: null,
    sessions: [],
    messages: [],
    isLoading: false,
    isStreaming: false,
    error: null,
    tokenUsage: null,
  });

  const loadSessions = useCallback(async () => {
    try {
      const sessions = await api.getSessions();
      setState((prev) => ({ ...prev, sessions }));
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }, []);

  const createSession = useCallback(async (name?: string): Promise<Session> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const session = await api.createSession(name);
      setState((prev) => ({
        ...prev,
        currentSession: session,
        sessions: [...prev.sessions, session],
        messages: [],
        isLoading: false,
      }));
      return session;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create session';
      setState((prev) => ({ ...prev, error: errorMessage, isLoading: false }));
      throw error;
    }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const [session, messages] = await Promise.all([
        api.getSession(id),
        api.getMessages(id),
      ]);
      setState((prev) => ({
        ...prev,
        currentSession: session,
        messages,
        isLoading: false,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load session';
      setState((prev) => ({ ...prev, error: errorMessage, isLoading: false }));
    }
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!state.currentSession) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isStreaming: true,
      error: null,
      tokenUsage: null,
    }));

    try {
      await api.addMessage(state.currentSession.id, userMessage);

      const messagesToSend = [...state.messages, userMessage].map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
      }));

      let assistantContent = '';
      
      await new Promise<void>((resolve, reject) => {
        api.completeStream(
          messagesToSend,
          (chunk) => {
            assistantContent += chunk;
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages.filter((m) => m.id !== 'streaming'),
                {
                  id: 'streaming',
                  role: 'assistant',
                  content: assistantContent,
                  timestamp: Date.now(),
                },
              ],
            }));
          },
          (response) => {
            const assistantMessage: Message = {
              id: `msg_${Date.now()}`,
              role: 'assistant',
              content: response.content,
              timestamp: Date.now(),
              toolCalls: response.toolCalls,
              tokenCount: response.usage?.totalTokens,
            };

            setState((prev) => ({
              ...prev,
              messages: [...prev.messages.filter((m) => m.id !== 'streaming'), assistantMessage],
              isStreaming: false,
              tokenUsage: response.usage || null,
            }));

            api.addMessage(state.currentSession!.id, assistantMessage).catch(console.error);
            resolve();
          },
          (error) => {
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              error: error.message,
            }));
            reject(error);
          }
        );
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      setState((prev) => ({
        ...prev,
        isStreaming: false,
        error: errorMessage,
      }));
    }
  }, [state.currentSession, state.messages]);

  const deleteSession = useCallback(async (id: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      await api.deleteSession(id);
      setState((prev) => ({
        ...prev,
        sessions: prev.sessions.filter((s) => s.id !== id),
        currentSession: prev.currentSession?.id === id ? null : prev.currentSession,
        messages: prev.currentSession?.id === id ? [] : prev.messages,
        isLoading: false,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete session';
      setState((prev) => ({ ...prev, error: errorMessage, isLoading: false }));
    }
  }, []);

  const renameSession = useCallback(async (id: string, name: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const session = await api.renameSession(id, name);
      setState((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) => (s.id === id ? session : s)),
        currentSession: prev.currentSession?.id === id ? session : prev.currentSession,
        isLoading: false,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to rename session';
      setState((prev) => ({ ...prev, error: errorMessage, isLoading: false }));
    }
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      if (mounted) {
        await loadSessions();
      }
    };
    init();
    return () => {
      mounted = false;
    };
  }, [loadSessions]);

  return (
    <SessionContext.Provider
      value={{
        ...state,
        createSession,
        loadSession,
        loadSessions,
        sendMessage,
        deleteSession,
        renameSession,
        clearError,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
