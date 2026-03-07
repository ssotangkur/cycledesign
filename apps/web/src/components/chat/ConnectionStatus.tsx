import { Box, Typography, Tooltip } from '@mui/material';
import { useIsHydrated, useCurrentSessionId } from '../../hooks/useSession';
import { useMessageListState } from '../../hooks/useMessageListState';

function ConnectionStatus() {
  const isHydrated = useIsHydrated();
  const { currentSessionId } = useCurrentSessionId();
  const { isConnected } = useMessageListState(currentSessionId);

  if (!isHydrated) {
    return null;
  }

  const statusText = isConnected ? 'Connected' : 'Disconnected';
  const statusColor = isConnected ? 'success.main' : 'error.main';

  return (
    <Tooltip title={isConnected ? 'Connected' : 'Disconnected'} placement="bottom">
      <Box
        data-testid="connection-status"
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
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: statusColor,
          }}
        />
        <Typography variant="caption" color={statusColor} sx={{ lineHeight: 1 }}>
          {statusText}
        </Typography>
      </Box>
    </Tooltip>
  );
}

export default ConnectionStatus;
