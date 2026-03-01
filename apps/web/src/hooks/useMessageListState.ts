import { useState, useEffect, useCallback } from 'react';
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

// Singleton WebSocket instances per session
const wsInstances = new Map<string, {
  ws: SessionWebSocket;
  refCount: number;
  messages: DisplayMessage[];
  isConnected: boolean;
  isStreaming: boolean;
  error: string | null;
  subscribers: Set<() => void>;
}>();

function getOrCreateWebSocket(sessionId: string) {
  let instance = wsInstances.get(sessionId);
  if (!instance) {
    const ws = new SessionWebSocket(sessionId);
    instance = {
      ws,
      refCount: 0,
      messages: [],
      isConnected: false,
      isStreaming: false,
      error: null,
      subscribers: new Set(),
    };
    wsInstances.set(sessionId, instance);
  }
  return instance;
}

function cleanupWebSocket(sessionId: string) {
  const instance = wsInstances.get(sessionId);
  if (instance) {
    instance.refCount--;
    if (instance.refCount <= 0) {
      instance.ws.disconnect();
      wsInstances.delete(sessionId);
    }
  }
}

export function useMessageListState(sessionId: string | null): MessageListState {
  const [state, setState] = useState<{
    messages: DisplayMessage[];
    isConnected: boolean;
    isStreaming: boolean;
    error: string | null;
  }>({
    messages: [],
    isConnected: false,
    isStreaming: false,
    error: null,
  });

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const instance = getOrCreateWebSocket(sessionId);
    instance.refCount++;

    // Subscribe to updates
    const subscribe = () => {
      setState({
        messages: [...instance!.messages],
        isConnected: instance!.isConnected,
        isStreaming: instance!.isStreaming,
        error: instance!.error,
      });
    };

    instance.subscribers.add(subscribe);
    subscribe();

    // Setup WebSocket handlers if not already set
    if (instance.refCount === 1) {
      instance.ws.onHistory = (historyMessages) => {
        instance!.messages = historyMessages;
        instance!.isStreaming = false;
        instance!.subscribers.forEach(fn => fn());
      };

      instance.ws.onMessageAck = (clientMsgId, serverMsgId) => {
        const idx = instance!.messages.findIndex(m => m.id === clientMsgId);
        if (idx !== -1) {
          instance!.messages[idx] = {
            ...instance!.messages[idx],
            id: serverMsgId,
            serverId: undefined,
            status: 'confirmed',
          };
          instance!.subscribers.forEach(fn => fn());
        }
      };

      instance.ws.onContent = () => {
        instance!.isStreaming = true;
        instance!.subscribers.forEach(fn => fn());
      };

      instance.ws.onDone = () => {
        instance!.isStreaming = false;
        instance!.subscribers.forEach(fn => fn());
      };

      instance.ws.onError = (errorMessage) => {
        instance!.error = errorMessage;
        instance!.isStreaming = false;
        instance!.subscribers.forEach(fn => fn());
      };

      instance.ws.onConnectionChange = (connected) => {
        instance!.isConnected = connected;
        if (connected) {
          instance!.error = null;
        }
        instance!.subscribers.forEach(fn => fn());
      };

      instance.ws.connect();
    }

    return () => {
      instance.subscribers.delete(subscribe);
      cleanupWebSocket(sessionId);
    };
  }, [sessionId]);

  const sendMessage = useCallback((content: string) => {
    if (!sessionId) return;
    const instance = wsInstances.get(sessionId);
    if (!instance) return;

    const clientMsgId = instance.ws.sendMessage(content);
    instance.messages.push({
      id: clientMsgId,
      role: 'user',
      content,
      timestamp: Date.now(),
      status: 'pending',
    } as DisplayMessage);
    instance.subscribers.forEach(fn => fn());
  }, [sessionId]);

  const reconnect = useCallback(() => {
    if (!sessionId) return;
    const instance = wsInstances.get(sessionId);
    if (instance) {
      instance.ws.disconnect();
      instance.ws.connect();
    }
  }, [sessionId]);

  const clearError = useCallback(() => {
    if (!sessionId) return;
    const instance = wsInstances.get(sessionId);
    if (instance) {
      instance.error = null;
      instance.subscribers.forEach(fn => fn());
    }
  }, [sessionId]);

  return {
    messages: state.messages,
    isConnected: state.isConnected,
    isStreaming: state.isStreaming,
    error: state.error,
    sendMessage,
    reconnect,
    clearError,
  };
}
