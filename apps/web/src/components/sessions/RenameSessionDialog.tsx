import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from '@mui/material';

interface RenameSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onRename: () => void;
  sessionName: string;
  onNameChange: (name: string) => void;
}

function RenameSessionDialog({ open, onClose, onRename, sessionName, onNameChange }: RenameSessionDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Rename Session</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="Session Name"
          fullWidth
          value={sessionName}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onRename} variant="contained">
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default RenameSessionDialog;
