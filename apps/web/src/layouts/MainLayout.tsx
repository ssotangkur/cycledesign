import { Box, AppBar, Toolbar, Typography, IconButton, Collapse } from '@mui/material';
import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentSessionId } from '../hooks/useSession';
import SessionSelector from '../components/chat/SessionSelector';
import MessageList from '../components/chat/MessageList';
import PromptInput from '../components/chat/PromptInput';
import ConnectionStatus from '../components/chat/ConnectionStatus';
import { StatusDisplay } from '../components/status/StatusDisplay';
import PreviewFrame from '../components/preview/PreviewFrame';
import PreviewServerStatus, { type ServerState } from '../components/preview/PreviewServerStatus';
import PreviewLogViewer, { type LogEntry } from '../components/preview/PreviewLogViewer';
import { Panel, Group, Separator } from 'react-resizable-panels';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SettingsIcon from '@mui/icons-material/Settings';

const LOG_PANEL_HEIGHT = 200;

function MainLayout() {
  const navigate = useNavigate();
  const { currentSessionId } = useCurrentSessionId();

  const [serverState, setServerState] = useState<ServerState>('STOPPED');
  const [serverPort, setServerPort] = useState<number | undefined>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

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

  const previewUrl = serverState === 'RUNNING' ? `http://localhost:${serverPort || 3002}` : undefined;

  return (
    <Box data-testid="app-layout" sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static" sx={{ width: '100%', flexShrink: 0 }}>
        <Toolbar>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            CycleDesign
          </Typography>
          <IconButton data-testid="settings-button" color="inherit" onClick={() => navigate('/settings')}>
            <SettingsIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Group
        orientation="horizontal"
        className="panel-group"
        style={{
          width: '100%',
          height: '100%',
        }}
      >
        <Panel
          data-testid="chat-panel"
          defaultSize="35"
          className="chat-panel"
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              height: '100%',
            }}
          >
            <SessionSelector />
            <StatusDisplay sessionId={currentSessionId} />
            <MessageList />
            <PromptInput />
            <ConnectionStatus />
          </Box>
        </Panel>

        <Separator
          data-testid="resize-divider"
          className="panel-separator"
          style={{
            width: '8px',
            cursor: 'col-resize',
            backgroundColor: '#e0e0e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            zIndex: 1,
            transition: 'background-color 0.2s',
            outline: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#1976d2';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#e0e0e0';
          }}
        >
          <Box
            sx={{
              width: '2px',
              height: '40px',
              backgroundColor: 'text.secondary',
              borderRadius: '1px',
              opacity: 0.5,
            }}
          />
        </Separator>

        <Panel
          data-testid="preview-panel"
          className="preview-panel"
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              height: '100%',
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
        </Panel>
      </Group>
    </Box>
  );
}

export default MainLayout;
