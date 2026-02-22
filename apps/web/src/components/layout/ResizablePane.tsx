import { Box, SxProps, Theme } from '@mui/material';
import { ReactNode } from 'react';

interface ResizablePaneProps {
  children: ReactNode;
  width: number | string;
  minWidth?: string | number;
  maxWidth?: string | number;
  sx?: SxProps<Theme>;
}

function ResizablePane({
  children,
  width,
  minWidth = '350px',
  maxWidth = '70%',
  sx = {},
}: ResizablePaneProps) {
  return (
    <Box
      sx={{
        width: typeof width === 'number' ? `${width}px` : width,
        minWidth,
        maxWidth,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRight: '1px solid',
        borderColor: 'divider',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export default ResizablePane;
