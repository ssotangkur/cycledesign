import { Box, CircularProgress } from '@mui/material';
import { useRef, useEffect } from 'react';
import MessageItem from './MessageItem';
import { useCurrentSessionId, useIsHydrated } from '../../hooks/useSession';
import { useMessageListState } from '../../hooks/useMessageListState';

function MessageList() {
  const { currentSessionId } = useCurrentSessionId();
  const isHydrated = useIsHydrated();
  const { messages, isStreaming } = useMessageListState(currentSessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!isHydrated) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flex: 1,
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!currentSessionId) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flex: 1,
          color: 'text.secondary',
        }}
      >
        Select or create a session to start chatting
      </Box>
    );
  }

  return (
    <Box
      data-testid="message-list"
      sx={{
        flex: 1,
        overflowY: 'auto',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      {isStreaming && (
        <Box data-testid="loading-indicator" sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      )}
      <div ref={messagesEndRef} />
    </Box>
  );
}

export default MessageList;
