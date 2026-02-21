import { useState } from 'react';
import { Box, TextField, IconButton } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';

interface PromptInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

function PromptInput({ onSend, disabled }: PromptInputProps) {
  const [input, setInput] = useState('');

  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
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
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: 2,
          },
        }}
      />
      <IconButton
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
