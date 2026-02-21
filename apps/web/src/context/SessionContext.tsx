/* eslint-disable react-refresh/only-export-components */
import { createContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { api, Session } from '../api/client';
import { SessionWebSocket, DisplayMessage } from '../api/websocket';

export interface SessionState {
  currentSession: Session | null;
  sessions: Session[];
  messages: DisplayMessage[];
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

export interface SessionContextType {
  currentSession: Session | null;
  sessions: Session[];
  messages: DisplayMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  sessionLabelsMap: Record<string, string>;
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

  const wsRef = useRef<SessionWebSocket | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);

  const setupWebSocket = useCallback((sessionId: string) => {
    if (wsRef.current) {
      wsRef.current.disconnect();
    }

    const ws = new SessionWebSocket(sessionId);
    wsRef.current = ws;

    ws.onHistory = (historyMessages) => {
      setState((prev) => ({
        ...prev,
        messages: historyMessages,
        isStreaming: false,
      }));
      streamingMsgIdRef.current = null;
    };

    ws.onMessageAck = (clientMsgId, serverMsgId) => {
      setState((prev) => ({
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === clientMsgId
            ? { ...m, id: serverMsgId, serverId: undefined, status: 'confirmed' }
            : m
        ),
      }));
    };

    ws.onContent = (content) => {
      if (streamingMsgIdRef.current) {
        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === streamingMsgIdRef.current
              ? { ...m, content: (m.content || '') + content }
              : m
          ),
        }));
      } else {
        const streamingId = `streaming_${Date.now()}`;
        streamingMsgIdRef.current = streamingId;
        setState((prev) => ({
          ...prev,
          isStreaming: true,
          messages: [
            ...prev.messages,
            {
              id: streamingId,
              role: 'assistant',
              content,
              timestamp: Date.now(),
              status: 'streaming',
            },
          ],
        }));
      }
    };

    ws.onDone = (messageId) => {
      if (streamingMsgIdRef.current) {
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          messages: prev.messages.map((m) =>
            m.id === streamingMsgIdRef.current
              ? { ...m, id: messageId, status: 'completed' }
              : m
          ),
        }));
      }
      streamingMsgIdRef.current = null;
    };

    ws.onError = (errorMessage) => {
      setState((prev) => ({
        ...prev,
        error: errorMessage,
        isStreaming: false,
      }));
      streamingMsgIdRef.current = null;
    };

    ws.connect();
  }, []);

  const cleanupWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current = null;
    }
    streamingMsgIdRef.current = null;
  }, []);

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
      cleanupWebSocket();
      setState((prev) => ({
        ...prev,
        currentSession: session,
        sessions: [...prev.sessions, session],
        messages: [],
        isLoading: false,
        sessionLabelsMap: { ...prev.sessionLabelsMap, [session.id]: label },
      }));
      setupWebSocket(session.id);
      return session;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create session';
      setState((prev) => ({ ...prev, error: errorMessage, isLoading: false }));
      throw error;
    }
  }, [setupWebSocket, cleanupWebSocket]);

  const loadSession = useCallback(async (id: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const session = await api.getSession(id);
      setState((prev) => ({
        ...prev,
        currentSession: session,
        isLoading: false,
      }));
      setupWebSocket(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load session';
      setState((prev) => ({ ...prev, error: errorMessage, isLoading: false }));
    }
  }, [setupWebSocket]);

  const sendMessage = useCallback(async (content: string) => {
    if (!state.currentSession) {
      console.error('[sendMessage] No current session');
      return;
    }

    if (state.isStreaming) {
      console.warn('[sendMessage] Already streaming, ignoring duplicate call');
      return;
    }

    if (!wsRef.current) {
      console.error('[sendMessage] WebSocket not connected');
      return;
    }

    const isFirstMessage = state.messages.length === 0;

    const clientMsgId = wsRef.current.sendMessage(content);

    const userMessage: DisplayMessage = {
      id: clientMsgId,
      role: 'user',
      content,
      timestamp: Date.now(),
      status: 'pending',
    };

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isStreaming: true,
      error: null,
      tokenUsage: null,
    }));

    if (isFirstMessage) {
      const sessionId = state.currentSession.id;
      setState((prev) => ({
        ...prev,
        sessionLabelsMap: {
          ...prev.sessionLabelsMap,
          [sessionId]: content,
        },
      }));
    }
  }, [state.currentSession, state.messages, state.isStreaming]);

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
      cleanupWebSocket();
    };
  }, [loadSessions, cleanupWebSocket]);

  useEffect(() => {
    return () => {
      cleanupWebSocket();
    };
  }, [state.currentSession?.id, cleanupWebSocket]);

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
