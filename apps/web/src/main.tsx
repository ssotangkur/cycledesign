import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { theme } from './theme';
import { SessionProvider } from './context/SessionContext';
import { TRPCProvider } from './components/TRPCProvider';

window.addEventListener('error', (event) => {
  if (
    event.message?.includes('getBoundingClientRect') ||
    event.message?.includes('Outdated Optimize Dep')
  ) {
    event.preventDefault();
    console.debug('Suppressing known MUI/Vite error:', event.message);
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TRPCProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BrowserRouter>
      </ThemeProvider>
    </TRPCProvider>
  </React.StrictMode>
);
