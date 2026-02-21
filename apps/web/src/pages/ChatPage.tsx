import { useContext, useCallback } from 'react';
import { Box, Alert } from '@mui/material';
import ChatContainer from '../components/chat/ChatContainer';
import SessionSelector from '../components/chat/SessionSelector';
import MessageList from '../components/chat/MessageList';
import PromptInput from '../components/chat/PromptInput';
import ConnectionStatus from '../components/chat/ConnectionStatus';
import { SessionContext } from '../context/SessionContext';
import { useMessageListState } from '../hooks/useMessageListState';

function ChatPage() {
  const sessionContext = useContext(SessionContext);
  const currentSession = sessionContext?.currentSession ?? null;
  const sessionId = currentSession?.id ?? null;
  const { messages, isConnected, isStreaming, error, sendMessage, clearError } =
    useMessageListState(sessionId);

  const handleSend = useCallback(
    async (content: string) => {
      console.log('[ChatPage] handleSend called with:', content);
      sendMessage(content);
    },
    [sendMessage]
  );

  return (
    <ChatContainer>
      <SessionSelector />
      <ConnectionStatus isConnected={isConnected} />
      {error && (
        <Box sx={{ p: 2 }}>
          <Alert severity="error" onClose={clearError}>
            {error}
          </Alert>
        </Box>
      )}
      <MessageList messages={messages} isLoading={false} isStreaming={isStreaming} />
      <PromptInput onSend={handleSend} disabled={isStreaming || !isConnected} />
    </ChatContainer>
  );
}

export default ChatPage;
