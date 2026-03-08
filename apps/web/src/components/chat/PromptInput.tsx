import { useState } from 'react';
import { Box, TextField, IconButton } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { useCurrentSessionId, useIsHydrated, useInvalidateSessions } from '../../hooks/useSession';
import { useMessageListState } from '../../hooks/useMessageListState';

function PromptInput() {
  const { currentSessionId } = useCurrentSessionId();
  const isHydrated = useIsHydrated();
  const { invalidateSessions } = useInvalidateSessions();
  const { sendMessage, isStreaming, isConnected, messages } = useMessageListState(currentSessionId);
  const [input, setInput] = useState('');

  const disabled = !isHydrated || !currentSessionId || !isConnected || isStreaming;

  const handleSubmit = async () => {
    if (input.trim() && !disabled) {
      const isFirstMessage = messages.length === 0;
      sendMessage(input.trim());
      setInput('');
      // Invalidate sessions list after first message to update the session label
      if (isFirstMessage) {
        invalidateSessions();
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
