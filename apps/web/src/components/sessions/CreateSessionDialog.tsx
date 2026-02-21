import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from '@mui/material';

interface CreateSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name?: string) => void;
  sessionName: string;
  onNameChange: (name: string) => void;
}

function CreateSessionDialog({ open, onClose, onCreate, sessionName, onNameChange }: CreateSessionDialogProps) {
  const handleCreate = () => {
    onCreate(sessionName || undefined);
    onNameChange('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Create New Session</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="Session Name"
          fullWidth
          value={sessionName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Optional"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleCreate} variant="contained">
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default CreateSessionDialog;
