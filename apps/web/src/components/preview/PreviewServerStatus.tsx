import { Box, Button, Chip, Typography } from '@mui/material';
import { useState } from 'react';

export type ServerState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';

interface PreviewServerStatusProps {
  state: ServerState;
  port?: number;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}

function PreviewServerStatus({ state, port, onStart, onStop }: PreviewServerStatusProps) {
  const [isConfirmingStop, setIsConfirmingStop] = useState(false);

  const handleStopClick = () => {
    if (state === 'RUNNING') {
      setIsConfirmingStop(true);
    } else {
      onStop();
    }
  };

  const handleConfirmStop = () => {
    setIsConfirmingStop(false);
    onStop();
  };

  const handleCancelStop = () => {
    setIsConfirmingStop(false);
  };

  const getColor = (): 'default' | 'warning' | 'success' | 'error' | 'info' => {
    switch (state) {
      case 'STOPPED':
        return 'default';
      case 'STARTING':
        return 'info';
      case 'RUNNING':
        return 'success';
      case 'ERROR':
        return 'error';
      default:
        return 'default';
    }
  };

  const getLabel = (): string => {
    switch (state) {
      case 'STOPPED':
        return 'Stopped';
      case 'STARTING':
        return 'Starting...';
      case 'RUNNING':
        return 'Running';
      case 'ERROR':
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  const showStartButton = state === 'STOPPED' || state === 'ERROR';
  const showStopButton = state === 'RUNNING';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        p: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Chip
        label={getLabel()}
        color={getColor()}
        size="small"
        sx={{ fontWeight: 'bold' }}
      />

      {port && state === 'RUNNING' && (
        <Typography variant="caption" color="text.secondary">
          Port: {port}
        </Typography>
      )}

      <Box sx={{ flexGrow: 1 }} />

      {showStartButton && (
        <Button
          variant="contained"
          size="small"
          onClick={onStart}
        >
          Start
        </Button>
      )}

      {showStopButton && (
        <>
          {!isConfirmingStop ? (
            <Button
              variant="outlined"
              size="small"
              color="error"
              onClick={handleStopClick}
            >
              Stop
            </Button>
          ) : (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                size="small"
                color="error"
                onClick={handleConfirmStop}
              >
                Confirm
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={handleCancelStop}
              >
                Cancel
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

export default PreviewServerStatus;
