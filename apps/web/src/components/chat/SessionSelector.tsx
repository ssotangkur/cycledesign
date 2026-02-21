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
import EditIcon from '@mui/icons-material/Edit';
import { useSession } from '../../hooks/useSession';

function SessionSelector() {
  const { sessions, currentSession, loadSession, createSession, deleteSession, renameSession } =
    useSession();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [sessionToRename, setSessionToRename] = useState<{ id: string; name: string } | null>(
    null
  );

  const handleCreateSession = async () => {
    try {
      await createSession(newSessionName || undefined);
      setCreateDialogOpen(false);
      setNewSessionName('');
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

  const handleRenameSession = async () => {
    if (!sessionToRename) return;
    try {
      await renameSession(sessionToRename.id, newSessionName);
      setRenameDialogOpen(false);
      setSessionToRename(null);
      setNewSessionName('');
    } catch (error) {
      console.error('Failed to rename session:', error);
    }
  };

  const openRenameDialog = (e: React.MouseEvent, session: { id: string; name: string }) => {
    e.stopPropagation();
    setSessionToRename(session);
    setNewSessionName(session.name);
    setRenameDialogOpen(true);
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
            {session.name}
          </MenuItem>
        ))}
      </TextField>
      <Tooltip title="New Session">
        <IconButton onClick={() => setCreateDialogOpen(true)} color="primary">
          <AddIcon />
        </IconButton>
      </Tooltip>
      {currentSession && (
        <>
          <Tooltip title="Rename">
            <IconButton
              onClick={(e) => openRenameDialog(e, { id: currentSession.id, name: currentSession.name })}
            >
              <EditIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton onClick={(e) => openDeleteDialog(e, currentSession.id)} color="error">
              <DeleteIcon />
            </IconButton>
          </Tooltip>
        </>
      )}

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)}>
        <DialogTitle>Create New Session</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Session Name"
            fullWidth
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
            placeholder="Optional"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateSession} variant="contained">
            Create
          </Button>
        </DialogActions>
      </Dialog>

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

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)}>
        <DialogTitle>Rename Session</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Session Name"
            fullWidth
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleRenameSession} variant="contained">
            Rename
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default SessionSelector;
