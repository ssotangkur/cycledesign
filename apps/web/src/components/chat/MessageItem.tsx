import { Box, Avatar, Typography } from '@mui/material';
import { Message } from '../../api/client';

interface MessageItemProps {
  message: Message;
}

function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';

  if (isTool) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          py: 1,
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          Tool result for call: {message.toolCallId}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 1.5,
        alignItems: 'flex-start',
      }}
    >
      <Avatar
        sx={{
          bgcolor: isUser ? 'primary.main' : 'secondary.main',
          width: 36,
          height: 36,
        }}
      >
        {isUser ? 'U' : 'A'}
      </Avatar>
      <Box
        sx={{
          maxWidth: '70%',
          p: 2,
          borderRadius: 2,
          bgcolor: isUser ? 'primary.light' : 'grey.100',
          color: isUser ? 'primary.contrastText' : 'text.primary',
        }}
      >
        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
          {message.content}
        </Typography>
        {message.tokenCount && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {message.tokenCount} tokens
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export default MessageItem;
