import React from 'react';
import { useChannelSubscription } from '../../hooks/useChannelSubscription';
import { useStatusChannel } from '../../hooks/useStatusChannel';

interface StatusDisplayProps {
  sessionId: string | null;
}

interface StatusState {
  visible: boolean;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

// Default handler that does nothing
const noopHandler = () => {};

export function StatusDisplay({ sessionId }: StatusDisplayProps) {
  const [status, setStatus] = React.useState<StatusState>({
    visible: false,
    message: '',
    type: 'info',
  });

  // Always call hooks
  const statusChannel = useStatusChannel();
  const isActive = sessionId !== null;

  // Use callbacks to stabilize handlers across renders
  const handleGenerationStart = React.useCallback((payload: { messageId: string; details: string }) => {
    setStatus({
      visible: true,
      message: `Starting AI generation: ${payload.details}`,
      type: 'info',
    });
  }, []);

  const handleGenerationThinking = React.useCallback((payload: { messageId: string; details: string }) => {
    setStatus({
      visible: true,
      message: `Generation thinking: ${payload.details}`,
      type: 'info',
    });
  }, []);

  const handleGenerationComplete = React.useCallback((payload: { messageId: string; details: string }) => {
    setStatus({
      visible: true,
      message: `Generation complete: ${payload.details}`,
      type: 'success',
    });
  }, []);

  const handleToolCallStart = React.useCallback((payload: { messageId: string; tool: string; details: string }) => {
    setStatus({
      visible: true,
      message: `${payload.tool}: ${payload.details}`,
      type: 'info',
    });
  }, []);

  const handleToolCallComplete = React.useCallback((payload: { messageId: string; tool: string; details: string }) => {
    setStatus({
      visible: true,
      message: `${payload.tool} complete: ${payload.details}`,
      type: 'success',
    });
  }, []);
  
  const handleToolCallError = React.useCallback((payload: { messageId: string; tool: string; details: string }) => {
    setStatus({
      visible: true,
      message: `${payload.tool} error: ${payload.details}`,
      type: 'error',
    });
  }, []);
  
  const handleValidationStart = React.useCallback((payload: { messageId: string; details: string }) => {
    setStatus({
      visible: true,
      message: `Validating: ${payload.details}`,
      type: 'info',
    });
  }, []);
  
  const handleValidationComplete = React.useCallback((payload: { messageId: string; details: string }) => {
    setStatus({
      visible: true,
      message: `Validation complete: ${payload.details}`,
      type: 'success',
    });
  }, []);
  
  const handlePreviewStart = React.useCallback((payload: { messageId: string; details: string }) => {
    setStatus({
      visible: true,
      message: `Preview: ${payload.details}`,
      type: 'info',
    });
  }, []);
  
  const handlePreviewReady = React.useCallback((payload: { messageId: string; port: number; details: string }) => {
    setStatus({
      visible: true,
      message: `Preview ready at http://localhost:${payload.port}: ${payload.details}`,
      type: 'success',
    });
  }, []);
  
  const handlePreviewError = React.useCallback((payload: { messageId: string; details: string }) => {
    setStatus({
      visible: true,
      message: `Preview error: ${payload.details}`,
      type: 'error',
    });
  }, []);

  // Subscribe to all status events (only active when sessionId is provided)
  useChannelSubscription<'status', 'generation_start'>({
    channel: statusChannel,
    event: 'generation_start',
    handler: isActive ? handleGenerationStart : noopHandler,
  });

  useChannelSubscription<'status', 'generation_thinking'>({
    channel: statusChannel,
    event: 'generation_thinking',
    handler: isActive ? handleGenerationThinking : noopHandler,
  });

  useChannelSubscription<'status', 'generation_complete'>({
    channel: statusChannel,
    event: 'generation_complete',
    handler: isActive ? handleGenerationComplete : noopHandler,
  });

  useChannelSubscription<'status', 'tool_call_start'>({
    channel: statusChannel,
    event: 'tool_call_start',
    handler: isActive ? handleToolCallStart : noopHandler,
  });

  useChannelSubscription<'status', 'tool_call_complete'>({
    channel: statusChannel,
    event: 'tool_call_complete',
    handler: isActive ? handleToolCallComplete : noopHandler,
  });

  useChannelSubscription<'status', 'tool_call_error'>({
    channel: statusChannel,
    event: 'tool_call_error',
    handler: isActive ? handleToolCallError : noopHandler,
  });

  useChannelSubscription<'status', 'validation_start'>({
    channel: statusChannel,
    event: 'validation_start',
    handler: isActive ? handleValidationStart : noopHandler,
  });

  useChannelSubscription<'status', 'validation_complete'>({
    channel: statusChannel,
    event: 'validation_complete',
    handler: isActive ? handleValidationComplete : noopHandler,
  });

  useChannelSubscription<'status', 'preview_start'>({
    channel: statusChannel,
    event: 'preview_start',
    handler: isActive ? handlePreviewStart : noopHandler,
  });

  useChannelSubscription<'status', 'preview_ready'>({
    channel: statusChannel,
    event: 'preview_ready',
    handler: isActive ? handlePreviewReady : noopHandler,
  });

  useChannelSubscription<'status', 'preview_error'>({
    channel: statusChannel,
    event: 'preview_error',
    handler: isActive ? handlePreviewError : noopHandler,
  });

  // Auto-hide after 10 seconds (increased for E2E tests)
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (status.visible) {
      timerRef.current = setTimeout(() => {
        setStatus(prev => ({ ...prev, visible: false }));
        timerRef.current = null;
      }, 10000);
    }

    // Cleanup on unmount
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [status.visible]);

  if (!status.visible) {
    return null;
  }

  return (
    <div className={`status-toast status-toast--${status.type}`}>
      {status.message}
    </div>
  );
}
