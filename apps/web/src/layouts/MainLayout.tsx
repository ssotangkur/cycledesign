import { Box, AppBar, Toolbar, Typography, IconButton, Collapse } from '@mui/material';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SessionSelector from '../components/chat/SessionSelector';
import MessageList from '../components/chat/MessageList';
import PromptInput from '../components/chat/PromptInput';
import ConnectionStatus from '../components/chat/ConnectionStatus';
import PreviewFrame from '../components/preview/PreviewFrame';
import PreviewServerStatus, { type ServerState } from '../components/preview/PreviewServerStatus';
import PreviewLogViewer, { type LogEntry } from '../components/preview/PreviewLogViewer';
import Divider from '../components/layout/Divider';
import { useSession } from '../hooks/useSession';
import { useMessageListState } from '../hooks/useMessageListState';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SettingsIcon from '@mui/icons-material/Settings';

const MIN_LEFT_PANE_WIDTH = 350;
const MAX_LEFT_PANE_PERCENT = 0.7;
const DEFAULT_LEFT_PANE_PERCENT = 0.4;
const LOG_PANEL_HEIGHT = 200;

function MainLayout() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [leftPaneWidth, setLeftPaneWidth] = useState<number | null>(null);

  const { currentSession } = useSession();
  const { messages, isConnected, isStreaming, sendMessage } = useMessageListState(
    currentSession?.id || null
  );

  const [serverState, setServerState] = useState<ServerState>('STOPPED');
  const [serverPort, setServerPort] = useState<number | undefined>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    const updateContainerWidth = () => {
      if (containerRef.current) {
        const newWidth = containerRef.current.clientWidth;
        setContainerWidth(newWidth);
        if (leftPaneWidth === null && newWidth > 0) {
          setLeftPaneWidth(newWidth * DEFAULT_LEFT_PANE_PERCENT);
        }
      }
    };

    updateContainerWidth();
    window.addEventListener('resize', updateContainerWidth);
    return () => window.removeEventListener('resize', updateContainerWidth);
  }, [leftPaneWidth]);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/preview/status');
        if (response.ok) {
          const data = await response.json();
          setServerState('RUNNING');
          setServerPort(data.port || 3002);
        } else {
          setServerState('STOPPED');
        }
      } catch {
        setServerState('STOPPED');
      }
    };

    fetchStatus();
  }, []);

  const handleStartServer = async () => {
    setServerState('STARTING');
    try {
      const response = await fetch('http://localhost:3001/api/preview/start', {
        method: 'POST',
      });
      if (response.ok) {
        const data = await response.json();
        setServerState('RUNNING');
        setServerPort(data.port || 3002);
        setShowLogs(true);
      } else {
        setServerState('ERROR');
      }
    } catch {
      setServerState('ERROR');
    }
  };

  const handleStopServer = async () => {
    try {
      await fetch('http://localhost:3001/api/preview/stop', {
        method: 'POST',
      });
      setServerState('STOPPED');
      setServerPort(undefined);
    } catch {
      setServerState('ERROR');
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  const handleComponentSelected = useCallback((instanceId: string, componentName: string) => {
    console.log('Component selected:', { instanceId, componentName });
  }, []);

  const handleModeReady = useCallback((mode: string) => {
    console.log('Mode ready:', mode);
  }, []);

  const handleDividerDrag = useCallback((newWidth: number) => {
    const minPercent = MIN_LEFT_PANE_WIDTH / containerWidth;
    const maxPercent = MAX_LEFT_PANE_PERCENT;
    const newPercent = newWidth / containerWidth;

    if (newPercent >= minPercent && newPercent <= maxPercent) {
      setLeftPaneWidth(newWidth);
    }
  }, [containerWidth]);

  const previewUrl = serverState === 'RUNNING' ? `http://localhost:${serverPort || 3002}` : undefined;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static" sx={{ width: '100%', flexShrink: 0 }}>
        <Toolbar>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            CycleDesign
          </Typography>
          <IconButton color="inherit" onClick={() => navigate('/settings')}>
            <SettingsIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box
        ref={containerRef}
        sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}
      >
        <Box
          sx={{
            width: leftPaneWidth ?? `${DEFAULT_LEFT_PANE_PERCENT * 100}%`,
            minWidth: `${MIN_LEFT_PANE_WIDTH}px`,
            maxWidth: `${MAX_LEFT_PANE_PERCENT * 100}%`,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <SessionSelector />
          <MessageList messages={messages} isStreaming={isStreaming} />
          <PromptInput onSend={sendMessage} disabled={!isConnected} />
          <ConnectionStatus isConnected={isConnected} />
        </Box>

        <Divider
          onDrag={handleDividerDrag}
          currentWidth={leftPaneWidth ?? 0}
          containerWidth={containerWidth}
          minWidth={MIN_LEFT_PANE_WIDTH}
          maxWidthPercent={MAX_LEFT_PANE_PERCENT}
        />

        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <PreviewServerStatus
            state={serverState}
            port={serverPort}
            onStart={handleStartServer}
            onStop={handleStopServer}
          />
          <PreviewFrame
            url={previewUrl}
            onComponentSelected={handleComponentSelected}
            onModeReady={handleModeReady}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', p: 1, bgcolor: 'background.paper' }}>
            <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ mr: 1 }}>
              Mode:
            </Typography>
            <IconButton size="small" onClick={() => setShowLogs(!showLogs)}>
              {showLogs ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
          <Collapse in={showLogs}>
            <Box sx={{ height: LOG_PANEL_HEIGHT }}>
              <PreviewLogViewer logs={logs} onClear={handleClearLogs} />
            </Box>
          </Collapse>
        </Box>
      </Box>
    </Box>
  );
}

export default MainLayout;
