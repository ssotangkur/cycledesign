import { List, ListItem, ListItemText, ListItemSecondaryAction, IconButton, Box, Typography, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { Session } from '../../api/client';

interface SessionListProps {
  sessions: Session[];
  currentSessionId?: string;
  sessionLabelsMap: Record<string, string>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function SessionList({ sessions, currentSessionId, sessionLabelsMap, onSelect, onDelete }: SessionListProps) {
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
      {sessions.map((session) => {
        const label = sessionLabelsMap[session.id] || session.id.slice(-8);
        const tooltipTitle = `${label}\n${session.messageCount} messages\nLast updated: ${new Date(session.updatedAt).toLocaleString()}`;

        return (
          <ListItem
            key={session.id}
            button
            selected={session.id === currentSessionId}
            onClick={() => onSelect(session.id)}
          >
            <Tooltip title={tooltipTitle} arrow>
              <ListItemText
                primary={label}
                secondary={`${session.messageCount} messages`}
                sx={{
                  overflow: 'hidden',
                  '& .MuiListItemText-primary': {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '200px',
                  },
                }}
              />
            </Tooltip>
            <ListItemSecondaryAction>
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
        );
      })}
    </List>
  );
}

export default SessionList;
