import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/trpc': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  optimizeDeps: {
    force: true,
    include: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
    exclude: ['@trpc/react-query', '@trpc/client', '@trpc/server'],
  },
});
