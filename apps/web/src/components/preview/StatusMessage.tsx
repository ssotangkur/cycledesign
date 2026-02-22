import { Box, Chip, Typography, Collapse, CircularProgress } from '@mui/material';
import { useState } from 'react';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import WarningIcon from '@mui/icons-material/Warning';

export type StatusType =
  | 'tool_call_start'
  | 'tool_call_complete'
  | 'tool_call_error'
  | 'validation_start'
  | 'validation_complete'
  | 'validation_error'
  | 'preview_start'
  | 'preview_ready'
  | 'preview_error';

interface StatusMessageProps {
  status: StatusType;
  tool?: string;
  details: string;
  timestamp?: number;
}

function StatusMessage({ status, tool, details, timestamp }: StatusMessageProps) {
  const [expanded, setExpanded] = useState(false);

  const getStatusInfo = (): {
    color: 'info' | 'success' | 'error' | 'warning' | 'default';
    icon: React.ReactNode;
  } => {
    if (status.includes('_start')) {
      return {
        color: 'info',
        icon: <CircularProgress size={14} sx={{ mr: 1 }} />,
      };
    }

    if (status.includes('_complete') || status.includes('_ready')) {
      return {
        color: 'success',
        icon: <CheckCircleIcon fontSize="small" sx={{ mr: 1 }} />,
      };
    }

    if (status.includes('_error')) {
      return {
        color: 'error',
        icon: <ErrorIcon fontSize="small" sx={{ mr: 1 }} />,
      };
    }

    return {
      color: 'default',
      icon: <InfoIcon fontSize="small" sx={{ mr: 1 }} />,
    };
  };

  const { color, icon } = getStatusInfo();

  const getDisplayText = (): string => {
    if (tool) {
      return `${tool}: ${details}`;
    }
    return details;
  };

  const handleClick = () => {
    setExpanded(!expanded);
  };

  return (
    <Box
      sx={{
        py: 0.5,
        px: 1,
        my: 0.5,
        borderRadius: 1,
        bgcolor: 'action.hover',
        cursor: 'pointer',
        '&:hover': {
          bgcolor: 'action.selected',
        },
      }}
      onClick={handleClick}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {icon}
        <Chip
          label={getDisplayText()}
          color={color === 'default' ? 'default' : color}
          size="small"
          variant="outlined"
          sx={{
            flexGrow: 1,
            '& .MuiChip-label': {
              whiteSpace: 'normal',
              py: 0.5,
            },
          }}
        />
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ mt: 1, p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" fontWeight="bold" color="text.secondary">
              Status: {status}
            </Typography>
            {timestamp && (
              <Typography variant="caption" color="text.secondary">
                {new Date(timestamp).toLocaleTimeString()}
              </Typography>
            )}
          </Box>

          {tool && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Tool: {tool}
            </Typography>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Details: {details}
          </Typography>

          {status.includes('_error') && (
            <Box sx={{ mt: 1, p: 1, bgcolor: 'error.lighter', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <WarningIcon fontSize="small" color="error" />
                <Typography variant="caption" color="error.main" fontWeight="bold">
                  Action Required
                </Typography>
              </Box>
              <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.5 }}>
                Please review the error and try again.
              </Typography>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

export default StatusMessage;
