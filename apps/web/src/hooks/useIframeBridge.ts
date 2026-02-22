import { useState, useEffect, useCallback, useRef } from 'react';

export type ParentMessage =
  | {
      type: 'SET_MODE';
      payload: { mode: 'select' | 'preview' | 'audit' };
    }
  | {
      type: 'HIGHLIGHT_COMPONENT';
      payload: { instanceId: string };
    }
  | {
      type: 'UPDATE_PROPS';
      payload: { instanceId: string; props: Record<string, unknown> };
    };

export type IframeMessage =
  | {
      type: 'MODE_READY';
      payload: { mode: string };
    }
  | {
      type: 'COMPONENT_SELECTED';
      payload: { instanceId: string; componentName: string };
    }
  | {
      type: 'ERROR';
      payload: { error: string };
    };

export interface UseIframeBridgeOptions {
  iframeRef: React.RefObject<HTMLIFrameElement>;
  previewOrigin: string;
  onMessage?: (message: IframeMessage) => void;
}

export interface UseIframeBridgeReturn {
  sendMessage: (message: ParentMessage) => void;
  isReady: boolean;
  queueSize: number;
}

export function useIframeBridge({
  iframeRef,
  previewOrigin,
  onMessage,
}: UseIframeBridgeOptions): UseIframeBridgeReturn {
  const [isReady, setIsReady] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  
  const messageQueueRef = useRef<ParentMessage[]>([]);
  const eventListenerAddedRef = useRef(false);

  const sendMessage = useCallback(
    (message: ParentMessage) => {
      if (!isReady || !iframeRef.current?.contentWindow) {
        messageQueueRef.current.push(message);
        setQueueSize(messageQueueRef.current.length);
        return;
      }

      iframeRef.current.contentWindow.postMessage(message, previewOrigin);
    },
    [isReady, iframeRef, previewOrigin]
  );

  useEffect(() => {
    if (eventListenerAddedRef.current) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== previewOrigin) {
        return;
      }

      const message = event.data as IframeMessage;

      if (
        message.type !== 'MODE_READY' &&
        message.type !== 'COMPONENT_SELECTED' &&
        message.type !== 'ERROR'
      ) {
        return;
      }

      if (message.type === 'MODE_READY') {
        setIsReady(true);
        
        if (messageQueueRef.current.length > 0) {
          const queue = [...messageQueueRef.current];
          messageQueueRef.current = [];
          setQueueSize(0);

          queue.forEach((queuedMessage) => {
            if (iframeRef.current?.contentWindow) {
              iframeRef.current.contentWindow.postMessage(
                queuedMessage,
                previewOrigin
              );
            }
          });
        }
      }

      onMessage?.(message);
    };

    window.addEventListener('message', handleMessage);
    eventListenerAddedRef.current = true;

    return () => {
      window.removeEventListener('message', handleMessage);
      eventListenerAddedRef.current = false;
    };
  }, [previewOrigin, onMessage, iframeRef]);

  useEffect(() => {
    const iframe = iframeRef.current;
    
    if (!iframe) {
      return;
    }

    const handleLoad = () => {
      setIsReady(false);
      messageQueueRef.current = [];
      setQueueSize(0);
    };

    iframe.addEventListener('load', handleLoad);

    return () => {
      iframe.removeEventListener('load', handleLoad);
    };
  }, [iframeRef]);

  return {
    sendMessage,
    isReady,
    queueSize,
  };
}
