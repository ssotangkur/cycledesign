import { Box, Typography, CircularProgress, ToggleButtonGroup, ToggleButton } from '@mui/material';
import { useRef, useState, useCallback } from 'react';
import { useIframeBridge, type IframeMessage, type ParentMessage } from '../../hooks/useIframeBridge';

interface PreviewFrameProps {
  url?: string;
  isLoading?: boolean;
  error?: string | null;
  onComponentSelected?: (instanceId: string, componentName: string) => void;
  onModeReady?: (mode: string) => void;
}

type Mode = 'select' | 'preview' | 'audit';

function PreviewFrame({ url, isLoading = false, error = null, onComponentSelected, onModeReady }: PreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [mode, setMode] = useState<Mode>('select');

  const handleMessage = useCallback((message: IframeMessage) => {
    if (message.type === 'COMPONENT_SELECTED' && onComponentSelected) {
      onComponentSelected(message.payload.instanceId, message.payload.componentName);
    } else if (message.type === 'MODE_READY' && onModeReady) {
      onModeReady(message.payload.mode);
    }
  }, [onComponentSelected, onModeReady]);

  const { sendMessage } = useIframeBridge({
    iframeRef,
    previewOrigin: url ? new URL(url).origin : 'http://localhost:3002',
    onMessage: handleMessage,
  });

  const handleModeChange = (_: React.MouseEvent<HTMLElement>, newMode: Mode | null) => {
    if (newMode) {
      setMode(newMode);
      const message: ParentMessage = {
        type: 'SET_MODE',
        payload: { mode: newMode },
      };
      sendMessage(message);
    }
  };
  if (error) {
    return (
      <Box
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 2,
          p: 3,
        }}
      >
        <Typography color="error" variant="h6">
          Preview Error
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {error}
        </Typography>
      </Box>
    );
  }

  if (isLoading) {
    return (
      <Box
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography color="text.secondary" variant="body2">
          Starting preview server...
        </Typography>
      </Box>
    );
  }

  if (!url) {
    return (
      <Box
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 2,
          backgroundColor: 'background.default',
        }}
      >
        <Typography color="text.secondary" variant="h6">
          No Preview Available
        </Typography>
        <Typography color="text.secondary" variant="body2">
          Generate a design to see the preview
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          p: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={handleModeChange}
          size="small"
        >
          <ToggleButton value="select">Select</ToggleButton>
          <ToggleButton value="preview">Preview</ToggleButton>
          <ToggleButton value="audit">Audit</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <iframe
        ref={iframeRef}
        src={url}
        title="Design Preview"
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          flex: 1,
        }}
      />
    </Box>
  );
}

export default PreviewFrame;
