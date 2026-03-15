import { Box, Chip, CircularProgress, Typography } from '@mui/material';
import { useMessageListState } from '../../hooks/useMessageListState';

interface StatusDisplayProps {
  sessionId: string | null;
}

export function StatusDisplay({ sessionId }: StatusDisplayProps) {
  const { currentStatus } = useMessageListState(sessionId);

  if (!currentStatus || !currentStatus.status) {
    return null;
  }

  const getStatusIcon = () => {
    if (!currentStatus.status) return null;
    if (currentStatus.status.includes('_start')) {
      return <CircularProgress size={16} sx={{ mr: 1 }} />;
    }
    if (currentStatus.status.includes('_complete') || currentStatus.status.includes('_ready')) {
      return '✓';
    }
    if (currentStatus.status.includes('_error')) {
      return '✗';
    }
    return '•';
  };

  const getStatusColor = (): 'info' | 'success' | 'error' | 'warning' => {
    if (!currentStatus.status) return 'info';
    if (currentStatus.status.includes('_start')) return 'info';
    if (currentStatus.status.includes('_complete') || currentStatus.status.includes('_ready')) return 'success';
    if (currentStatus.status.includes('_error')) return 'error';
    return 'info';
  };

  return (
    <Box sx={{ 
      py: 0.5, 
      px: 1, 
      bgcolor: 'action.hover',
      display: 'flex',
      alignItems: 'center',
      gap: 1,
    }}>
      {getStatusIcon()}
      <Chip
        label={currentStatus.details || currentStatus.status}
        color={getStatusColor()}
        size="small"
        variant="outlined"
      />
      {currentStatus.tool && (
        <Typography variant="caption" color="text.secondary">
          {currentStatus.tool}
        </Typography>
      )}
    </Box>
  );
}
