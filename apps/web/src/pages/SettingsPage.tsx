import { Box, Typography, Paper } from '@mui/material';

function SettingsPage() {
  return (
    <Box sx={{ maxWidth: 800, margin: '0 auto' }}>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>
      <Paper sx={{ p: 3 }}>
        <Typography variant="body1">
          Settings page coming soon in Phase 2.
        </Typography>
      </Paper>
    </Box>
  );
}

export default SettingsPage;
