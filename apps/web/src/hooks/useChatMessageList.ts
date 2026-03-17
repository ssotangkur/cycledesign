// apps/web/src/hooks/useChatMessageList.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { useChatChannel } from './useChatChannel';
import type { ChatMessage } from '@cycledesign/common-protocol';

export interface ChatMessageWithStatus {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  userId: string;
  timestamp: number;
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

    let historyReceived = false;

    // Subscribe to history - only set once on initial load
    const unsubscribeHistory = chatChannel.subscribe('history', (payload) => {
      if (historyReceived) return; // Ignore subsequent history messages
      historyReceived = true;
      console.log('[useChatMessageList] Received history:', payload.messages.length, 'messages');

      setMessages(payload.messages.map((msg: ChatMessage) => ({
        ...msg,
        role: 'assistant' as const,  // Messages from history are from assistant
        status: 'completed' as const,
      })));
    });

    // Subscribe to new messages
    const unsubscribeMessage = chatChannel.subscribe('message', (payload) => {
      console.log('[useChatMessageList] Received message:', payload);
      setMessages(prev => {
        // Check if this is a confirmed pending message
        const pendingArray = Array.from(pendingMessages.current.values());
        const pending = pendingArray.find(
          (m) => m.content === payload.content && m.status === 'pending'
        );

        if (pending) {
          // Update pending message to confirmed
          pendingMessages.current.delete(pending.clientMsgId!);
          return prev.map((m) =>
            m.clientMsgId === pending.clientMsgId
              ? { ...m, status: 'confirmed' as const, clientMsgId: undefined }
              : m
          );
        }

        // Determine role from userId
        const role = payload.userId === 'user' ? 'user' as const : 'assistant' as const;
        
        // New message from other user - server message doesn't have id, generate one
        const newMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          role,
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
      role: 'user' as const,
      content,
      userId: 'current-user',
      timestamp: Date.now(),
      status: 'pending',
      clientMsgId,
    };

    // Add to pending messages
    pendingMessages.current.set(clientMsgId, tempMessage);
    setMessages(prev => [...prev, tempMessage]);

    // Publish to channel
    chatChannel.publish('message', { content });
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
