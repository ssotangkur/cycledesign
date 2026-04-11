import { useState, useEffect, useRef } from 'react';
import { Box, TextField, IconButton } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { useCurrentSessionId, useIsHydrated, useInvalidateSessions, useSessions } from '../../hooks/useSession';
import { useChatMessageList } from '../../hooks/useChatMessageList';

function PromptInput() {
  const { currentSessionId } = useCurrentSessionId();
  const isHydrated = useIsHydrated();
  const { invalidateSessions } = useInvalidateSessions();
  const { sessions } = useSessions();
  const { sendMessage, isStreaming, isConnected, messages } = useChatMessageList(currentSessionId);
  const [input, setInput] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disabled = !isHydrated || !currentSessionId || !isConnected || isStreaming;

  // Poll for firstMessage update after sending first message
  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const startPollingForFirstMessage = () => {
    // Clear any existing polling
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    // Poll every 500ms for firstMessage update
    pollingRef.current = setInterval(() => {
      invalidateSessions();
    }, 500);

    // Stop polling after 10 seconds timeout
    timeoutRef.current = setTimeout(() => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }, 10000);
  };

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Check if current session now has firstMessage - stop polling if so
  useEffect(() => {
    if (!currentSessionId || !pollingRef.current) return;

    const session = sessions.find(s => s.id === currentSessionId);
    if (session?.firstMessage) {
      stopPolling();
    }
  }, [sessions, currentSessionId]);

  const handleSubmit = async () => {
    if (input.trim() && !disabled) {
      const isFirstMessage = messages.length === 0;
      sendMessage(input.trim());
      setInput('');
      // Start polling for session label update after first message
      if (isFirstMessage) {
        startPollingForFirstMessage();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Box
      sx={{
        p: 2,
        borderTop: 1,
        borderColor: 'divider',
        display: 'flex',
        gap: 1,
        alignItems: 'flex-end',
      }}
    >
      <TextField
        fullWidth
        multiline
        maxRows={4}
        id="message-input"
        name="message"
        label="Message"
        placeholder="Type your message..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        inputProps={{ 'data-testid': 'prompt-input' }}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: 2,
          },
        }}
      />
      <IconButton
        data-testid="send-button"
        color="primary"
        onClick={handleSubmit}
        disabled={!input.trim() || disabled}
        sx={{ mb: 1 }}
      >
        <SendIcon />
      </IconButton>
    </Box>
  );
}

export default PromptInput;
