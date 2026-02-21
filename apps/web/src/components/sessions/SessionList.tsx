import { List, ListItem, ListItemText, ListItemSecondaryAction, IconButton, Box, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { Session } from '../../api/client';

interface SessionListProps {
  sessions: Session[];
  currentSessionId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

function SessionList({ sessions, currentSessionId, onSelect, onDelete, onRename }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No sessions yet. Create one to get started!
        </Typography>
      </Box>
    );
  }

  return (
    <List>
      {sessions.map((session) => (
        <ListItem
          key={session.id}
          button
          selected={session.id === currentSessionId}
          onClick={() => onSelect(session.id)}
        >
          <ListItemText
            primary={session.name}
            secondary={`${session.messageCount} messages`}
          />
          <ListItemSecondaryAction>
            <IconButton
              edge="end"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onRename(session.id, session.name);
              }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton
              edge="end"
              size="small"
              color="error"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(session.id);
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </ListItemSecondaryAction>
        </ListItem>
      ))}
    </List>
  );
}

export default SessionList;
