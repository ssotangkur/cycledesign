import React from 'react';
import { Box, Typography, Container } from '@mui/material';

export function App() {
  return (
    <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
      <Typography variant="h3" gutterBottom>
        CycleDesign Preview
      </Typography>
      <Typography variant="body1" color="text.secondary">
        The app.tsx component is ready. Modify it to create your design.
      </Typography>
      <Box sx={{ mt: 4, p: 3, bgcolor: 'grey.100', borderRadius: 2 }}>
        <Typography variant="h6">Getting Started</Typography>
        <Typography variant="body2">
          Edit this file to build your UI. The App component is the root of your application.
        </Typography>
      </Box>
    </Container>
  );
}
