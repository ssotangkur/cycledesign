import React, { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { usePostMessage } from '../hooks/usePostMessage';

export interface AuditWrapperProps {
  id: string;
  componentName: string;
  children: React.ReactNode;
}

export function AuditWrapper({ id, componentName, children }: AuditWrapperProps) {
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [mode, setMode] = useState<'select' | 'preview' | 'audit'>('preview');
  const { sendMessage, lastMessage } = usePostMessage({
    targetOrigin: 'http://localhost:3000',
    allowedOrigins: ['http://localhost:3000'],
  });

  useEffect(() => {
    if (lastMessage?.type === 'SET_MODE') {
      const newMode = lastMessage.payload.mode;
      setMode(newMode);
      sendMessage({
        type: 'MODE_READY',
        payload: { mode: newMode },
      });
    }

    if (lastMessage?.type === 'HIGHLIGHT_COMPONENT') {
      setIsHighlighted(lastMessage.payload.instanceId === id);
    }
  }, [lastMessage, id, sendMessage]);

  const shouldHighlight = isHighlighted && mode === 'audit';

  return (
    <Box
      sx={{
        border: shouldHighlight ? '2px solid #1976d2' : 'none',
        backgroundColor: shouldHighlight ? 'rgba(25, 118, 210, 0.1)' : 'transparent',
        transition: 'all 0.2s ease-in-out',
        display: 'inline-block',
        maxWidth: '100%',
      }}
      data-component-id={id}
      data-component-name={componentName}
    >
      {children}
    </Box>
  );
}
