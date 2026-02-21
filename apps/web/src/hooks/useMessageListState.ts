import { useState, useEffect, useCallback, useRef } from 'react';
import { SessionWebSocket, DisplayMessage } from '../api/websocket';

export interface MessageListState {
  messages: DisplayMessage[];
  isConnected: boolean;
  isStreaming: boolean;
  error: string | null;
  sendMessage: (content: string) => void;
  reconnect: () => void;
  clearError: () => void;
}

export function useMessageListState(sessionId: string | null): MessageListState {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<SessionWebSocket | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      if (wsRef.current) {
        wsRef.current.disconnect();
        wsRef.current = null;
      }
      const cleanup = () => {
        setMessages([]);
        setIsConnected(false);
        setIsStreaming(false);
        setError(null);
      };
      cleanup();
      return;
    }

    const ws = new SessionWebSocket(sessionId);
    wsRef.current = ws;

    ws.onConnectionChange = (connected) => {
      setIsConnected(connected);
      if (connected) {
        setError(null);
      }
    };

    ws.onHistory = (historyMessages) => {
      setMessages(historyMessages);
      streamingMsgIdRef.current = null;
      setIsStreaming(false);
    };

    ws.onMessageAck = (clientMsgId, serverMsgId) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === clientMsgId
            ? { ...m, id: serverMsgId, serverId: undefined, status: 'confirmed' }
            : m
        )
      );
    };

    ws.onContent = (content) => {
      if (streamingMsgIdRef.current) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingMsgIdRef.current
              ? { ...m, content: (m.content || '') + content }
              : m
          )
        );
      } else {
        const streamingId = `streaming_${Date.now()}`;
        streamingMsgIdRef.current = streamingId;
        setIsStreaming(true);
        setMessages((prev) => [
          ...prev,
          {
            id: streamingId,
            role: 'assistant',
            content,
            timestamp: Date.now(),
            status: 'streaming',
          },
        ]);
      }
    };

    ws.onDone = (messageId) => {
      if (streamingMsgIdRef.current) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingMsgIdRef.current
              ? { ...m, id: messageId, status: 'completed' }
              : m
          )
        );
      }
      streamingMsgIdRef.current = null;
      setIsStreaming(false);
    };

    ws.onError = (errorMessage) => {
      setError(errorMessage);
      setIsStreaming(false);
      streamingMsgIdRef.current = null;
    };

    ws.connect();

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [sessionId]);

  const sendMessage = useCallback((content: string) => {
    if (!wsRef.current) {
      setError('Not connected to server');
      return;
    }

    const clientMsgId = wsRef.current.sendMessage(content);

    setMessages((prev) => [
      ...prev,
      {
        id: clientMsgId,
        role: 'user',
        content,
        timestamp: Date.now(),
        status: 'pending',
      },
    ]);
  }, []);

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current.connect();
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    messages,
    isConnected,
    isStreaming,
    error,
    sendMessage,
    reconnect,
    clearError,
  };
}
