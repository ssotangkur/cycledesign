import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from '@mui/material';

interface DeleteSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  sessionName?: string;
}

function DeleteSessionDialog({ open, onClose, onConfirm, sessionName }: DeleteSessionDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Delete Session</DialogTitle>
      <DialogContent>
        Are you sure you want to delete "{sessionName}"? This action cannot be undone.
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onConfirm} variant="contained" color="error">
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default DeleteSessionDialog;
