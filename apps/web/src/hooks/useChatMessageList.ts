// apps/web/src/hooks/useChatMessageList.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { useChatChannel } from './useChatChannel';
import type { ChatMessage } from '@cycledesign/common-protocol';

export interface ChatMessageWithStatus extends ChatMessage {
  status: 'pending' | 'confirmed' | 'streaming' | 'completed';
  clientMsgId?: string;
}

export interface ChatMessageListState {
  messages: ChatMessageWithStatus[];
  isConnected: boolean;
  isStreaming: boolean;
  error: string | null;
  sendMessage: (content: string) => void;
  clearError: () => void;
}

export function useChatMessageList(sessionId: string | null): ChatMessageListState {
  const [messages, setMessages] = useState<ChatMessageWithStatus[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatChannel = useChatChannel();

  // Track pending messages (clientMsgId -> server message)
  const pendingMessages = useRef<Map<string, ChatMessageWithStatus>>(new Map());

  // Compute connection state (only connected if we have a session)
  // Note: We assume the channel is connected if it exists
  const isConnected = sessionId !== null;

  // Subscribe to channel events
  useEffect(() => {
    if (!sessionId) return;

    // Epoch for this session mount: only the history whose sessionId
    // matches is accepted, so stale responses for a previous session
    // can never clobber the current pane (issue #170).
    const epochSessionId = sessionId;

    // Fresh pane per session; optimistic rows belong to the old session.
    pendingMessages.current.clear();
    setMessages([]);
    setIsStreaming(false);
    setError(null);

    // Demand persisted history for this session (server hydrates from
    // messages.jsonl; nothing is sent on subscribe anymore).
    chatChannel.publish('get-history', { sessionId }).catch((err: unknown) => {
      console.error('[useChatMessageList] get-history failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load history');
    });

    // Subscribe to history - accept only the payload for this epoch
    const unsubscribeHistory = chatChannel.subscribe('history', (payload) => {
      if (payload.sessionId !== epochSessionId) return; // Ignore stale sessions
      console.log('[useChatMessageList] Received history:', payload.messages.length, 'messages');

      // Replace with the persisted snapshot, keeping optimistic pending
      // rows that the snapshot can't know about yet.
      setMessages(prev => [
        ...payload.messages.map((msg) => ({
          ...msg,
          status: 'completed' as const,
        })),
        ...prev.filter((m) => m.status === 'pending'),
      ]);
      setIsStreaming(false);
    });

    // Subscribe to new messages
    const unsubscribeMessage = chatChannel.subscribe('message', (payload) => {
      console.log('[useChatMessageList] Received message:', payload);
      setMessages(prev => {
        // Id-stable live echo (server reuses the stored id): confirm the
        // snapshot/pending row instead of appending a duplicate.
        const byId = prev.find((m) => m.id === payload.id);
        if (byId) {
          if (byId.clientMsgId) pendingMessages.current.delete(byId.clientMsgId);
          if (byId.status === 'completed' && !byId.clientMsgId) return prev;
          return prev.map((m) =>
            m.id === payload.id
              ? { ...m, ...payload, status: 'confirmed' as const, clientMsgId: undefined }
              : m
          );
        }

        // Optimistic user row minted a client id while the server echo
        // carries the stored id: confirm the oldest matching pending row
        // (FIFO keeps repeated content like "Hello" twice ordered).
        const pendingArray = Array.from(pendingMessages.current.values());
        const pending = pendingArray.find(
          (m) => m.content === payload.content && m.status === 'pending'
        );

        if (pending) {
          // Update pending message to confirmed
          pendingMessages.current.delete(pending.clientMsgId!);
          return prev.map((m) =>
            m.clientMsgId === pending.clientMsgId
              ? { ...m, id: payload.id, timestamp: payload.timestamp, status: 'confirmed' as const, clientMsgId: undefined }
              : m
          );
        }

        // New message - server message carries a stable id
        const newMessage: ChatMessageWithStatus = {
          ...payload,
          status: 'completed' as const
        };
        console.log('[useChatMessageList] Adding new message:', newMessage);
        return [...prev, newMessage];
      });
      setIsStreaming(false);
    });

    // Setup connection state
    const cleanup = () => {
      unsubscribeHistory();
      unsubscribeMessage();
    };

    return cleanup;
  }, [sessionId, chatChannel]);

  const sendMessage = useCallback((content: string) => {
    if (!sessionId) return;

    const clientMsgId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const tempMessage: ChatMessageWithStatus = {
      id: clientMsgId,
      content,
      userId: 'user',
      timestamp: Date.now(),
      status: 'pending',
      clientMsgId,
    };

    // Add to pending messages
    pendingMessages.current.set(clientMsgId, tempMessage);
    setMessages(prev => [...prev, tempMessage]);
    setIsStreaming(true);

    // Publish to channel
    chatChannel.publish('message', { content, sessionId });
  }, [sessionId, chatChannel]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    messages,
    isConnected,
    isStreaming,
    error,
    sendMessage,
    clearError,
  };
}
