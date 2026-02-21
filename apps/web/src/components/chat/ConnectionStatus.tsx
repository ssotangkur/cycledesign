import { Box, Typography, Tooltip, CircularProgress } from '@mui/material';

interface ConnectionStatusProps {
  isConnected: boolean;
  isReconnecting?: boolean;
  reconnectAttempt?: number;
  maxReconnectAttempts?: number;
}

function ConnectionStatus({
  isConnected,
  isReconnecting = false,
  reconnectAttempt = 0,
  maxReconnectAttempts = 5,
}: ConnectionStatusProps) {
  const getStatusText = () => {
    if (isConnected) {
      return 'Connected';
    }
    if (isReconnecting) {
      return `Reconnecting... (${reconnectAttempt}/${maxReconnectAttempts})`;
    }
    if (reconnectAttempt >= maxReconnectAttempts) {
      return 'Offline';
    }
    return 'Connecting...';
  };

  const getStatusColor = () => {
    if (isConnected) {
      return 'success.main';
    }
    if (isReconnecting) {
      return 'warning.main';
    }
    if (reconnectAttempt >= maxReconnectAttempts) {
      return 'error.main';
    }
    return 'text.secondary';
  };

  const getIndicatorContent = () => {
    if (isConnected) {
      return (
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: 'success.main',
          }}
        />
      );
    }
    if (isReconnecting || !isConnected) {
      return (
        <CircularProgress
          size={16}
          thickness={6}
          sx={{
            color: getStatusColor(),
          }}
        />
      );
    }
    return null;
  };

  const getTooltipTitle = () => {
    if (isConnected) {
      return 'WebSocket connection established';
    }
    if (isReconnecting) {
      return `Attempting to reconnect... (Attempt ${reconnectAttempt} of ${maxReconnectAttempts})`;
    }
    if (reconnectAttempt >= maxReconnectAttempts) {
      return 'Connection failed. Please refresh the page.';
    }
    return 'Establishing WebSocket connection...';
  };

  return (
    <Tooltip title={getTooltipTitle()} placement="bottom">
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.5,
          borderRadius: 1,
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
        }}
      >
        {getIndicatorContent()}
        <Typography variant="caption" color={getStatusColor()} sx={{ lineHeight: 1 }}>
          {getStatusText()}
        </Typography>
      </Box>
    </Tooltip>
  );
}

export default ConnectionStatus;
