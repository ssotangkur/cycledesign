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
import { useSession } from '../../hooks/useSession';

function SessionSelector() {
  const { sessions, currentSession, loadSession, createSession, deleteSession, sessionLabelsMap } =
    useSession();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  const handleCreateSession = async () => {
    try {
      await createSession();
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const handleDeleteSession = async () => {
    if (!sessionToDelete) return;
    try {
      await deleteSession(sessionToDelete);
      setDeleteDialogOpen(false);
      setSessionToDelete(null);
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const openDeleteDialog = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setSessionToDelete(sessionId);
    setDeleteDialogOpen(true);
  };

  return (
    <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
      <TextField
        select
        label="Session"
        value={currentSession?.id || ''}
        onChange={(e) => loadSession(e.target.value)}
        sx={{ flex: 1 }}
        size="small"
      >
        {sessions.map((session) => (
          <MenuItem key={session.id} value={session.id}>
            {sessionLabelsMap[session.id] || session.id.slice(-8)}
          </MenuItem>
        ))}
      </TextField>
      <Tooltip title="New Session">
        <IconButton onClick={handleCreateSession} color="primary">
          <AddIcon />
        </IconButton>
      </Tooltip>
      {currentSession && (
        <Tooltip title="Delete">
          <IconButton onClick={(e) => openDeleteDialog(e, currentSession.id)} color="error">
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      )}

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Session</DialogTitle>
        <DialogContent>
          Are you sure you want to delete this session? This action cannot be undone.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteSession} variant="contained" color="error">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}

export default SessionSelector;
