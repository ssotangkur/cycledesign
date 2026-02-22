import { useEffect, useState, useCallback } from 'react';

export interface IframeMessage {
  type: 'MODE_READY';
  payload: { mode: string };
}

export interface ComponentSelectedMessage {
  type: 'COMPONENT_SELECTED';
  payload: { instanceId: string; componentName: string };
}

export interface ErrorMessage {
  type: 'ERROR';
  payload: { error: string };
}

export interface SetModeMessage {
  type: 'SET_MODE';
  payload: { mode: 'select' | 'preview' | 'audit' };
}

export interface HighlightComponentMessage {
  type: 'HIGHLIGHT_COMPONENT';
  payload: { instanceId: string };
}

export type ParentToIframeMessage = SetModeMessage | HighlightComponentMessage;
export type IframeToParentMessage = IframeMessage | ComponentSelectedMessage | ErrorMessage;

export interface PostMessageConfig {
  targetOrigin: string;
  allowedOrigins: string[];
}

export function usePostMessage(config: PostMessageConfig) {
  const [lastMessage, setLastMessage] = useState<ParentToIframeMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback((message: IframeToParentMessage) => {
    try {
      window.parent.postMessage(message, config.targetOrigin);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);
      const errorPayload: ErrorMessage = {
        type: 'ERROR',
        payload: { error: errorMessage },
      };
      window.parent.postMessage(errorPayload, config.targetOrigin);
    }
  }, [config.targetOrigin]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!config.allowedOrigins.includes(event.origin)) {
        return;
      }

      try {
        const message = event.data as ParentToIframeMessage;
        
        if (!message || !message.type) {
          return;
        }

        if (message.type === 'SET_MODE' || message.type === 'HIGHLIGHT_COMPONENT') {
          setLastMessage(message);
          setError(null);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to parse message';
        setError(errorMessage);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [config.allowedOrigins]);

  return {
    lastMessage,
    sendMessage,
    error,
  };
}
