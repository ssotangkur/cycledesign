import React from 'react';
import { Box } from '@mui/material';
import { usePostMessage } from '../hooks/usePostMessage';
import { resolveToolOrigin } from '../utils/resolveToolOrigin';

export interface SelectionBoxProps {
  id: string;
  componentName: string;
  children: React.ReactNode;
}

export function SelectionBox({ id, componentName, children }: SelectionBoxProps) {
  const toolOrigin = resolveToolOrigin();
  const { sendMessage } = usePostMessage({
    targetOrigin: toolOrigin,
    allowedOrigins: [toolOrigin],
  });

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    sendMessage({
      type: 'COMPONENT_SELECTED',
      payload: {
        instanceId: id,
        componentName,
      },
    });
  };

  return (
    <Box
      sx={{
        display: 'inline-block',
        maxWidth: '100%',
        cursor: 'pointer',
        '&:hover': {
          outline: '1px dashed #1976d2',
          outlineOffset: '2px',
        },
      }}
      onClick={handleClick}
      data-component-id={id}
      data-component-name={componentName}
    >
      {children}
    </Box>
  );
}
