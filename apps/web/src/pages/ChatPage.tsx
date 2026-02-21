import { Box, Alert, Chip } from '@mui/material';
import ChatContainer from '../components/chat/ChatContainer';
import SessionSelector from '../components/chat/SessionSelector';
import MessageList from '../components/chat/MessageList';
import PromptInput from '../components/chat/PromptInput';
import { useSession } from '../hooks/useSession';

function ChatPage() {
  const { messages, isLoading, isStreaming, error, sendMessage, tokenUsage, clearError } =
    useSession();

  const handleSend = async (content: string) => {
    await sendMessage(content);
  };

  return (
    <ChatContainer>
      <SessionSelector />
      {error && (
        <Box sx={{ p: 2 }}>
          <Alert severity="error" onClose={clearError}>
            {error}
          </Alert>
        </Box>
      )}
      {tokenUsage && (
        <Box sx={{ p: 1, display: 'flex', gap: 1, justifyContent: 'center' }}>
          <Chip
            label={`Prompt: ${tokenUsage.promptTokens} tokens`}
            size="small"
            color="primary"
            variant="outlined"
          />
          <Chip
            label={`Completion: ${tokenUsage.completionTokens} tokens`}
            size="small"
            color="primary"
            variant="outlined"
          />
          <Chip
            label={`Total: ${tokenUsage.totalTokens} tokens`}
            size="small"
            color="secondary"
            variant="outlined"
          />
        </Box>
      )}
      <MessageList messages={messages} isLoading={isLoading} isStreaming={isStreaming} />
      <PromptInput onSend={handleSend} disabled={isStreaming || !messages.length} />
    </ChatContainer>
  );
}

export default ChatPage;
