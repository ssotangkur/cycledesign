import { Box, Paper } from '@mui/material';
import { ReactNode } from 'react';

interface ChatContainerProps {
  children: ReactNode;
}

function ChatContainer({ children }: ChatContainerProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 120px)',
        maxWidth: '1200px',
        margin: '0 auto',
      }}
    >
      <Paper
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          overflow: 'hidden',
          borderRadius: 3,
        }}
      >
        {children}
      </Paper>
    </Box>
  );
}

export default ChatContainer;
