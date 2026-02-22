import React from 'react';
import { Box } from '@mui/material';
import { usePostMessage } from '../hooks/usePostMessage';

export interface SelectionBoxProps {
  id: string;
  componentName: string;
  children: React.ReactNode;
}

export function SelectionBox({ id, componentName, children }: SelectionBoxProps) {
  const { sendMessage } = usePostMessage({
    targetOrigin: 'http://localhost:3000',
    allowedOrigins: ['http://localhost:3000'],
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
