import { Box, Typography, IconButton, Checkbox, FormControlLabel } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import ClearIcon from '@mui/icons-material/Clear';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

export interface LogEntry {
  type: 'stdout' | 'stderr' | 'ready' | 'exit';
  message: string;
  timestamp: number;
}

interface PreviewLogViewerProps {
  logs: LogEntry[];
  onClear: () => void;
}

function PreviewLogViewer({ logs, onClear }: PreviewLogViewerProps) {
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const prevLogCountRef = useRef(0);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      const container = logContainerRef.current;
      const isScrolledToBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 100;

      if (logs.length > prevLogCountRef.current && isScrolledToBottom) {
        container.scrollTop = container.scrollHeight;
      }

      prevLogCountRef.current = logs.length;
    }
  }, [logs, autoScroll]);

  const getLogColor = (type: LogEntry['type']): string => {
    switch (type) {
      case 'stdout':
        return 'text.primary';
      case 'stderr':
        return 'error.main';
      case 'ready':
        return 'success.main';
      case 'exit':
        return 'warning.main';
      default:
        return 'text.primary';
    }
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderTop: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="caption" fontWeight="bold" color="text.secondary">
          Server Logs
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={!autoScroll}
                onChange={(e) => setAutoScroll(!e.target.checked)}
                size="small"
                icon={<PlayArrowIcon fontSize="small" />}
                checkedIcon={<PauseIcon fontSize="small" />}
              />
            }
            label={
              <Typography variant="caption" color="text.secondary">
                {autoScroll ? 'Auto-scroll' : 'Paused'}
              </Typography>
            }
            sx={{ mr: 1 }}
          />

          <IconButton
            size="small"
            onClick={onClear}
            title="Clear logs"
          >
            <ClearIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      <Box
        ref={logContainerRef}
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: 1,
          fontFamily: 'monospace',
          fontSize: '0.75rem',
          bgcolor: 'background.default',
        }}
      >
        {logs.length === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1 }}>
            No logs yet. Start the preview server to see logs.
          </Typography>
        ) : (
          logs.map((log, index) => (
            <Box
              key={`${log.timestamp}-${index}`}
              sx={{
                py: 0.25,
                px: 0.5,
                borderRadius: 0.5,
                bgcolor:
                  log.type === 'stderr'
                    ? 'error.lighter'
                    : log.type === 'ready'
                    ? 'success.lighter'
                    : 'transparent',
              }}
            >
              <Typography
                variant="caption"
                component="span"
                color="text.secondary"
                sx={{ mr: 1, userSelect: 'none' }}
              >
                [{formatTime(log.timestamp)}]
              </Typography>
              <Typography
                variant="caption"
                component="span"
                color={getLogColor(log.type)}
                sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {log.message}
              </Typography>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

export default PreviewLogViewer;
