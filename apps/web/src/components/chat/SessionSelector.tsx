import { useState } from 'react';
import {
  Box,
  TextField,
  MenuItem,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import type { Session } from '../../api/client';
import { useSessions, useCreateSession, useDeleteSession, useGetSession } from '../../hooks/useSession';
import { useCurrentSessionId } from '../../hooks/useSession';

function SessionSelector() {
  const { sessions, sessionLabelsMap } = useSessions();
  const { createSession } = useCreateSession();
  const { deleteSession } = useDeleteSession();
  const { getSessionById } = useGetSession();
  const { currentSessionId, setCurrentSessionId } = useCurrentSessionId();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  const handleCreateSession = async () => {
    try {
      const session = await createSession();
      setCurrentSessionId(session.id);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const handleDeleteSession = async () => {
    if (!sessionToDelete) return;
    try {
      await deleteSession(sessionToDelete);
      if (currentSessionId === sessionToDelete) {
        setCurrentSessionId(null);
      }
      setDeleteDialogOpen(false);
      setSessionToDelete(null);
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const loadSession = async (id: string) => {
    const session = await getSessionById(id);
    if (session) {
      setCurrentSessionId(session.id);
    }
  };

  const openDeleteDialog = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setSessionToDelete(sessionId);
    setDeleteDialogOpen(true);
  };

  return (
    <Box data-testid="session-selector" sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
      <TextField
        select
        label="Session"
        value={currentSessionId || ''}
        onChange={(e) => loadSession(e.target.value)}
        sx={{ flex: 1 }}
        size="small"
        data-testid="session-select"
      >
        {sessions.map((session: Session) => (
          <MenuItem key={session.id} value={session.id} data-testid="session-option">
            {sessionLabelsMap[session.id] || session.id.slice(-8)}
          </MenuItem>
        ))}
      </TextField>
      <Tooltip title="New Session">
        <IconButton data-testid="new-session-button" onClick={handleCreateSession} color="primary">
          <AddIcon />
        </IconButton>
      </Tooltip>
      {currentSessionId && (
        <Tooltip title="Delete">
          <IconButton data-testid="delete-session-button" onClick={(e) => openDeleteDialog(e, currentSessionId)} color="error">
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      )}

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} data-testid="delete-dialog">
        <DialogTitle>Delete Session</DialogTitle>
        <DialogContent>
          Are you sure you want to delete this session? This action cannot be undone.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} data-testid="cancel-delete-button">Cancel</Button>
          <Button onClick={handleDeleteSession} variant="contained" color="error" data-testid="confirm-delete-button">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}

export default SessionSelector;
