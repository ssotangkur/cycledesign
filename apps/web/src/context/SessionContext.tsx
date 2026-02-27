/* eslint-disable react-refresh/only-export-components */
import { createContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import type { Session } from '../api/client';
import { trpc } from '../utils/trpc';
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

  // tRPC hooks for session operations
  const utils = trpc.useUtils();

  // List sessions query - auto-fetches on mount
  const listSessionsQuery = trpc.sessions.list.useQuery();

  // Create session mutation
  const createSessionMutation = trpc.sessions.create.useMutation({
    onSuccess: () => {
      utils.sessions.list.invalidate();
    },
  });

  // Get session query - we'll use utils to fetch when needed
  const getSessionById = useCallback(async (id: string): Promise<Session> => {
    return utils.sessions.get.fetch(id);
  }, [utils]);

  // Delete session mutation
  const deleteSessionMutation = trpc.sessions.delete.useMutation({
    onSuccess: () => {
      utils.sessions.list.invalidate();
    },
  });

  // Update state when sessions list changes
  useEffect(() => {
    if (listSessionsQuery.data) {
      const labelsMap: Record<string, string> = {};
      listSessionsQuery.data.forEach((session) => {
        labelsMap[session.id] = session.firstMessage || session.id.slice(-8);
      });
      setState((prev) => ({ ...prev, sessions: listSessionsQuery.data || [], sessionLabelsMap: labelsMap }));
    }
  }, [listSessionsQuery.data]);

  // Handle create session mutation state changes
  useEffect(() => {
    if (createSessionMutation.isSuccess && createSessionMutation.data) {
      const session = createSessionMutation.data;
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
      localStorage.setItem('cycledesign:lastSession', session.id);
      setupWebSocket(session.id);
    } else if (createSessionMutation.isError) {
      const errorMessage = createSessionMutation.error?.message || 'Failed to create session';
      setState((prev) => ({ ...prev, error: errorMessage, isLoading: false }));
    } else if (createSessionMutation.isPending) {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
    }
  }, [createSessionMutation.isSuccess, createSessionMutation.isError, createSessionMutation.isPending, createSessionMutation.data, createSessionMutation.error]);

  // Handle delete session mutation state changes
  useEffect(() => {
    if (deleteSessionMutation.isError) {
      const errorMessage = deleteSessionMutation.error?.message || 'Failed to delete session';
      setState((prev) => ({ ...prev, error: errorMessage, isLoading: false }));
    }
  }, [deleteSessionMutation.isSuccess, deleteSessionMutation.isError, deleteSessionMutation.error]);

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
    await utils.sessions.list.invalidate();
  }, [utils]);

  const createSession = useCallback(async (name?: string): Promise<Session> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    createSessionMutation.mutate({ name });

    // Return a promise that resolves when the mutation completes
    return new Promise((resolve, reject) => {
      const checkResult = () => {
        if (createSessionMutation.isSuccess && createSessionMutation.data) {
          resolve(createSessionMutation.data);
        } else if (createSessionMutation.isError) {
          reject(createSessionMutation.error);
        } else {
          setTimeout(checkResult, 50);
        }
      };
      checkResult();
    });
  }, [createSessionMutation]);

  const loadSession = useCallback(async (id: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const session = await getSessionById(id);
      setState((prev) => ({
        ...prev,
        currentSession: session,
        isLoading: false,
      }));
      localStorage.setItem('cycledesign:lastSession', id);
      setupWebSocket(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load session';
      setState((prev) => ({ ...prev, error: errorMessage, isLoading: false }));
    }
  }, [getSessionById, setupWebSocket]);

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
      // Invalidate sessions list to refresh firstMessage from server
      utils.sessions.list.invalidate();
    }
  }, [state.currentSession, state.messages, state.isStreaming, utils]);

  const deleteSession = useCallback(async (id: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    deleteSessionMutation.mutate(id);

    // Return a promise that resolves when the mutation completes
    return new Promise<void>((resolve, reject) => {
      const checkResult = () => {
        if (deleteSessionMutation.isSuccess) {
          // Update state immediately
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
          resolve();
        } else if (deleteSessionMutation.isError) {
          reject(deleteSessionMutation.error);
        } else {
          setTimeout(checkResult, 50);
        }
      };
      checkResult();
    });
  }, [deleteSessionMutation]);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  // Initial load and auto-select last session
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      if (mounted && listSessionsQuery.data) {
        // Auto-select last used session or create new one
        const lastSessionId = localStorage.getItem('cycledesign:lastSession');
        if (lastSessionId) {
          const lastSession = listSessionsQuery.data.find(s => s.id === lastSessionId);
          if (lastSession && mounted) {
            const label = lastSession.firstMessage || lastSession.id.slice(-8);
            setState((prev) => ({
              ...prev,
              currentSession: lastSession,
              sessionLabelsMap: { ...prev.sessionLabelsMap, [lastSession.id]: label },
            }));
            setupWebSocket(lastSessionId);
            console.log('[SessionContext] Auto-selected last session:', lastSessionId);
            return;
          }
        }

        // If no last session or it doesn't exist, create a new one
        if (mounted && !state.currentSession) {
          try {
            const session = await createSession();
            console.log('[SessionContext] Created new session:', session.id);
          } catch (error) {
            console.error('[SessionContext] Failed to create session:', error);
          }
        }
      }
    };
    init();
    return () => {
      mounted = false;
      cleanupWebSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listSessionsQuery.data]);

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
