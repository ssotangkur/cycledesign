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
  sessionLabelsMap: Record<string, string>;
}

export interface SessionContextType extends SessionState {
  createSession: (name?: string) => Promise<Session>;
  loadSession: (id: string) => Promise<void>;
  loadSessions: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
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
    sessionLabelsMap: {},
  });

  const loadSessions = useCallback(async () => {
    try {
      const sessions = await api.getSessions();
      const labelsMap: Record<string, string> = {};
      sessions.forEach((session) => {
        labelsMap[session.id] = session.firstMessage || session.id.slice(-8);
      });
      setState((prev) => ({ ...prev, sessions, sessionLabelsMap: labelsMap }));
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }, []);

  const createSession = useCallback(async (name?: string): Promise<Session> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const session = await api.createSession(name);
      const label = session.firstMessage || session.id.slice(-8);
      setState((prev) => ({
        ...prev,
        currentSession: session,
        sessions: [...prev.sessions, session],
        messages: [],
        isLoading: false,
        sessionLabelsMap: { ...prev.sessionLabelsMap, [session.id]: label },
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
    if (!state.currentSession) {
      console.error('[sendMessage] No current session');
      return;
    }

    // Prevent concurrent sends
    if (state.isStreaming) {
      console.warn('[sendMessage] Already streaming, ignoring duplicate call');
      return;
    }

    console.log('[sendMessage] Starting with messages count:', state.messages.length);
    
    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    // Optimistically add user message to state
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isStreaming: true,
      error: null,
      tokenUsage: null,
    }));

    try {
      // Check if this is the first message BEFORE adding it
      const isFirstMessage = state.messages.length === 0;
      console.log('[sendMessage] Is first message?', isFirstMessage, 'Current messages:', state.messages.length);

      // Save user message to backend
      console.log('[sendMessage] Saving user message to backend:', state.currentSession.id);
      await api.addMessage(state.currentSession.id, userMessage);

      // Update session label if this is the first message
      if (isFirstMessage) {
        const sessionId = state.currentSession.id;
        console.log('[sendMessage] Updating session label to:', content);
        setState((prev) => ({
          ...prev,
          sessionLabelsMap: {
            ...prev.sessionLabelsMap,
            [sessionId]: content,
          },
        }));
      }

      // Use functional update to get latest messages
      setState((prev) => {
        const messagesToSend = prev.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          toolCalls: m.toolCalls,
          toolCallId: m.toolCallId,
        }));

        console.log('[sendMessage] Calling completeStream with', messagesToSend.length, 'messages');
        let assistantContent = '';
        
        api.completeStream(
          messagesToSend,
          (chunk) => {
            assistantContent += chunk;
            setState((prev2) => ({
              ...prev2,
              messages: [
                ...prev2.messages.filter((m) => m.id !== 'streaming'),
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
            console.log('[sendMessage] Stream complete, saving assistant message');
            const assistantMessage: Message = {
              id: `msg_${Date.now()}`,
              role: 'assistant',
              content: response.content,
              timestamp: Date.now(),
              toolCalls: response.toolCalls,
              tokenCount: response.usage?.totalTokens,
            };

            setState((prev2) => ({
              ...prev2,
              messages: [...prev2.messages.filter((m) => m.id !== 'streaming'), assistantMessage],
              isStreaming: false,
              tokenUsage: response.usage || null,
            }));

            api.addMessage(state.currentSession!.id, assistantMessage).catch(console.error);
          },
          (error) => {
            console.error('[sendMessage] Stream error:', error.message);
            setState((prev2) => ({
              ...prev2,
              isStreaming: false,
              error: error.message,
            }));
          }
        );
        
        return prev;
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      setState((prev) => ({ ...prev, error: errorMessage, isStreaming: false }));
    }
  }, [state.currentSession, state.messages.length]);

  const deleteSession = useCallback(async (id: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      await api.deleteSession(id);
      setState((prev) => {
        const newLabelsMap = { ...prev.sessionLabelsMap };
        delete newLabelsMap[id];
        return {
          ...prev,
          sessions: prev.sessions.filter((s) => s.id !== id),
          currentSession: prev.currentSession?.id === id ? null : prev.currentSession,
          messages: prev.currentSession?.id === id ? [] : prev.messages,
          sessionLabelsMap: newLabelsMap,
          isLoading: false,
        };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete session';
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
        clearError,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
