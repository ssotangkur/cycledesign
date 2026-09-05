import { Box, Avatar, Typography } from '@mui/material';
import type { ChatMessageWithStatus } from '../../hooks/useChatMessageList';

interface MessageItemProps {
  message: ChatMessageWithStatus;
}

function MessageItem({ message }: MessageItemProps) {
  const isUser = message.userId === 'user';

  return (
    <Box
      data-testid={isUser ? 'message-user' : 'message-assistant'}
      sx={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 1.5,
        alignItems: 'flex-start',
      }}
    >
      <Avatar
        data-testid={isUser ? 'avatar-user' : 'avatar-assistant'}
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
      </Box>
    </Box>
  );
}

export default MessageItem;
