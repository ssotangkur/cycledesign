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

  // Subscribe to all status events (only active when sessionId is provided)
  useChannelSubscription<'status', 'generation_start'>({
    channel: statusChannel,
    event: 'generation_start',
    handler: isActive ? (payload) => {
      setStatus({
        visible: true,
        message: `Generation started: ${payload.details}`,
        type: 'info',
      });
    } : noopHandler,
  });

  useChannelSubscription<'status', 'generation_thinking'>({
    channel: statusChannel,
    event: 'generation_thinking',
    handler: isActive ? (payload) => {
      setStatus({
        visible: true,
        message: `Generation thinking: ${payload.details}`,
        type: 'info',
      });
    } : noopHandler,
  });

  useChannelSubscription<'status', 'generation_complete'>({
    channel: statusChannel,
    event: 'generation_complete',
    handler: isActive ? (payload) => {
      setStatus({
        visible: true,
        message: `Generation complete: ${payload.details}`,
        type: 'success',
      });
    } : noopHandler,
  });

  useChannelSubscription<'status', 'tool_call_start'>({
    channel: statusChannel,
    event: 'tool_call_start',
    handler: isActive ? (payload) => {
      setStatus({
        visible: true,
        message: `Calling ${payload.tool}: ${payload.details}`,
        type: 'info',
      });
    } : noopHandler,
  });

  useChannelSubscription<'status', 'tool_call_complete'>({
    channel: statusChannel,
    event: 'tool_call_complete',
    handler: isActive ? (payload) => {
      setStatus({
        visible: true,
        message: `${payload.tool} complete: ${payload.details}`,
        type: 'success',
      });
    } : noopHandler,
  });

  useChannelSubscription<'status', 'tool_call_error'>({
    channel: statusChannel,
    event: 'tool_call_error',
    handler: isActive ? (payload) => {
      setStatus({
        visible: true,
        message: `${payload.tool} error: ${payload.details}`,
        type: 'error',
      });
    } : noopHandler,
  });

  useChannelSubscription<'status', 'validation_start'>({
    channel: statusChannel,
    event: 'validation_start',
    handler: isActive ? (payload) => {
      setStatus({
        visible: true,
        message: `Validation started: ${payload.details}`,
        type: 'info',
      });
    } : noopHandler,
  });

  useChannelSubscription<'status', 'validation_complete'>({
    channel: statusChannel,
    event: 'validation_complete',
    handler: isActive ? (payload) => {
      setStatus({
        visible: true,
        message: payload.details,
        type: 'success',
      });
    } : noopHandler,
  });

  useChannelSubscription<'status', 'preview_start'>({
    channel: statusChannel,
    event: 'preview_start',
    handler: isActive ? (payload) => {
      setStatus({
        visible: true,
        message: `Preview starting: ${payload.details}`,
        type: 'info',
      });
    } : noopHandler,
  });

  useChannelSubscription<'status', 'preview_ready'>({
    channel: statusChannel,
    event: 'preview_ready',
    handler: isActive ? (payload) => {
      setStatus({
        visible: true,
        message: `Preview ready at http://localhost:${payload.port}`,
        type: 'success',
      });
    } : noopHandler,
  });

  useChannelSubscription<'status', 'preview_error'>({
    channel: statusChannel,
    event: 'preview_error',
    handler: isActive ? (payload) => {
      setStatus({
        visible: true,
        message: `Preview error: ${payload.details}`,
        type: 'error',
      });
    } : noopHandler,
  });

  // Auto-hide after 5 seconds
  React.useEffect(() => {
    if (status.visible) {
      const timer = setTimeout(() => {
        setStatus({ ...status, visible: false });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  if (!status.visible) {
    return null;
  }

  return (
    <div className={`status-toast status-toast--${status.type}`}>
      {status.message}
    </div>
  );
}
